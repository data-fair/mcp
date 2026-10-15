import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { startFakeSite, type FakeSite } from '../test/fake-site.ts'
import { createDispatcher } from './site-fetch.ts'
import { createComposition, fileOptions, type Composition } from './composition.ts'

describe('composition', () => {
  let site: FakeSite
  let composition: Composition
  before(async () => {
    site = await startFakeSite()
    const config: any = { locale: 'en', indexPath: '/data-fair/api/v1/agents/index.json', refreshInterval: 0, extraTools: { geocodeAddress: { active: true, profiles: ['catalog'] } } }
    composition = await createComposition({ config, dispatcher: createDispatcher({ mainSiteUrl: site.origin }), mainSiteUrl: site.origin })
  })
  after(async () => { composition.close(); await site.close() })

  it('composes the catalog set with prefixes plus geocode_address', async () => {
    const ts = await composition.main(['catalog'])
    assert.deepEqual(ts.tools.map(t => t.name), ['datafair_list_datasets', 'datafair_describe_dataset', 'datafair_search_data', 'datafair_get_field_values', 'datafair_aggregate_data', 'datafair_calculate_metric', 'geocode_address'])
    assert.deepEqual(ts.skills.map(s => s.id), ['data-fair/workflow'])
    assert.equal(ts.skills[0].error, undefined, 'the linked workflow skill is served by the site')
    assert.deepEqual(composition.composer.services.map(s => [s.id, s.status, s.warnings]), [['data-fair', 'ok', undefined]])
  })
  it('serves the alias with the seven names clients have', async () => {
    const ts = await composition.alias()
    assert.deepEqual(ts.tools.map(t => t.name), ['list_datasets', 'describe_dataset', 'search_data', 'get_field_values', 'aggregate_data', 'calculate_metric', 'geocode_address'])
  })
  it('composes the grid umbrellas with the account tools', async () => {
    const names = (await composition.main(['manage'])).tools.map(t => t.name)
    assert.ok(names.includes('datafair_list_account_datasets'))
    assert.ok(names.includes('datafair_publish_dataset'))
    assert.ok(!names.includes('geocode_address'), 'geocode_address joins catalog sets only')
  })
  it('refuses a profile no service declares instead of serving an empty set', async () => {
    await assert.rejects(composition.main(['nope']), /unknown profile "nope"/)
  })
  it('leaves geocode_address out when the profiles do not intersect its list, or it is inactive', async () => {
    const config: any = { locale: 'en', indexPath: '/data-fair/api/v1/agents/index.json', refreshInterval: 0, extraTools: { geocodeAddress: { active: false, profiles: ['catalog'] } } }
    const other = await createComposition({ config, dispatcher: createDispatcher({ mainSiteUrl: site.origin }), mainSiteUrl: site.origin })
    try {
      assert.ok(!(await other.main(['catalog'])).tools.some(t => t.name === 'geocode_address'))
    } finally { other.close() }
  })
  it('executes through the caller context: the site origin and identity reach the API', async () => {
    const ts = await composition.main(['catalog'])
    const tool = ts.tools.find(t => t.name === 'datafair_list_datasets')!
    const { siteFetch } = await import('./site-fetch.ts')
    const dispatcher = createDispatcher({ mainSiteUrl: site.origin })
    const res = await tool.execute({ q: 'x' }, { fetch: siteFetch(`http://localhost:${site.port}`, { mainSiteUrl: site.origin, dispatcher }), headers: { cookie: 'id_token=abc' } })
    assert.equal(res.isError, undefined)
    assert.match(res.text, /Seen by localhost:\d+/)
    assert.match(res.text, /cookie=id_token=abc/)
    assert.ok(site.hits.some(h => h.url.startsWith('/data-fair/api/v1/catalog/datasets')), 'the catalog listing is the portal-scoped route')
  })
  it('returns structured content and publishes no output schema', async () => {
    const ts = await composition.main(['manage'])
    for (const t of ts.tools) assert.equal(t.outputSchema, undefined, t.name)
    const res = await ts.tools.find(t => t.name === 'datafair_list_account_datasets')!.execute({})
    assert.equal((res.structuredContent as any).count, 1)
  })
  it('offers no upload tool without a file store, and the download tools regardless', async () => {
    const names = (await composition.main(['write'])).tools.map(t => t.name)
    for (const name of ['datafair_create_dataset_from_file', 'datafair_replace_dataset_file']) assert.ok(!names.includes(name), name)
    for (const name of ['datafair_download_dataset_file', 'datafair_download_dataset_converted_file', 'datafair_export_data']) assert.ok(names.includes(name), name)
  })
  it('refuses a file prefix without a scheme at boot', async () => {
    const config: any = { locale: 'en', indexPath: '/data-fair/api/v1/agents/index.json', refreshInterval: 0, extraTools: { geocodeAddress: { active: false, profiles: ['catalog'] } }, files: { urlPrefixes: ['s3.example.com/agents/'] } }
    await assert.rejects(createComposition({ config, dispatcher: createDispatcher({ mainSiteUrl: site.origin }), mainSiteUrl: site.origin }))
  })
  it('converts the configured timeout from seconds', () => {
    assert.deepEqual(fileOptions({ urlPrefixes: ['https://s3.test/b/'], timeout: 2 }), { urlPrefixes: ['https://s3.test/b/'], maxSize: undefined, timeout: 2000 })
    assert.deepEqual(fileOptions(undefined), { urlPrefixes: [], maxSize: undefined, timeout: undefined })
  })
  it('uploads a file from the store through the site, with an exact length and none of the caller credentials sent to the store', async () => {
    const storeHeaders: Record<string, string | string[] | undefined>[] = []
    const store = createServer((req, res) => {
      storeHeaders.push(req.headers)
      res.writeHead(200, { 'content-type': 'text/csv', 'content-length': 8 })
      res.end('a,b\n1,2\n')
    })
    await new Promise<void>(resolve => store.listen(0, '127.0.0.1', resolve))
    const storeOrigin = `http://127.0.0.1:${(store.address() as any).port}`
    const config: any = { locale: 'en', indexPath: '/data-fair/api/v1/agents/index.json', refreshInterval: 0, extraTools: { geocodeAddress: { active: false, profiles: ['catalog'] } }, files: { urlPrefixes: [`${storeOrigin}/agent-files/`] } }
    const dispatcher = createDispatcher({ mainSiteUrl: site.origin })
    const withFiles = await createComposition({ config, dispatcher, mainSiteUrl: site.origin })
    try {
      const tool = (await withFiles.main(['write'])).tools.find(t => t.name === 'datafair_create_dataset_from_file')
      assert.ok(tool, 'offered once a file store is configured')
      assert.ok(tool.inputSchema.properties.file['x-mcp-file'])
      const { siteFetch } = await import('./site-fetch.ts')
      const res = await tool.execute({ file: `${storeOrigin}/agent-files/report.csv?X-Amz-Signature=sig`, title: 'Report' }, {
        fetch: siteFetch(site.origin, { mainSiteUrl: site.origin, dispatcher, trustedForwarder: 'secret' }),
        headers: { cookie: 'id_token=abc', 'x-apikey': 'key' }
      })
      assert.equal(res.isError, undefined, res.text)
      const upload = site.uploads.at(-1)!
      assert.equal(Number(upload.headers['content-length']), upload.body.length, 'an exact Content-Length')
      assert.equal(upload.headers['transfer-encoding'], undefined, 'never chunked: data-fair answers 411')
      assert.equal(upload.headers.cookie, 'id_token=abc', 'the caller identity reaches the API')
      assert.match(upload.body.toString(), /filename="report.csv"/)
      assert.match(upload.body.toString(), /a,b\n1,2\n/)
      assert.equal(storeHeaders.length, 1)
      for (const name of ['cookie', 'x-apikey', 'x-trusted-forwarder', 'authorization']) assert.equal(storeHeaders[0][name], undefined, `${name} never reaches the file store`)
    } finally {
      withFiles.close()
      store.close()
    }
  })
  it('refreshes: a changed document is picked up and reported', async () => {
    site.setDoc(doc => { doc.paths['/catalog/datasets'].get['x-agent'].name = 'find_datasets' })
    assert.equal(await composition.composer.refresh(), true)
    assert.ok((await composition.main(['catalog'])).tools.some(t => t.name === 'datafair_find_datasets'))
    assert.ok(composition.lastRefresh() instanceof Date)
  })
})
