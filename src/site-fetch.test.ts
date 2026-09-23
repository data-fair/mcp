import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { createDispatcher, siteFetch } from './site-fetch.ts'

/** Echoes what reached it: host, path, and the headers the server is expected to set. */
const echo = () => createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ host: req.headers.host, url: req.url, headers: req.headers }))
})
const listen = async (s: Server) => { await new Promise<void>(resolve => s.listen(0, '127.0.0.1', resolve)); return (s.address() as any).port as number }

describe('siteFetch', () => {
  let upstream: Server, port: number
  before(async () => { upstream = echo(); port = await listen(upstream) })
  after(() => upstream.close())

  it('swaps the main site origin for the requesting site and sets the server headers', async () => {
    const main = `http://127.0.0.1:${port}`
    const dispatcher = createDispatcher({ mainSiteUrl: main })
    const f = siteFetch(`http://localhost:${port}`, { mainSiteUrl: main, dispatcher, ignoreRateLimiting: 'secret' })
    const body: any = await (await f(new Request(`${main}/data-fair/api/v1/datasets?size=1`, { headers: { cookie: 'id_token=abc' } }))).json()
    assert.equal(body.host, `localhost:${port}`)
    assert.equal(body.url, '/data-fair/api/v1/datasets?size=1')
    assert.equal(body.headers.cookie, 'id_token=abc')
    assert.equal(body.headers['x-ignore-rate-limiting'], 'secret')
    assert.equal(body.headers.referer, `http://localhost:${port}/mcp`)
    assert.equal(body.headers['user-agent'], '@data-fair/mcp')
  })

  it('leaves a foreign origin alone', async () => {
    const main = 'https://main.test'
    const dispatcher = createDispatcher({ mainSiteUrl: main })
    const f = siteFetch('https://site.test', { mainSiteUrl: main, dispatcher })
    const body: any = await (await f(`http://127.0.0.1:${port}/elsewhere`)).json()
    assert.equal(body.url, '/elsewhere')
    assert.equal(body.host, `127.0.0.1:${port}`)
  })

  it('dispatches every site host to the upstream proxy, keeping Host and adding X-Forwarded-*', async () => {
    const main = 'https://main.test'
    const dispatcher = createDispatcher({ mainSiteUrl: main, upstreamProxyHost: `127.0.0.1:${port}` })
    const f = siteFetch('https://portal.test', { mainSiteUrl: main, dispatcher, upstreamProxyHost: `127.0.0.1:${port}` })
    const body: any = await (await f(`${main}/data-fair/api/v1/ping`)).json()
    assert.equal(body.host, `portal.test:${port}`)
    assert.equal(body.headers['x-forwarded-host'], 'portal.test')
    assert.equal(body.headers['x-forwarded-proto'], 'https')
    assert.equal(body.url, '/data-fair/api/v1/ping')
  })

  it('keeps the site origin\'s own port in X-Forwarded-Host on the proxy hop', async () => {
    const main = 'https://main.test'
    const dispatcher = createDispatcher({ mainSiteUrl: main, upstreamProxyHost: `127.0.0.1:${port}` })
    const f = siteFetch('https://portal.test:9443', { mainSiteUrl: main, dispatcher, upstreamProxyHost: `127.0.0.1:${port}` })
    const body: any = await (await f(`${main}/data-fair/api/v1/ping`)).json()
    assert.equal(body.host, `portal.test:${port}`)
    assert.equal(body.headers['x-forwarded-host'], 'portal.test:9443')
    assert.equal(body.headers['x-forwarded-proto'], 'https')
    assert.equal(body.url, '/data-fair/api/v1/ping')
  })

  it('never lets a mainSiteUrl port leak into a portless site host on the proxy hop', async () => {
    const main = `http://127.0.0.1:${port}`
    const dispatcher = createDispatcher({ mainSiteUrl: main, upstreamProxyHost: `127.0.0.1:${port}` })
    const f = siteFetch('https://portal.test', { mainSiteUrl: main, dispatcher, upstreamProxyHost: `127.0.0.1:${port}` })
    const body: any = await (await f(`${main}/data-fair/api/v1/ping`)).json()
    assert.equal(body.headers['x-forwarded-host'], 'portal.test')
    assert.equal(body.host, `portal.test:${port}`)
  })
})
