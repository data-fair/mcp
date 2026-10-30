import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { startFakeSite, type FakeSite } from '../test/fake-site.ts'
import { createDispatcher } from './site-fetch.ts'
import { createPlatform } from './platform.ts'
import { createIssuerLookup, protectedResourceMetadata, resourceMetadataUrl, scopesSupported } from './oauth-discovery.ts'

const DISCOVERY = '/simple-directory/.well-known/oauth-authorization-server'

describe('issuer lookup', () => {
  let site: FakeSite
  before(async () => { site = await startFakeSite() })
  after(async () => { await site.close() })
  beforeEach(() => site.setDiscovery('default'))

  // every site resolves to the fake site, as through the in-cluster proxy
  const lookup = (options: Partial<Parameters<typeof createIssuerLookup>[0]> = {}) => createIssuerLookup({
    mainSiteUrl: site.origin,
    dispatcher: createDispatcher({ mainSiteUrl: site.origin, upstreamProxyHost: `127.0.0.1:${site.port}` }),
    ...options
  })
  const probes = () => site.hits.filter(h => h.url === DISCOVERY).length
  const complete = (issuer: string, extra: object = {}) => ({ issuer, authorization_endpoint: issuer + '/api/oauth/authorize', ...extra })

  it('answers the issuer SD reports for an issuer site', async () => {
    assert.equal(await lookup()('https://portal.test'), 'https://portal.test/simple-directory')
  })
  it('probes the site as a public request', async () => {
    await lookup()('https://portal.test')
    const hit = site.hits.findLast(h => h.url === DISCOVERY)!
    assert.equal(hit.headers['x-forwarded-host'], 'portal.test')
    assert.equal(hit.headers['x-forwarded-proto'], 'https')
  })
  it('answers nothing for a site SD serves no discovery on', async () => {
    site.setDiscovery(404)
    assert.equal(await lookup()('https://portal.test'), undefined)
  })
  it('answers nothing when the code flow is off', async () => {
    site.setDiscovery({ issuer: 'https://portal.test/simple-directory', registration_endpoint: 'x' })
    assert.equal(await lookup()('https://portal.test'), undefined)
  })
  it('accepts client metadata documents without dynamic registration', async () => {
    site.setDiscovery(complete('https://portal.test/simple-directory', { client_id_metadata_document_supported: true }))
    assert.equal(await lookup()('https://portal.test'), 'https://portal.test/simple-directory')
  })
  it('answers nothing when no client can register', async () => {
    site.setDiscovery(complete('https://portal.test/simple-directory'))
    assert.equal(await lookup()('https://portal.test'), undefined)
  })
  it('answers nothing, in time, when SD hangs', async () => {
    site.setDiscovery('hang')
    const start = Date.now()
    assert.equal(await lookup({ timeoutMs: 200 })('https://portal.test'), undefined)
    assert.ok(Date.now() - start < 2000)
  })
  it('makes one request for concurrent cold lookups', async () => {
    const issuerOf = lookup()
    const before = probes()
    const answers = await Promise.all([issuerOf('https://portal.test'), issuerOf('https://portal.test')])
    assert.deepEqual(answers, ['https://portal.test/simple-directory', 'https://portal.test/simple-directory'])
    assert.equal(probes() - before, 1)
  })
  it('keeps a found issuer', async () => {
    const issuerOf = lookup()
    await issuerOf('https://portal.test')
    const before = probes()
    site.setDiscovery(404)
    assert.equal(await issuerOf('https://portal.test'), 'https://portal.test/simple-directory')
    assert.equal(probes(), before)
  })
  it('asks again once a missing answer expires', async () => {
    site.setDiscovery(404)
    const issuerOf = lookup({ ttlMs: { found: 60_000, missing: 50 } })
    assert.equal(await issuerOf('https://portal.test'), undefined)
    site.setDiscovery('default')
    assert.equal(await issuerOf('https://portal.test'), undefined, 'still cached')
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.equal(await issuerOf('https://portal.test'), 'https://portal.test/simple-directory')
  })
  it('keeps a bounded number of sites, forgetting the oldest', async () => {
    const issuerOf = lookup({ maxSites: 2 })
    await issuerOf('https://a.test')
    await issuerOf('https://b.test')
    await issuerOf('https://c.test')
    const before = probes()
    await issuerOf('https://c.test')
    assert.equal(probes(), before, 'recent site still cached')
    await issuerOf('https://a.test')
    assert.equal(probes(), before + 1, 'oldest site asked again')
  })
  it('keeps one answer per site', async () => {
    const issuerOf = lookup()
    assert.equal(await issuerOf('https://a.test'), 'https://a.test/simple-directory')
    assert.equal(await issuerOf('https://b.test'), 'https://b.test/simple-directory')
  })
})

describe('protected resource metadata', () => {
  it('points at the metadata under the server mount', () => {
    assert.equal(resourceMetadataUrl('https://portal.test'), 'https://portal.test/mcp-server/.well-known/oauth-protected-resource/mcp')
  })
  it('names the resource, its issuer and its scopes', () => {
    assert.deepEqual(protectedResourceMetadata({ siteOrigin: 'https://portal.test', issuer: 'https://portal.test/simple-directory', scopes: ['datasets:read'] }), {
      resource: 'https://portal.test/mcp-server/mcp',
      authorization_servers: ['https://portal.test/simple-directory'],
      scopes_supported: ['datasets:read'],
      bearer_methods_supported: ['header'],
      resource_name: 'Data Fair (portal.test)'
    })
  })
  it('lists every scope the tools declare, once, sorted', async () => {
    const site = await startFakeSite()
    const platform = await createPlatform({ config: { locale: 'en', docPath: '/data-fair/api/v1/platform/api-docs.json', refreshInterval: 0, extraTools: { geocodeAddress: { active: true } } } as any, dispatcher: createDispatcher({ mainSiteUrl: site.origin }), mainSiteUrl: site.origin })
    try {
      const scopes = scopesSupported(platform.platform(undefined))
      assert.ok(scopes.includes('datasets:read'))
      assert.ok(scopes.includes('datasets:write'))
      assert.deepEqual(scopes, [...new Set(scopes)].sort())
    } finally { platform.close(); await site.close() }
  })
})
