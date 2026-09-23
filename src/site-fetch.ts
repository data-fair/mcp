/**
 * The one place upstream calls are shaped. Portals' 01-local-fetch.ts recipe: the site's
 * public origin (so the reverse proxy's metrics count the call), DNS resolved once, short
 * timeouts, the rate-limit bypass secret, and the caller's cookies forwarded — plus, when
 * upstreamProxyHost is set, a direct hop to the in-cluster L2 nginx that skips public DNS
 * and the L1 proxy while looking, to that nginx, exactly like a proxied request.
 */
import dns from 'node:dns'
import { Agent, interceptors, type Dispatcher } from 'undici'

export interface SiteFetchOptions {
  /** origin the composed tools carry in their URLs */
  mainSiteUrl: string
  /** `host` or `host:port` every site host resolves to; the URL keeps the site's host */
  upstreamProxyHost?: string
  ignoreRateLimiting?: string
  timeoutMs?: number
}

const proxyTarget = (spec: string) => {
  const [host, port] = spec.split(':')
  return { host, port: port ? Number(port) : 80 }
}

export function createDispatcher (options: SiteFetchOptions): Dispatcher {
  const timeout = options.timeoutMs ?? 30_000
  const proxy = options.upstreamProxyHost ? proxyTarget(options.upstreamProxyHost) : undefined

  // installed undici (^7.29) accepts a `lookup` on the dns interceptor, but its real
  // signature is (origin: URL, options: dns.LookupOptions, cb: (err, DNSInterceptorRecord[]) => void) —
  // not the (hostname: string, ..., cb: (err, addresses, family?) => void) shape node's own
  // dns.lookup uses. Leaving the param types off and letting them flow from dnsOpts's own
  // type keeps this correct against whatever undici actually ships.
  const dnsOpts: NonNullable<Parameters<typeof interceptors.dns>[0]> = { maxTTL: Infinity }
  if (proxy) {
    dnsOpts.lookup = (_origin, opts, cb) => {
      dns.lookup(proxy.host, { ...opts, all: true }, (err, addresses) => {
        if (err) return cb(err, [])
        const list = Array.isArray(addresses) ? addresses : [addresses]
        cb(null, list.map(a => ({ address: a.address, family: (a.family === 6 ? 6 : 4) as 4 | 6, ttl: Infinity })))
      })
    }
  }

  return new Agent({ connections: 8, allowH2: !proxy, headersTimeout: timeout, bodyTimeout: timeout })
    .compose(interceptors.dns(dnsOpts))
}

export function siteFetch (siteOrigin: string, options: SiteFetchOptions & { dispatcher: Dispatcher }): typeof fetch {
  const main = new URL(options.mainSiteUrl)
  const site = new URL(siteOrigin)
  const proxy = options.upstreamProxyHost ? proxyTarget(options.upstreamProxyHost) : undefined
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request && init === undefined ? input : new Request(input, init)
    const url = new URL(req.url)
    const ours = url.origin === main.origin
    if (ours) {
      url.protocol = site.protocol
      url.host = site.host
    }
    const headers = new Headers(req.headers)
    headers.set('user-agent', '@data-fair/mcp')
    if (ours) {
      headers.set('referer', `${siteOrigin}/mcp`)
      if (options.ignoreRateLimiting) headers.set('x-ignore-rate-limiting', options.ignoreRateLimiting)
      if (proxy) {
        headers.set('x-forwarded-host', url.hostname)
        headers.set('x-forwarded-proto', url.protocol.replace(':', ''))
        url.protocol = 'http:'
        url.port = String(proxy.port)
      }
    }
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body
    return fetch(url, { method: req.method, headers, body, signal: req.signal, dispatcher: options.dispatcher, duplex: body ? 'half' : undefined } as RequestInit)
  }) as typeof fetch
}
