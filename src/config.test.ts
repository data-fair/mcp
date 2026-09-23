import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeProfileLists } from './config.ts'

process.env.NODE_CONFIG_DIR = process.cwd() + '/config'

describe('config', () => {
  it('has the composed server defaults', async () => {
    const config = (await import('#config')).default
    assert.equal(config.mode, 'public')
    assert.equal(config.indexPath, '/data-fair/api/v1/agents/index.json')
    assert.equal(config.refreshInterval, 300)
    assert.deepEqual(config.publicProfiles, ['explore'])
    assert.equal(config.upstreamProxyHost, undefined)
    assert.deepEqual(config.extraTools, { geocodeAddress: { active: true, profiles: ['explore'] } })
    assert.equal(config.observer.port, 9090)
  })

  describe('normalizeProfileLists', () => {
    it('parses a JSON array string for publicProfiles and the geocode profiles', () => {
      const config = normalizeProfileLists({ publicProfiles: '["explore","edit"]', extraTools: { geocodeAddress: { profiles: '["explore"]' } } })
      assert.deepEqual(config.publicProfiles, ['explore', 'edit'])
      assert.deepEqual(config.extraTools!.geocodeAddress!.profiles, ['explore'])
    })
    it('splits a comma-separated string, trims, and drops empty entries', () => {
      const config = normalizeProfileLists({ publicProfiles: ' explore, edit ,,', extraTools: { geocodeAddress: { profiles: 'explore, edit' } } })
      assert.deepEqual(config.publicProfiles, ['explore', 'edit'])
      assert.deepEqual(config.extraTools!.geocodeAddress!.profiles, ['explore', 'edit'])
    })
    it('leaves an already-array value untouched', () => {
      const config = normalizeProfileLists({ publicProfiles: ['explore'], extraTools: { geocodeAddress: { profiles: ['explore'] } } })
      assert.deepEqual(config.publicProfiles, ['explore'])
      assert.deepEqual(config.extraTools!.geocodeAddress!.profiles, ['explore'])
    })
  })
})
