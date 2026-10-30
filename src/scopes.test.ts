import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import express from 'express'
import { session } from '@data-fair/lib-express'
import { startFakeSite, type FakeSite } from '../test/fake-site.ts'
import { bearerFor, cookieFor, nhiClaims, userClaims, USER } from '../test/tokens.ts'
import { credentials, scopesOf, stdioSession, SCOPES_HEADER, sessionOptions } from './scopes.ts'
import { createDispatcher } from './site-fetch.ts'

const FORWARDED = { 'x-forwarded-host': 'portal.test', 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.7' }
const ONE_ORG = { ...USER, organizations: [USER.organizations[0]] }

describe('credentials', () => {
  let site: FakeSite
  let server: Server
  let base: string
  const initSession = (directoryUrl: string) => session.init(directoryUrl, undefined, undefined, sessionOptions)

  before(async () => {
    site = await startFakeSite()
    initSession(site.origin + '/simple-directory')
    const app = express()
    for (const required of [true, false]) {
      app.post(required ? '/required' : '/optional', credentials({ required, mainSiteUrl: site.origin }), (req, res) => {
        const request = new Request('http://x' + req.url, { headers: req.headers as Record<string, string> })
        res.json({ scopes: scopesOf(request) ?? null, cookie: req.headers.cookie ?? null, authorization: req.headers.authorization ?? null })
      })
    }
    app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(err.status ?? err.statusCode ?? 500).type('text').send(err.message)
    })
    await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()) })
    base = `http://127.0.0.1:${(server.address() as any).port}`
  })
  after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
    await site.close()
  })

  const call = (path: '/required' | '/optional', headers: Record<string, string> = {}, forwarded = true) =>
    fetch(base + path, { method: 'POST', headers: { ...(forwarded ? FORWARDED : {}), ...headers } })
  const body = async (res: Response) => { assert.equal(res.status, 200, await res.clone().text()); return await res.json() as any }

  it('refuses a caller without credentials when required', async () => {
    const res = await call('/required')
    assert.equal(res.status, 401)
    assert.equal(await res.text(), 'credentials required')
  })
  it('lets an anonymous caller through when not required', async () => {
    assert.equal((await body(await call('/optional'))).scopes, null)
  })
  it('passes an API key as unscoped without reading a session', async () => {
    const hits = site.hits.length
    assert.equal((await body(await call('/required', { 'x-apikey': 'k' }))).scopes, null)
    assert.equal((await body(await call('/required', { 'x-api-key': 'k' }))).scopes, null)
    assert.equal(site.hits.length, hits)
  })
  it('reads an unscoped cookie session as unscoped', async () => {
    const res = await body(await call('/required', { cookie: cookieFor(USER) }))
    assert.equal(res.scopes, null)
    assert.ok(res.cookie)
  })
  it('reads the scopes of a scoped cookie session', async () => {
    assert.deepEqual((await body(await call('/required', { cookie: cookieFor({ ...ONE_ORG, scope: 'datasets:read' }) }))).scopes, ['datasets:read'])
  })
  it('reads the scopes of an NHI bearer with the MCP audience', async () => {
    const res = await body(await call('/required', { authorization: 'Bearer ' + bearerFor(nhiClaims('datasets:read', 'https://portal.test')) }))
    assert.deepEqual(res.scopes, ['datasets:read'])
    assert.ok(res.authorization)
  })
  it('reads an in-cluster bearer against the main site', async () => {
    const res = await call('/required', { authorization: 'Bearer ' + bearerFor(nhiClaims('datasets:read', site.origin)) }, false)
    assert.deepEqual((await body(res)).scopes, ['datasets:read'])
  })
  it('refuses an NHI bearer with the site audience only', async () => {
    const res = await call('/required', { authorization: 'Bearer ' + bearerFor(nhiClaims('datasets:read', 'https://portal.test', 'https://portal.test')) })
    assert.equal(res.status, 401)
  })
  it('refuses a user bearer with the MCP audience', async () => {
    const res = await call('/required', { authorization: 'Bearer ' + bearerFor(userClaims('datasets:read', 'https://portal.test', ['https://portal.test/mcp-server', 'https://portal.test'])) })
    assert.equal(res.status, 401)
  })
  it('judges a request on its bearer, not its cookie', async () => {
    const res = await call('/required', { cookie: cookieFor(USER), authorization: 'Bearer ' + bearerFor(nhiClaims('datasets:read', 'https://portal.test', 'https://portal.test')) })
    assert.equal(res.status, 401)
  })
  it('drops a site-audience bearer on the optional route', async () => {
    const res = await body(await call('/optional', { authorization: 'Bearer ' + bearerFor(userClaims('datasets:read', 'https://portal.test')) }))
    assert.equal(res.authorization, null)
    assert.equal(res.scopes, null)
  })
  it('refuses a bearer addressed to another site', async () => {
    const res = await call('/required', { authorization: 'Bearer ' + bearerFor(nhiClaims('datasets:read', 'https://other.test')) })
    assert.equal(res.status, 401)
  })
  it('strips a client-sent x-mcp-scopes', async () => {
    assert.equal((await body(await call('/required', { 'x-apikey': 'k', [SCOPES_HEADER]: '["x"]' }))).scopes, null)
    assert.equal((await body(await call('/optional', { [SCOPES_HEADER]: '["x"]' }))).scopes, null)
  })
  it('serves a bad cookie anonymously when not required, without forwarding it', async () => {
    const cookie = cookieFor(USER, { expiresIn: -1 })
    assert.equal((await call('/required', { cookie })).status, 401)
    const res = await body(await call('/optional', { cookie }))
    assert.equal(res.scopes, null)
    assert.equal(res.cookie, null)
    const bad = await body(await call('/optional', { authorization: 'Bearer ' + bearerFor(nhiClaims('datasets:read', 'https://other.test')) }))
    assert.equal(bad.authorization, null)
  })
  it('treats a cookie session without a user as unverified', async () => {
    for (const cookie of ['id_token=x', 'id_token=']) {
      const res = await call('/required', { cookie })
      assert.equal(res.status, 401, cookie)
      const anonymous = await body(await call('/optional', { cookie }))
      assert.equal(anonymous.scopes, null)
      assert.equal(anonymous.cookie, null)
    }
  })
  it('fails, not 401, on /mcp when the JWKS cannot be read; anonymous on datasets', async () => {
    // a fresh session handler: no key cached, the directory unreachable
    initSession('http://127.0.0.1:1/simple-directory')
    try {
      const cookie = cookieFor(USER)
      const res = await call('/required', { cookie })
      assert.ok(res.status >= 500, `status ${res.status}`)
      const anonymous = await body(await call('/optional', { cookie }))
      assert.equal(anonymous.scopes, null)
      assert.equal(anonymous.cookie, null)
    } finally {
      initSession(site.origin + '/simple-directory')
    }
  })
})

describe('scopesOf', () => {
  it('parses the internal header, undefined without a request or the header', () => {
    assert.deepEqual(scopesOf(new Request('http://x', { headers: { [SCOPES_HEADER]: '["a","b"]' } })), ['a', 'b'])
    assert.equal(scopesOf(new Request('http://x')), undefined)
    assert.equal(scopesOf(undefined), undefined)
  })
})

describe('stdioSession', () => {
  let site: FakeSite
  before(async () => { site = await startFakeSite() })
  after(async () => { await site.close() })
  const options = () => ({ mainSiteUrl: site.origin, dispatcher: createDispatcher({ mainSiteUrl: site.origin }) })

  it('takes an API key as authenticated without a request', async () => {
    const hits = site.hits.length
    assert.deepEqual(await stdioSession({ ...options(), apiKey: 'k' }), { authenticated: true })
    assert.equal(site.hits.length, hits)
  })
  it('reads the scopes of the session the site reports', async () => {
    site.setSession({ user: USER, scopes: ['datasets:read'] })
    assert.deepEqual(await stdioSession(options()), { authenticated: true, scopes: ['datasets:read'] })
  })
  it('is unauthenticated when the site reports no user', async () => {
    site.setSession({})
    assert.deepEqual(await stdioSession(options()), { authenticated: false })
  })
  for (const [label, mode] of [['a non-JSON 200 body', 'text'], ['a null body', 'null'], ['a non-2xx answer', 503]] as const) {
    it(`is unauthenticated on ${label}`, async () => {
      site.failSession(mode)
      try { assert.deepEqual(await stdioSession(options()), { authenticated: false }) } finally { site.failSession(undefined) }
    })
  }
  it('is unauthenticated when the site is unreachable', async () => {
    const dead = await startFakeSite()
    const url = dead.origin
    await dead.close()
    assert.deepEqual(await stdioSession({ mainSiteUrl: url, dispatcher: createDispatcher({ mainSiteUrl: url }) }), { authenticated: false })
  })
})
