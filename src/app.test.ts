import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { startFakeSite, type FakeSite } from '../test/fake-site.ts'
import config from '#config'

const PROXY = { 'x-forwarded-host': 'portal.test', 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.7' }

describe('app', () => {
  let site: FakeSite, http: Server, base: string
  const boot = async (mode: 'public' | 'internal') => {
    Object.assign(config, { mode, mainSiteUrl: site.origin, refreshInterval: 0, ignoreRateLimiting: 'secret', publicProfiles: ['explore'], upstreamProxyHost: mode === 'public' ? `127.0.0.1:${site.port}` : undefined })
    const { createDispatcher } = await import('./site-fetch.ts')
    const { createComposition } = await import('./composition.ts')
    const { createApp } = await import('./app.ts')
    const dispatcher = createDispatcher({ mainSiteUrl: site.origin, upstreamProxyHost: config.upstreamProxyHost })
    const composition = await createComposition({ config, dispatcher, mainSiteUrl: site.origin })
    http = createServer(createApp(composition, dispatcher))
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(http.address() as any).port}`
  }
  const connect = async (path: string, headers: Record<string, string> = {}) => {
    const client = new Client({ name: 'c', version: '0' }, { versionNegotiation: { mode: 'auto' } })
    await client.connect(new StreamableHTTPClientTransport(new URL(base + path), { requestInit: { headers } }))
    return client
  }
  before(async () => { site = await startFakeSite() })
  after(async () => { await site.close() })

  describe('public mode', () => {
    before(() => boot('public'))
    after(() => http.close())

    it('serves the composed set at /mcp-server/mcp and calls the requesting site with the caller identity', async () => {
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
    it('serves the alias at /mcp-server/datasets/mcp with the seven names', async () => {
      const client = await connect('/mcp-server/datasets/mcp', PROXY)
      assert.deepEqual((await client.listTools()).tools.map(t => t.name), ['list_datasets', 'describe_dataset', 'search_data', 'get_field_values', 'aggregate_data', 'calculate_metric', 'geocode_address'])
      await client.close()
    })
    it('refuses a non-public profile with 403, whatever the headers', async () => {
      for (const headers of [PROXY, {}]) {
        const res = await fetch(`${base}/mcp-server/mcp?profiles=edit`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' })
        assert.equal(res.status, 403)
      }
    })
    it('does not let empty/blank profiles entries fall through the gate', async () => {
      const saved = config.publicProfiles
      config.publicProfiles = []
      try {
        for (const q of ['profiles=,,', 'profiles=%20,%20']) {
          const res = await fetch(`${base}/mcp-server/mcp?${q}`, { method: 'POST', headers: { ...PROXY, 'content-type': 'application/json' }, body: '{}' })
          assert.equal(res.status, 403)
        }
      } finally { config.publicProfiles = saved }
    })
    it('refuses a repeated profiles parameter with 403, not a 500', async () => {
      const res = await fetch(`${base}/mcp-server/mcp?profiles=explore&profiles=edit`, { method: 'POST', headers: { ...PROXY, 'content-type': 'application/json' }, body: '{}' })
      assert.equal(res.status, 403)
    })
    it('ignores profiles on the alias route: /datasets/mcp?profiles=edit still serves the seven names', async () => {
      const client = await connect('/mcp-server/datasets/mcp?profiles=edit', PROXY)
      assert.deepEqual((await client.listTools()).tools.map(t => t.name), ['list_datasets', 'describe_dataset', 'search_data', 'get_field_values', 'aggregate_data', 'calculate_metric', 'geocode_address'])
      await client.close()
    })
    it('lists only public profiles in the registry and keeps /status internal', async () => {
      const res = await fetch(`${base}/mcp-server/v0/servers`, { headers: PROXY })
      assert.equal(res.headers.get('vary'), 'X-Forwarded-Host')
      const reg: any = await res.json()
      assert.deepEqual(reg.servers.map((s: any) => s.server.name), ['fr.data-fair/explore'])
      assert.equal(reg.servers[0].server.remotes[0].url, 'https://portal.test/mcp-server/mcp?profiles=explore')
      assert.equal((await fetch(`${base}/mcp-server/status`, { headers: PROXY })).status, 421)
    })
    it('answers a proxied caller to /status and /v0/servers with the ordinary status, not a 500', async () => {
      // a proxied request (X-Forwarded-Host present) is not internal: /status still refuses it,
      // but the limiter itself must not throw building the rate-limit key
      assert.equal((await fetch(`${base}/mcp-server/status`, { headers: PROXY })).status, 421)
      assert.equal((await fetch(`${base}/mcp-server/v0/servers`, { headers: PROXY })).status, 200)
    })
    it('lets an internal caller (no forwarded headers) reach /status and /v0/servers instead of 500ing on the rate limiter', async () => {
      assert.equal((await fetch(`${base}/mcp-server/status`)).status, 200)
      assert.equal((await fetch(`${base}/mcp-server/v0/servers`)).status, 200)
    })
    it('sets the CORS allow-headers clients need for the session id and the API key', async () => {
      const res = await fetch(`${base}/mcp-server/mcp`, { method: 'OPTIONS' })
      const allow = res.headers.get('access-control-allow-headers') ?? ''
      assert.match(allow, /x-apiKey/)
      assert.match(allow, /Mcp-Session-Id/)
    })
    it('rate-limits per IP', async () => {
      const before = config.defaultLimits.apiRate!.nb
      config.defaultLimits.apiRate!.nb = 1
      try {
        const h = { ...PROXY, 'x-forwarded-for': '198.51.100.9' }
        await fetch(`${base}/mcp-server/v0/servers`, { headers: h })
        assert.equal((await fetch(`${base}/mcp-server/v0/servers`, { headers: h })).status, 429)
      } finally { config.defaultLimits.apiRate!.nb = before }
    })
  })

  describe('internal mode', () => {
    before(() => boot('internal'))
    after(() => http.close())

    it('serves any declared profile without forwarded headers, keeps the main site, and opens /status', async () => {
      const client = await connect('/mcp?profiles=explore')
      const res: any = await client.callTool({ name: 'datafair_list_datasets', arguments: {} })
      assert.match(res.content[0].text, /Seen by 127\.0\.0\.1:\d+/)
      await client.close()
      const status: any = await (await fetch(`${base}/status`)).json()
      assert.deepEqual(status.services.map((s: any) => s.id), ['data-fair'])
      const reg: any = await (await fetch(`${base}/v0/servers`)).json()
      assert.ok(reg.servers.length >= 1)
    })
    it('still refuses an undeclared profile', async () => {
      await assert.rejects(async () => { const c = await connect('/mcp?profiles=nope'); await c.listTools() })
    })
  })
})
