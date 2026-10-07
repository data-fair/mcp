import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { startFakeSite, type FakeSite } from '../test/fake-site.ts'
import config from '#config'

const PROXY = { 'x-forwarded-host': 'portal.test', 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.7' }

describe('app', () => {
  let site: FakeSite, http: Server, base: string
  const connect = async (path: string, headers: Record<string, string> = {}) => {
    const client = new Client({ name: 'c', version: '0' }, { versionNegotiation: { mode: 'auto' } })
    await client.connect(new StreamableHTTPClientTransport(new URL(base + path), { requestInit: { headers } }))
    return client
  }
  const names = async (path: string, headers: Record<string, string> = PROXY) => {
    const client = await connect(path, headers)
    try { return (await client.listTools()).tools.map(t => t.name) } finally { await client.close() }
  }
  before(async () => {
    site = await startFakeSite()
    Object.assign(config, { mainSiteUrl: site.origin, refreshInterval: 0, ignoreRateLimiting: 'secret', upstreamProxyHost: `127.0.0.1:${site.port}` })
    const { createDispatcher } = await import('./site-fetch.ts')
    const { createComposition } = await import('./composition.ts')
    const { createApp } = await import('./app.ts')
    const dispatcher = createDispatcher({ mainSiteUrl: site.origin, upstreamProxyHost: config.upstreamProxyHost })
    const composition = await createComposition({ config, dispatcher, mainSiteUrl: site.origin })
    http = createServer(createApp(composition, dispatcher))
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(http.address() as any).port}`
  })
  after(async () => { http.close(); await site.close() })

  it('serves the catalog set by default and calls the requesting site with the caller identity', async () => {
    const client = await connect('/mcp-server/mcp', { ...PROXY, cookie: 'id_token=abc' })
    const { tools } = await client.listTools()
    assert.equal(tools[0].name, 'datafair_list_datasets')
    assert.ok(tools.some(t => t.name === 'geocode_address'))
    const res: any = await client.callTool({ name: 'datafair_list_datasets', arguments: {} })
    assert.match(res.content[0].text, /cookie=id_token=abc/)
    const hit = site.hits.at(-1)!
    assert.equal(hit.headers.referer, 'https://portal.test/mcp')
    assert.equal(hit.headers['x-ignore-rate-limiting'], 'secret')
    assert.equal(hit.headers['x-forwarded-host'], 'portal.test')
    await client.close()
  })
  it('serves explore to clients still configured with it', async () => {
    assert.deepEqual(await names('/mcp-server/mcp?profiles=explore'), await names('/mcp-server/mcp?profiles=catalog'))
  })
  it('serves the grid to any caller: what it may do is data-fair permissions on its identity', async () => {
    const tools = await names('/mcp-server/mcp?profiles=read')
    assert.ok(tools.includes('datafair_list_account_datasets'))
    const both = await names('/mcp-server/mcp?profiles=catalog,read')
    assert.ok(both.includes('datafair_list_datasets') && both.includes('datafair_list_account_datasets'), 'catalog and the grid combine')
  })
  it('refuses an undeclared profile, including when repeated or blank-padded', async () => {
    for (const q of ['profiles=nope', 'profiles=catalog&profiles=nope', 'profiles=%20nope%20']) {
      await assert.rejects(async () => { await names(`/mcp-server/mcp?${q}`) }, q)
    }
  })
  it('serves an in-cluster caller (no forwarded headers) on the main site', async () => {
    const client = await connect('/mcp?profiles=catalog')
    const res: any = await client.callTool({ name: 'datafair_list_datasets', arguments: {} })
    assert.match(res.content[0].text, /Seen by 127\.0\.0\.1:\d+/)
    await client.close()
  })
  it('serves the alias at /mcp-server/datasets/mcp with the seven names, whatever the profiles', async () => {
    for (const path of ['/mcp-server/datasets/mcp', '/mcp-server/datasets/mcp?profiles=manage']) {
      assert.deepEqual(await names(path), ['list_datasets', 'describe_dataset', 'search_data', 'get_field_values', 'aggregate_data', 'calculate_metric', 'geocode_address'], path)
    }
  })
  it('keeps /status for in-cluster callers', async () => {
    assert.equal((await fetch(`${base}/mcp-server/status`, { headers: PROXY })).status, 421)
    const status: any = await (await fetch(`${base}/status`)).json()
    assert.deepEqual(status.services.map((s: any) => s.id), ['data-fair'])
    assert.equal(status.mode, undefined)
  })
  it('answers /v0/servers to proxied and in-cluster callers', async () => {
    const res = await fetch(`${base}/mcp-server/v0/servers`, { headers: PROXY })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('vary'), 'X-Forwarded-Host')
    assert.equal((await fetch(`${base}/mcp-server/v0/servers`)).status, 200)
  })
  it('sets the CORS allow-headers clients need for the session id and the API key', async () => {
    const res = await fetch(`${base}/mcp-server/mcp`, { method: 'OPTIONS' })
    const allow = res.headers.get('access-control-allow-headers') ?? ''
    assert.match(allow, /x-apiKey/)
    assert.match(allow, /Mcp-Session-Id/)
  })
  it('limits a proxied caller without X-Forwarded-For by its socket address instead of failing', async () => {
    const res = await fetch(`${base}/mcp-server/v0/servers`, { headers: { 'x-forwarded-host': 'portal.test', 'x-forwarded-proto': 'https' } })
    assert.equal(res.status, 200)
  })
  it('rate-limits anonymous callers per IP', async () => {
    const before = config.defaultLimits.apiRate!.nb
    config.defaultLimits.apiRate!.nb = 1
    try {
      const h = { ...PROXY, 'x-forwarded-for': '198.51.100.9' }
      await fetch(`${base}/mcp-server/v0/servers`, { headers: h })
      assert.equal((await fetch(`${base}/mcp-server/v0/servers`, { headers: h })).status, 429)
    } finally { config.defaultLimits.apiRate!.nb = before }
  })
})
