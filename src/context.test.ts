import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { originFromForwarded, requestContext } from './context.ts'
import { createDispatcher } from './site-fetch.ts'

const config: any = { mode: 'public', mainSiteUrl: 'https://main.test', ignoreRateLimiting: 's' }
const dispatcher = createDispatcher({ mainSiteUrl: config.mainSiteUrl })
const ctxOf = (headers: Record<string, string>) => requestContext({ config, dispatcher })(new Request('http://x/mcp', { headers }))

describe('context', () => {
  it('reads the site origin from the forwarded headers, port included when non-default', () => {
    assert.equal(originFromForwarded(new Headers({ 'x-forwarded-host': 'portal.test', 'x-forwarded-proto': 'https' })), 'https://portal.test')
    assert.equal(originFromForwarded(new Headers({ 'x-forwarded-host': 'portal.test', 'x-forwarded-proto': 'http', 'x-forwarded-port': '8080' })), 'http://portal.test:8080')
    assert.equal(originFromForwarded(new Headers({ 'x-forwarded-host': 'portal.test', 'x-forwarded-proto': 'https', 'x-forwarded-port': '443' })), 'https://portal.test')
    assert.equal(originFromForwarded(new Headers({})), undefined)
  })
  it('rejects a malformed host or scheme instead of building a bad origin', () => {
    assert.equal(originFromForwarded(new Headers({ 'x-forwarded-host': 'evil.test/../x', 'x-forwarded-proto': 'https' })), undefined)
    assert.equal(originFromForwarded(new Headers({ 'x-forwarded-host': 'evil.test\\@ok.test', 'x-forwarded-proto': 'https' })), undefined)
    assert.equal(originFromForwarded(new Headers({ 'x-forwarded-host': 'portal.test', 'x-forwarded-proto': 'javascript' })), undefined)
    assert.equal(originFromForwarded(new Headers({ 'x-forwarded-host': 'portal.test:notaport', 'x-forwarded-proto': 'https' })), undefined)
    // still valid: uppercase and a normal port are accepted
    assert.equal(originFromForwarded(new Headers({ 'x-forwarded-host': 'Portal.Test:8080', 'x-forwarded-proto': 'https' })), 'https://Portal.Test:8080')
  })
  it('does not throw building a context from malformed forwarded headers, and forwards no identity for them', () => {
    // originFromForwarded rejects the header, so requestContext falls back to config.mainSiteUrl
    // instead of building a request against an attacker-controlled host or throwing
    const ctx = ctxOf({ 'x-forwarded-host': 'evil.test/../x', 'x-forwarded-proto': 'https' })
    assert.equal(typeof ctx.fetch, 'function')
    assert.equal(ctx.headers, undefined)
  })
  it('forwards the cookie and API key, hashes them into an identity, and nothing else', () => {
    const ctx = ctxOf({ cookie: 'id_token=abc', 'x-api-key': 'k', authorization: 'Bearer nope', 'x-forwarded-host': 'portal.test', 'x-forwarded-proto': 'https' })
    assert.deepEqual(ctx.headers, { cookie: 'id_token=abc', 'x-apikey': 'k' })
    assert.equal(ctx.identity, createHash('sha256').update('id_token=abc').digest('hex'))
    assert.equal(typeof ctx.fetch, 'function')
  })
  it('has no headers and no identity for an anonymous caller, and keeps the main site without forwarded headers', () => {
    const ctx = ctxOf({})
    assert.equal(ctx.headers, undefined)
    assert.equal(ctx.identity, undefined)
  })
  it('accepts x-apiKey in either spelling', () => {
    assert.equal(ctxOf({ 'x-apikey': 'k2' }).headers!['x-apikey'], 'k2')
  })
})
