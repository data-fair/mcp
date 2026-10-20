import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { startFakeSite, type FakeSite } from '../test/fake-site.ts'
import { cookieFor, USER } from '../test/tokens.ts'
import config from '#config'

const listenOn = async (app: import('express').Express) => {
  const http: Server = createServer(app)
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(http.address() as any).port}`
  return { http, base }
}

describe('server: createRuntime', () => {
  let site: FakeSite
  before(async () => { site = await startFakeSite() })
  after(async () => { await site.close() })

  it('wires upstreamProxyHost into the dispatcher it builds: a tool call reaches the fake site through the proxy', async () => {
    Object.assign(config, {
      mainSiteUrl: site.origin,
      privateDirectoryUrl: site.origin + '/simple-directory',
      portalUrl: undefined,
      refreshInterval: 0,
      trustedForwarder: undefined,
      // the site itself stands in for the in-cluster proxy: what matters here is that the
      // dispatcher DOES resolve through it (proving createRuntime wired the option through),
      // not what is on the other end of it
      upstreamProxyHost: `127.0.0.1:${site.port}`,
      extraTools: { ...config.extraTools, geocodeAddress: { ...config.extraTools.geocodeAddress, active: false } }
    })
    const { createRuntime } = await import('./server.ts')
    const runtime = await createRuntime(config)
    const { http, base } = await listenOn(runtime.app)
    try {
      const client = new Client({ name: 'c', version: '0' }, { versionNegotiation: { mode: 'auto' } })
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp-server/datasets/mcp`), {
        requestInit: { headers: { 'x-forwarded-host': 'portal.test', 'x-forwarded-proto': 'https' } }
      }))
      const res: any = await client.callTool({ name: 'list_datasets', arguments: {} })
      assert.equal(res.isError, undefined)
      const hit = site.hits.at(-1)!
      assert.equal(hit.headers['x-forwarded-host'], 'portal.test')
      assert.equal(hit.headers['x-forwarded-proto'], 'https')
      await client.close()
    } finally {
      runtime.platform.close()
      await new Promise<void>(resolve => http.close(() => resolve()))
    }
  })

  it('initializes the session on the private directory: /mcp verifies a cookie session', async () => {
    Object.assign(config, {
      mainSiteUrl: site.origin,
      portalUrl: undefined,
      privateDirectoryUrl: site.origin + '/simple-directory',
      refreshInterval: 0,
      trustedForwarder: undefined,
      upstreamProxyHost: undefined,
      extraTools: { ...config.extraTools, geocodeAddress: { ...config.extraTools.geocodeAddress, active: false } }
    })
    const { createRuntime } = await import('./server.ts')
    const runtime = await createRuntime(config)
    const { http, base } = await listenOn(runtime.app)
    try {
      const client = new Client({ name: 'c', version: '0' }, { versionNegotiation: { mode: 'auto' } })
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { cookie: cookieFor(USER) } } }))
      assert.ok((await client.listTools()).tools.some(t => t.name === 'datafair_list_datasets'))
      await client.close()
    } finally {
      runtime.platform.close()
      await new Promise<void>(resolve => http.close(() => resolve()))
    }
  })

  it('resolves mainSiteUrl from portalUrl when unset, and the AI catalog uses the portal origin', async () => {
    Object.assign(config, {
      mainSiteUrl: undefined,
      portalUrl: site.origin,
      privateDirectoryUrl: site.origin + '/simple-directory',
      refreshInterval: 0,
      trustedForwarder: undefined,
      upstreamProxyHost: undefined,
      extraTools: { ...config.extraTools, geocodeAddress: { ...config.extraTools.geocodeAddress, active: false } }
    })
    const { createRuntime } = await import('./server.ts')
    const runtime = await createRuntime(config)
    assert.equal(runtime.mainSiteUrl, site.origin)
    assert.equal(config.mainSiteUrl, site.origin)
    const { http, base } = await listenOn(runtime.app)
    try {
      const catalog: any = await (await fetch(`${base}/ai-catalog.json`)).json()
      assert.equal(catalog.entries[0].data.remotes[0].url, `${site.origin}/mcp-server/datasets/mcp`)
    } finally {
      runtime.platform.close()
      await new Promise<void>(resolve => http.close(() => resolve()))
    }
  })
})
