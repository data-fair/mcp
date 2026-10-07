import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { connect } from 'node:net'
import { createDispatcher, siteFetch, proxyTarget } from './site-fetch.ts'

/** Echoes what reached it: host, path, and the headers the server is expected to set. */
const echo = () => createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ host: req.headers.host, url: req.url, headers: req.headers }))
})
const listen = async (s: Server) => { await new Promise<void>(resolve => s.listen(0, '127.0.0.1', resolve)); return (s.address() as any).port as number }

describe('proxyTarget', () => {
  it('parses host, host:port, and a bracketed IPv6 literal with or without a port', () => {
    assert.deepEqual(proxyTarget('nginx'), { host: 'nginx', port: 80 })
    assert.deepEqual(proxyTarget('nginx:8080'), { host: 'nginx', port: 8080 })
    assert.deepEqual(proxyTarget('[::1]:8080'), { host: '::1', port: 8080 })
    assert.deepEqual(proxyTarget('[::1]'), { host: '::1', port: 80 })
    assert.deepEqual(proxyTarget('[2001:db8::1]:9090'), { host: '2001:db8::1', port: 9090 })
  })
})

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

  it('leaves a foreign origin alone, and strips the caller\'s credentials for it', async () => {
    const main = 'https://main.test'
    const dispatcher = createDispatcher({ mainSiteUrl: main })
    const f = siteFetch('https://site.test', { mainSiteUrl: main, dispatcher, ignoreRateLimiting: 'secret' })
    const body: any = await (await f(new Request(`http://127.0.0.1:${port}/elsewhere`, { headers: { cookie: 'id_token=abc', 'x-apikey': 'k' } }))).json()
    assert.equal(body.url, '/elsewhere')
    assert.equal(body.host, `127.0.0.1:${port}`)
    assert.equal(body.headers.cookie, undefined)
    assert.equal(body.headers['x-apikey'], undefined)
    assert.equal(body.headers['x-ignore-rate-limiting'], undefined)
    assert.equal(body.headers.referer, undefined)
  })

  it('dispatches every site host to the upstream proxy, keeping Host and adding X-Forwarded-*', async () => {
    const main = 'https://main.test'
    const dispatcher = createDispatcher({ mainSiteUrl: main, upstreamProxyHost: `127.0.0.1:${port}` })
    const f = siteFetch('https://portal.test', { mainSiteUrl: main, dispatcher })
    const body: any = await (await f(`${main}/data-fair/api/v1/ping`)).json()
    assert.equal(body.host, `portal.test:${port}`)
    assert.equal(body.headers['x-forwarded-host'], 'portal.test')
    assert.equal(body.headers['x-forwarded-proto'], 'https')
    assert.equal(body.url, '/data-fair/api/v1/ping')
  })

  it('keeps the site origin\'s own port in X-Forwarded-Host on the proxy hop', async () => {
    const main = 'https://main.test'
    const dispatcher = createDispatcher({ mainSiteUrl: main, upstreamProxyHost: `127.0.0.1:${port}` })
    const f = siteFetch('https://portal.test:9443', { mainSiteUrl: main, dispatcher })
    const body: any = await (await f(`${main}/data-fair/api/v1/ping`)).json()
    assert.equal(body.host, `portal.test:${port}`)
    assert.equal(body.headers['x-forwarded-host'], 'portal.test:9443')
    assert.equal(body.headers['x-forwarded-proto'], 'https')
    assert.equal(body.url, '/data-fair/api/v1/ping')
  })

  it('never lets a mainSiteUrl port leak into a portless site host on the proxy hop', async () => {
    const main = `http://127.0.0.1:${port}`
    const dispatcher = createDispatcher({ mainSiteUrl: main, upstreamProxyHost: `127.0.0.1:${port}` })
    const f = siteFetch('https://portal.test', { mainSiteUrl: main, dispatcher })
    const body: any = await (await f(`${main}/data-fair/api/v1/ping`)).json()
    assert.equal(body.headers['x-forwarded-host'], 'portal.test')
    assert.equal(body.host, `portal.test:${port}`)
  })

  it('tunnels every call through a forward proxy, the site host kept as the CONNECT target', async () => {
    const connects: string[] = []
    const proxy = createServer()
    proxy.on('connect', (req, client, head) => {
      connects.push(req.url!)
      const upstreamSocket = connect(port, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        upstreamSocket.write(head)
        upstreamSocket.pipe(client)
        client.pipe(upstreamSocket)
      })
    })
    const proxyPort = await listen(proxy)
    try {
      const main = `http://main.test:${port}`
      const dispatcher = createDispatcher({ mainSiteUrl: main, forwardProxy: `http://127.0.0.1:${proxyPort}` })
      const f = siteFetch(main, { mainSiteUrl: main, dispatcher })
      const body: any = await (await f(new Request(`${main}/data-fair/api/v1/ping`, { headers: { 'x-apikey': 'k' } }))).json()
      assert.deepEqual(connects, [`main.test:${port}`])
      assert.equal(body.host, `main.test:${port}`)
      assert.equal(body.headers['x-apikey'], 'k')
      await dispatcher.dispatcher.close()
    } finally {
      proxy.close()
    }
  })

  it('refuses a forward proxy together with an upstream proxy host', () => {
    assert.throws(() => createDispatcher({ mainSiteUrl: 'https://main.test', upstreamProxyHost: 'nginx', forwardProxy: 'http://127.0.0.1:1' }))
  })
})
