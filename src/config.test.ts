import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

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
  })
})
