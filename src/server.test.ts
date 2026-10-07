import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { startFakeSite, type FakeSite } from '../test/fake-site.ts'
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
      portalUrl: undefined,
      refreshInterval: 0,
      ignoreRateLimiting: undefined,
      // the site itself stands in for the in-cluster proxy: what matters here is that the
      // dispatcher DOES resolve through it (proving createRuntime wired the option through),
      // not what is on the other end of it
      upstreamProxyHost: `127.0.0.1:${site.port}`,
      extraTools: { geocodeAddress: { active: false, profiles: [] } }
    })
    const { createRuntime } = await import('./server.ts')
    const runtime = await createRuntime(config)
    const { http, base } = await listenOn(runtime.app)
    try {
      const client = new Client({ name: 'c', version: '0' }, { versionNegotiation: { mode: 'auto' } })
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp-server/mcp`), {
        requestInit: { headers: { 'x-forwarded-host': 'portal.test', 'x-forwarded-proto': 'https' } }
      }))
      const res: any = await client.callTool({ name: 'datafair_list_datasets', arguments: {} })
      assert.equal(res.isError, undefined)
      const hit = site.hits.at(-1)!
      assert.equal(hit.headers['x-forwarded-host'], 'portal.test')
      assert.equal(hit.headers['x-forwarded-proto'], 'https')
      await client.close()
    } finally {
      runtime.composition.close()
      await new Promise<void>(resolve => http.close(() => resolve()))
    }
  })

  it('resolves mainSiteUrl from portalUrl when unset, and the registry uses the portal origin', async () => {
    Object.assign(config, {
      mainSiteUrl: undefined,
      portalUrl: site.origin,
      refreshInterval: 0,
      ignoreRateLimiting: undefined,
      upstreamProxyHost: undefined,
      extraTools: { geocodeAddress: { active: false, profiles: [] } }
    })
    const { createRuntime } = await import('./server.ts')
    const runtime = await createRuntime(config)
    assert.equal(runtime.mainSiteUrl, site.origin)
    assert.equal(config.mainSiteUrl, site.origin)
    const { http, base } = await listenOn(runtime.app)
    try {
      const reg: any = await (await fetch(`${base}/v0/servers`)).json()
      assert.ok(reg.servers.length >= 1)
      assert.ok(reg.servers[0].server.remotes[0].url.startsWith(site.origin))
    } finally {
      runtime.composition.close()
      await new Promise<void>(resolve => http.close(() => resolve()))
    }
  })
})
