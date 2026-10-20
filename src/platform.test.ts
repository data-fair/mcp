import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startFakeSite, type FakeSite } from '../test/fake-site.ts'
import { createDispatcher } from './site-fetch.ts'
import { createPlatform, fileOptions, type Platform } from './platform.ts'

const METRIC = '/data-fair/api/v1/datasets/{id}/metric_agg'
const names = (ts: { tools: { name: string }[] }) => ts.tools.map(t => t.name)
const configFor = (extra: object = {}): any => ({ locale: 'en', docPath: '/data-fair/api/v1/platform/api-docs.json', refreshInterval: 0, extraTools: { geocodeAddress: { active: true } }, ...extra })

describe('platform', () => {
  let site: FakeSite
  let platform: Platform
  before(async () => {
    site = await startFakeSite()
    platform = await createPlatform({ config: configFor(), dispatcher: createDispatcher({ mainSiteUrl: site.origin }), mainSiteUrl: site.origin })
  })
  after(async () => { platform.close(); await site.close() })

  it('serves every tool and geocode_address to an unscoped caller', () => {
    const tools = names(platform.platform(undefined))
    assert.ok(tools.includes('datafair_publish_dataset'))
    assert.equal(tools.at(-1), 'geocode_address')
  })
  it('cuts the platform set by scopes', () => {
    const tools = names(platform.platform(['datasets:read']))
    assert.ok(tools.includes('datafair_list_account_datasets'))
    assert.ok(!tools.includes('datafair_update_dataset'))
    assert.ok(tools.includes('geocode_address'))
  })
  it('separates update and publish by tier', () => {
    const write = names(platform.platform(['datasets:write']))
    assert.ok(write.includes('datafair_update_dataset'))
    assert.ok(!write.includes('datafair_publish_dataset'))
    const admin = names(platform.platform(['datasets:admin']))
    assert.ok(admin.includes('datafair_update_dataset'))
    assert.ok(admin.includes('datafair_publish_dataset'))
  })
  it('serves the datasets names, geocode_address last', () => {
    assert.deepEqual(names(platform.datasets(undefined)), ['list_datasets', 'describe_dataset', 'search_data', 'get_field_values', 'aggregate_data', 'calculate_metric', 'geocode_address'])
    assert.deepEqual(names(platform.datasets(['datasets:read'])), names(platform.datasets(undefined)))
  })
  it('gives a token without datasets scopes only geocode_address on datasets', () => {
    assert.deepEqual(names(platform.datasets(['applications:read'])), ['geocode_address'])
  })
  it('strips output schemas', () => {
    for (const t of [...platform.platform(undefined).tools, ...platform.datasets(undefined).tools]) assert.equal(t.outputSchema, undefined, t.name)
  })
  it('reports the services of the document', () => {
    const status = platform.status()
    assert.deepEqual((status.services as any[]).map(s => s.id), ['datafair'])
    assert.equal(status.error, undefined)
    assert.deepEqual(status.missingDatasetsTools, [])
  })
  it('rebuilds and notifies after a document change', async () => {
    let notified = 0
    const off = platform.onChange(() => { notified++ })
    try {
      site.setDoc(doc => { delete doc.paths[METRIC].get['x-agent'] })
      assert.equal(await platform.refresh(), true)
      assert.equal(notified, 1)
      assert.ok(!names(platform.datasets(undefined)).includes('calculate_metric'))
      assert.ok(!names(platform.platform(undefined)).includes('datafair_calculate_metric'))
      assert.deepEqual(platform.status().missingDatasetsTools, ['calculate_metric'])
      assert.ok(platform.status().lastRefresh instanceof Date)
    } finally { off() }
  })
  it('keeps the tools when a reload fails', async () => {
    const before = names(platform.platform(undefined))
    site.failDoc(500)
    try {
      assert.equal(await platform.refresh(), false)
      assert.deepEqual(names(platform.platform(undefined)), before)
      assert.match(platform.status().error ?? '', /HTTP 500/)
    } finally { site.failDoc(undefined) }
  })
  it('fails to start when the first load fails', async () => {
    site.failDoc(500)
    try {
      await assert.rejects(createPlatform({ config: configFor(), dispatcher: createDispatcher({ mainSiteUrl: site.origin }), mainSiteUrl: site.origin }))
    } finally { site.failDoc(undefined) }
  })
  it('leaves geocode_address out when it is inactive', async () => {
    const other = await createPlatform({ config: configFor({ extraTools: { geocodeAddress: { active: false } } }), dispatcher: createDispatcher({ mainSiteUrl: site.origin }), mainSiteUrl: site.origin })
    try {
      assert.ok(!names(other.platform(undefined)).includes('geocode_address'))
      assert.ok(!names(other.datasets(undefined)).includes('geocode_address'))
    } finally { other.close() }
  })
  it('refuses a file prefix without a scheme at boot', async () => {
    await assert.rejects(createPlatform({ config: configFor({ files: { urlPrefixes: ['s3.example.com/agents/'] } }), dispatcher: createDispatcher({ mainSiteUrl: site.origin }), mainSiteUrl: site.origin }), /is not a URL/)
  })
  it('converts the configured timeout from seconds', () => {
    assert.deepEqual(fileOptions({ urlPrefixes: ['https://s3.test/b/'], timeout: 2 }), { urlPrefixes: ['https://s3.test/b/'], maxSize: undefined, timeout: 2000 })
    assert.deepEqual(fileOptions(undefined), { urlPrefixes: [], maxSize: undefined, timeout: undefined })
  })
})
