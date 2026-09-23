import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startFakeSite, type FakeSite } from '../test/fake-site.ts'
import { createDispatcher } from './site-fetch.ts'
import { createComposition, type Composition } from './composition.ts'

describe('composition', () => {
  let site: FakeSite
  let composition: Composition
  before(async () => {
    site = await startFakeSite()
    const config: any = { locale: 'en', indexPath: '/data-fair/api/v1/agents/index.json', refreshInterval: 0, extraTools: { geocodeAddress: { active: true, profiles: ['explore'] } } }
    composition = await createComposition({ config, dispatcher: createDispatcher({ mainSiteUrl: site.origin }), mainSiteUrl: site.origin })
  })
  after(async () => { composition.close(); await site.close() })

  it('composes the explore set with prefixes plus geocode_address', async () => {
    const ts = await composition.main(['explore'])
    assert.deepEqual(ts.tools.map(t => t.name), ['datafair_list_datasets', 'datafair_describe_dataset', 'datafair_search_data', 'datafair_get_field_values', 'datafair_aggregate_data', 'datafair_calculate_metric', 'geocode_address'])
    assert.deepEqual(ts.skills.map(s => s.id), ['data-fair/workflow'])
  })
  it('serves the alias with the seven names clients have', async () => {
    const ts = await composition.alias()
    assert.deepEqual(ts.tools.map(t => t.name), ['list_datasets', 'describe_dataset', 'search_data', 'get_field_values', 'aggregate_data', 'calculate_metric', 'geocode_address'])
  })
  it('refuses a profile no service declares instead of serving an empty set', async () => {
    await assert.rejects(composition.main(['nope']), /unknown profile "nope"/)
  })
  it('leaves geocode_address out when the profiles do not intersect its list, or it is inactive', async () => {
    const config: any = { locale: 'en', indexPath: '/data-fair/api/v1/agents/index.json', refreshInterval: 0, extraTools: { geocodeAddress: { active: false, profiles: ['explore'] } } }
    const other = await createComposition({ config, dispatcher: createDispatcher({ mainSiteUrl: site.origin }), mainSiteUrl: site.origin })
    try {
      assert.ok(!(await other.main(['explore'])).tools.some(t => t.name === 'geocode_address'))
    } finally { other.close() }
  })
  it('executes through the caller context: the site origin and identity reach the API', async () => {
    const ts = await composition.main(['explore'])
    const tool = ts.tools.find(t => t.name === 'datafair_list_datasets')!
    const { siteFetch } = await import('./site-fetch.ts')
    const dispatcher = createDispatcher({ mainSiteUrl: site.origin })
    const res = await tool.execute({ q: 'x' }, { fetch: siteFetch(`http://localhost:${site.port}`, { mainSiteUrl: site.origin, dispatcher }), headers: { cookie: 'id_token=abc' } })
    assert.equal(res.isError, undefined)
    assert.match(res.text, /Seen by localhost:\d+/)
    assert.match(res.text, /cookie=id_token=abc/)
  })
  it('refreshes: a changed document is picked up and reported', async () => {
    site.setDoc(doc => { doc.paths['/datasets'].get['x-agent'].name = 'find_datasets' })
    assert.equal(await composition.composer.refresh(), true)
    assert.ok((await composition.main(['explore'])).tools.some(t => t.name === 'datafair_find_datasets'))
    assert.ok(composition.lastRefresh() instanceof Date)
  })
})
