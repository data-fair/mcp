import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLists } from './config.ts'

process.env.NODE_CONFIG_DIR = process.cwd() + '/config'

describe('config', () => {
  it('has the composed server defaults', async () => {
    const config = (await import('#config')).default
    assert.equal(config.indexPath, '/data-fair/api/v1/agents/index.json')
    assert.equal(config.refreshInterval, 300)
    assert.equal((config as any).mode, undefined, 'one published server: no mode')
    assert.equal((config as any).publicProfiles, undefined)
    assert.equal(config.upstreamProxyHost, undefined)
    assert.deepEqual(config.extraTools, { geocodeAddress: { active: true, profiles: ['catalog'], limits: { global: { nb: 40, duration: 1 }, perCaller: { nb: 10, duration: 1 } } } })
    assert.equal(config.observer.port, 9090)
    assert.deepEqual(config.files, { urlPrefixes: [] })
  })

  it('refuses a zero or negative file size or timeout', async () => {
    const { assertValid } = await import('../config/type/index.ts')
    const base = (await import('#config')).default
    for (const files of [{ urlPrefixes: [], maxSize: 0 }, { urlPrefixes: [], maxSize: -1 }, { urlPrefixes: [], timeout: 0 }, { urlPrefixes: [], timeout: -5 }]) {
      assert.throws(() => assertValid({ ...structuredClone(base), files }, { lang: 'en', name: 'config' }), JSON.stringify(files))
    }
    assert.doesNotThrow(() => assertValid({ ...structuredClone(base), files: { urlPrefixes: [], maxSize: 1, timeout: 1 } }, { lang: 'en', name: 'config' }))
  })

  describe('normalizeLists', () => {
    it('parses a JSON array string for the geocode profiles', () => {
      const config = normalizeLists({ extraTools: { geocodeAddress: { profiles: '["catalog"]' } } })
      assert.deepEqual(config.extraTools!.geocodeAddress!.profiles, ['catalog'])
    })
    it('splits a comma-separated string, trims, and drops empty entries', () => {
      const config = normalizeLists({ extraTools: { geocodeAddress: { profiles: ' catalog, read ,,' } } })
      assert.deepEqual(config.extraTools!.geocodeAddress!.profiles, ['catalog', 'read'])
    })
    it('leaves an already-array value untouched', () => {
      const config = normalizeLists({ extraTools: { geocodeAddress: { profiles: ['catalog'] } } })
      assert.deepEqual(config.extraTools!.geocodeAddress!.profiles, ['catalog'])
    })
    it('splits FILE_URL_PREFIXES, a comma-separated list', () => {
      const config = normalizeLists({ files: { urlPrefixes: 'https://s3.test/bucket/ , https://s3.test/other/' } } as any)
      assert.deepEqual(config.files.urlPrefixes, ['https://s3.test/bucket/', 'https://s3.test/other/'])
    })
  })
})
