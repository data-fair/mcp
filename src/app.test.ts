import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { startFakeSite, type FakeSite } from '../test/fake-site.ts'
import { bearerFor, cookieFor, nhiClaims, USER } from '../test/tokens.ts'
import config from '#config'
import type { Runtime } from './server.ts'

const PROXY = { 'x-forwarded-host': 'portal.test', 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.7' }
const DATASETS_NAMES = ['list_datasets', 'describe_dataset', 'search_data', 'get_field_values', 'aggregate_data', 'calculate_metric', 'geocode_address']

describe('app', () => {
  let site: FakeSite, store: Server, storeOrigin: string, http: Server, base: string, runtime: Runtime
  const storeHeaders: Record<string, string | string[] | undefined>[] = []
  const connect = async (path: string, headers: Record<string, string> = {}, options: ConstructorParameters<typeof Client>[1] = {}) => {
    const client = new Client({ name: 'c', version: '0' }, { versionNegotiation: { mode: 'auto' }, ...options })
    await client.connect(new StreamableHTTPClientTransport(new URL(base + path), { requestInit: { headers } }))
    return client
  }
  const names = async (path: string, headers: Record<string, string> = PROXY) => {
    const client = await connect(path, headers)
    try { return (await client.listTools()).tools.map(t => t.name) } finally { await client.close() }
  }
  const listen = async (handler: (req: IncomingMessage, res: ServerResponse) => void) => {
    const server = createServer(handler)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    return { server, origin: `http://127.0.0.1:${(server.address() as any).port}` }
  }
  const configure = (files: string[]) => Object.assign(config, {
    mainSiteUrl: site.origin,
    portalUrl: undefined,
    privateDirectoryUrl: site.origin + '/simple-directory',
    refreshInterval: 0,
    trustedForwarder: 'secret',
    upstreamProxyHost: `127.0.0.1:${site.port}`,
    extraTools: { ...config.extraTools, geocodeAddress: { ...config.extraTools.geocodeAddress, active: true } },
    files: { urlPrefixes: files }
  })

  before(async () => {
    site = await startFakeSite();
    ({ server: store, origin: storeOrigin } = await listen((req, res) => {
      storeHeaders.push(req.headers)
      res.writeHead(200, { 'content-type': 'text/csv', 'content-length': 8 })
      res.end('a,b\n1,2\n')
    }))
    configure([`${storeOrigin}/agent-files/`])
    const { createRuntime } = await import('./server.ts')
    runtime = await createRuntime(config);
    ({ server: http, origin: base } = await listen(runtime.app))
  })
  after(async () => { runtime.platform.close(); http.close(); store.close(); await site.close() })

  it('refuses /mcp without credentials', async () => {
    const res = await fetch(`${base}/mcp-server/mcp`, { method: 'POST', headers: { ...PROXY, 'content-type': 'application/json' }, body: '{}' })
    assert.equal(res.status, 401)
  })
  it('serves /mcp to an unscoped session and calls the requesting site with its identity', async () => {
    const cookie = cookieFor(USER)
    const client = await connect('/mcp-server/mcp', { ...PROXY, cookie })
    try {
      const { tools } = await client.listTools()
      assert.match(tools[0].name, /^datafair_/)
      assert.ok(tools.some(t => t.name === 'geocode_address'))
      assert.ok(tools.some(t => t.name === 'datafair_update_dataset'), 'unscoped: every tool')
      const res: any = await client.callTool({ name: 'datafair_list_datasets', arguments: {} })
      assert.equal(res.isError, undefined, res.content[0].text)
      assert.match(res.content[0].text, /cookie=id_token=/, 'the identity reaches the API')
      assert.match(res.content[0].text, /Seen by portal\.test/, 'the call goes to the requesting site')
      const hit = site.hits.at(-1)!
      assert.equal(hit.headers.referer, 'https://portal.test/mcp')
      assert.equal(hit.headers['x-trusted-forwarder'], 'secret')
      assert.equal(hit.headers['x-forwarded-host'], 'portal.test')
      assert.equal(hit.headers.cookie, cookie)
    } finally { await client.close() }
  })
  it('cuts /mcp by the bearer\'s scopes and forwards the bearer', async () => {
    const authorization = 'Bearer ' + bearerFor(nhiClaims('datasets:read', 'https://portal.test'))
    const client = await connect('/mcp-server/mcp', { ...PROXY, authorization })
    try {
      const tools = (await client.listTools()).tools.map(t => t.name)
      assert.ok(tools.includes('datafair_list_datasets'))
      assert.ok(!tools.includes('datafair_update_dataset'))
      assert.ok(tools.includes('geocode_address'))
      const res: any = await client.callTool({ name: 'datafair_list_datasets', arguments: {} })
      assert.equal(res.isError, undefined, res.content[0].text)
      assert.equal(site.hits.at(-1)!.headers.authorization, authorization)
    } finally { await client.close() }
  })
  it('refuses a bearer addressed to another site on /mcp', async () => {
    const authorization = 'Bearer ' + bearerFor(nhiClaims('datasets:read', 'https://other.test'))
    await assert.rejects(names('/mcp-server/mcp', { ...PROXY, authorization }))
  })
  it('serves the datasets server anonymously with its seven names', async () => {
    assert.deepEqual(await names('/mcp-server/datasets/mcp'), DATASETS_NAMES)
  })
  it('cuts the datasets server by scopes too', async () => {
    const authorization = 'Bearer ' + bearerFor(nhiClaims('applications:read', 'https://portal.test'))
    assert.deepEqual(await names('/mcp-server/datasets/mcp', { ...PROXY, authorization }), ['geocode_address'])
  })
  it('serves the datasets server anonymously to a credential that does not verify', async () => {
    const authorization = 'Bearer ' + bearerFor(nhiClaims('applications:read', 'https://other.test'))
    assert.deepEqual(await names('/mcp-server/datasets/mcp', { ...PROXY, authorization }), DATASETS_NAMES)
  })
  it('serves an in-cluster caller on the main site', async () => {
    const client = await connect('/mcp', { 'x-apikey': 'key' })
    try {
      const res: any = await client.callTool({ name: 'datafair_list_datasets', arguments: {} })
      assert.match(res.content[0].text, /Seen by 127\.0\.0\.1:\d+/)
      assert.match(res.content[0].text, /apikey=key/)
    } finally { await client.close() }
  })
  it('hands out file links on the site the call came through', async () => {
    const onPortal = await connect('/mcp-server/mcp', { ...PROXY, cookie: cookieFor(USER) })
    try {
      const res: any = await onPortal.callTool({ name: 'datafair_download_dataset_file', arguments: { datasetId: 'ds1' } })
      const link = res.content.find((c: any) => c.type === 'resource_link')
      assert.equal(link.uri, 'https://portal.test/data-fair/api/v1/datasets/ds1/raw')
      assert.ok(res.content[0].text.includes('https://portal.test/data-fair/api/v1/datasets/ds1/raw'))
      assert.ok(!res.content[0].text.includes(site.origin), 'no main-site URL left in the text')
    } finally { await onPortal.close() }
    const inCluster = await connect('/mcp', { 'x-apikey': 'key' })
    try {
      const res: any = await inCluster.callTool({ name: 'datafair_download_dataset_file', arguments: { datasetId: 'ds1' } })
      assert.equal(res.content.find((c: any) => c.type === 'resource_link').uri, `${site.origin}/data-fair/api/v1/datasets/ds1/raw`)
    } finally { await inCluster.close() }
  })
  it('uploads a file from the store through the site, with an exact length and none of the caller credentials sent to the store', async () => {
    const cookie = cookieFor(USER)
    const client = await connect('/mcp-server/mcp', { ...PROXY, cookie })
    try {
      const tool = (await client.listTools()).tools.find(t => t.name === 'datafair_create_dataset_from_file')
      assert.ok(tool, 'offered once a file store is configured')
      const before = storeHeaders.length
      const res: any = await client.callTool({ name: 'datafair_create_dataset_from_file', arguments: { file: `${storeOrigin}/agent-files/report.csv?X-Amz-Signature=sig`, title: 'Report' } })
      assert.equal(res.isError, undefined, res.content[0].text)
      const upload = site.uploads.at(-1)!
      assert.equal(Number(upload.headers['content-length']), upload.body.length, 'an exact Content-Length')
      assert.equal(upload.headers['transfer-encoding'], undefined, 'never chunked: data-fair answers 411')
      assert.equal(upload.headers.cookie, cookie, 'the caller identity reaches the API')
      assert.equal(upload.headers['x-forwarded-host'], 'portal.test', 'through the requesting site')
      assert.match(upload.body.toString(), /filename="report.csv"/)
      assert.match(upload.body.toString(), /a,b\n1,2\n/)
      assert.equal(storeHeaders.length, before + 1)
      for (const name of ['cookie', 'x-apikey', 'x-trusted-forwarder', 'authorization']) assert.equal(storeHeaders.at(-1)![name], undefined, `${name} never reaches the file store`)
    } finally { await client.close() }
  })
  it('offers no upload tool without a file store, and the download tools regardless', async () => {
    configure([])
    const { createRuntime } = await import('./server.ts')
    const other = await createRuntime(config)
    const { server, origin } = await listen(other.app)
    try {
      const client = new Client({ name: 'c', version: '0' }, { versionNegotiation: { mode: 'auto' } })
      await client.connect(new StreamableHTTPClientTransport(new URL(origin + '/mcp-server/mcp'), { requestInit: { headers: { ...PROXY, cookie: cookieFor(USER) } } }))
      const tools = (await client.listTools()).tools.map(t => t.name)
      await client.close()
      for (const name of ['datafair_create_dataset_from_file', 'datafair_replace_dataset_file']) assert.ok(!tools.includes(name), name)
      for (const name of ['datafair_download_dataset_file', 'datafair_download_dataset_converted_file', 'datafair_export_data']) assert.ok(tools.includes(name), name)
    } finally {
      other.platform.close()
      server.close()
      configure([`${storeOrigin}/agent-files/`])
    }
  })
  it('notifies tools/list_changed after a document change', async () => {
    let resolveChanged: () => void
    const changed = new Promise<void>(resolve => { resolveChanged = resolve })
    const client = await connect('/mcp-server/datasets/mcp', PROXY, { listChanged: { tools: { autoRefresh: false, debounceMs: 0, onChanged: () => resolveChanged() } } })
    try {
      await client.listTools()
      site.setDoc(doc => { delete doc.paths['/data-fair/api/v1/datasets/{id}/metric_agg'].get['x-agent'] })
      assert.equal(await runtime.platform.refresh(), true)
      await Promise.race([changed, new Promise((_resolve, reject) => setTimeout(() => reject(new Error('no tools/list_changed')), 2000))])
      assert.ok(!(await client.listTools()).tools.some(t => t.name === 'calculate_metric'))
    } finally { await client.close() }
  })
  it('publishes the datasets server card in the AI catalog', async () => {
    const res = await fetch(`${base}/mcp-server/ai-catalog.json`, { headers: PROXY })
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /^application\/ai-catalog\+json/)
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
    assert.equal(res.headers.get('vary'), 'X-Forwarded-Host')
    const doc: any = await res.json()
    assert.equal(doc.specVersion, '1.0')
    assert.equal(doc.entries.length, 1)
    assert.equal(doc.entries[0].type, 'application/mcp-server-card+json')
    assert.equal(doc.entries[0].identifier, 'urn:air:portal.test:mcp:datasets')
    const card = doc.entries[0].data
    assert.equal(card.$schema, 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json')
    assert.equal(card.name, 'fr.data-fair/datasets')
    assert.ok(card.description)
    assert.deepEqual(card.remotes, [{ type: 'streamable-http', url: 'https://portal.test/mcp-server/datasets/mcp' }])
  })
  it('no longer serves /profiles nor /v0/servers', async () => {
    for (const path of ['/mcp-server/profiles', '/mcp-server/v0/servers']) {
      assert.equal((await fetch(base + path, { headers: PROXY })).status, 404, path)
    }
  })
  it('keeps /status for in-cluster callers', async () => {
    assert.equal((await fetch(`${base}/mcp-server/status`, { headers: PROXY })).status, 421)
    const status: any = await (await fetch(`${base}/status`)).json()
    assert.equal(status.mainSiteUrl, site.origin)
    assert.deepEqual(status.services.map((s: any) => s.id), ['datafair'])
    assert.ok(Array.isArray(status.missingDatasetsTools))
    assert.ok(status.extraTools)
  })
  it('sets the CORS allow-headers clients need for the session id, the API key and a bearer', async () => {
    const res = await fetch(`${base}/mcp-server/mcp`, { method: 'OPTIONS' })
    assert.equal(res.status, 204)
    const allow = res.headers.get('access-control-allow-headers') ?? ''
    assert.match(allow, /x-apiKey/)
    assert.match(allow, /Mcp-Session-Id/)
    assert.match(allow, /Authorization/)
  })
})
