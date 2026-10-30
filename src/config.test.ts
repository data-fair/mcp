import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLists } from './config.ts'

process.env.NODE_CONFIG_DIR = process.cwd() + '/config'

describe('config', () => {
  it('defaults to the platform document, the in-cluster directory and the datasets server', async () => {
    const config = (await import('#config')).default
    assert.equal(config.docPath, '/data-fair/api/v1/platform/api-docs.json')
    assert.equal(config.privateDirectoryUrl, 'http://simple-directory:8080')
    assert.equal(config.mcpServer, 'datasets')
    assert.equal((config as any).indexPath, undefined)
    assert.equal((config.extraTools.geocodeAddress as any).profiles, undefined)
    assert.equal(config.refreshInterval, 300)
    assert.equal(config.upstreamProxyHost, undefined)
    assert.deepEqual(config.extraTools, { geocodeAddress: { active: true, limits: { global: { nb: 40, duration: 1 }, perCaller: { nb: 10, duration: 1 } } } })
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

  it('still splits FILE_URL_PREFIXES', () => {
    assert.deepEqual(normalizeLists({ files: { urlPrefixes: 'https://a/, https://b/' } }).files.urlPrefixes, ['https://a/', 'https://b/'])
  })
})
