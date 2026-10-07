import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeProfileLists } from './config.ts'

process.env.NODE_CONFIG_DIR = process.cwd() + '/config'

describe('config', () => {
  it('has the composed server defaults', async () => {
    const config = (await import('#config')).default
    assert.equal(config.indexPath, '/data-fair/api/v1/agents/index.json')
    assert.equal(config.refreshInterval, 300)
    assert.equal((config as any).mode, undefined, 'one published server: no mode')
    assert.equal((config as any).publicProfiles, undefined)
    assert.equal(config.upstreamProxyHost, undefined)
    assert.deepEqual(config.extraTools, { geocodeAddress: { active: true, profiles: ['catalog'] } })
    assert.equal(config.observer.port, 9090)
  })

  describe('normalizeProfileLists', () => {
    it('parses a JSON array string for the geocode profiles', () => {
      const config = normalizeProfileLists({ extraTools: { geocodeAddress: { profiles: '["catalog"]' } } })
      assert.deepEqual(config.extraTools!.geocodeAddress!.profiles, ['catalog'])
    })
    it('splits a comma-separated string, trims, and drops empty entries', () => {
      const config = normalizeProfileLists({ extraTools: { geocodeAddress: { profiles: ' catalog, read ,,' } } })
      assert.deepEqual(config.extraTools!.geocodeAddress!.profiles, ['catalog', 'read'])
    })
    it('leaves an already-array value untouched', () => {
      const config = normalizeProfileLists({ extraTools: { geocodeAddress: { profiles: ['catalog'] } } })
      assert.deepEqual(config.extraTools!.geocodeAddress!.profiles, ['catalog'])
    })
  })
})
