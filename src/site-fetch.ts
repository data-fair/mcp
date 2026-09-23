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
  ignoreRateLimiting?: string
}

/**
 * The dispatcher together with the options it was built with, so the proxy rewrite in
 * siteFetch is always derived from the same dispatcher a call actually uses — never from a
 * separately passed option that could drift out of sync with it.
 */
export interface SiteDispatcher {
  dispatcher: Dispatcher
  /** `host` or `host:port` (or a bracketed IPv6 literal, `[::1]:port`) every site host resolves to */
  upstreamProxyHost?: string
}

export const proxyTarget = (spec: string): { host: string, port: number } => {
  const bracketed = spec.match(/^\[(.+)\](?::(\d+))?$/)
  if (bracketed) return { host: bracketed[1], port: bracketed[2] ? Number(bracketed[2]) : 80 }
  const i = spec.lastIndexOf(':')
  if (i === -1) return { host: spec, port: 80 }
  return { host: spec.slice(0, i), port: Number(spec.slice(i + 1)) }
}

export function createDispatcher (options: { mainSiteUrl: string, upstreamProxyHost?: string, timeoutMs?: number }): SiteDispatcher {
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

  const dispatcher = new Agent({ connections: 8, allowH2: !proxy, headersTimeout: timeout, bodyTimeout: timeout })
    .compose(interceptors.dns(dnsOpts))
  return { dispatcher, upstreamProxyHost: options.upstreamProxyHost }
}

export function siteFetch (siteOrigin: string, options: SiteFetchOptions & { dispatcher: SiteDispatcher }): typeof fetch {
  const main = new URL(options.mainSiteUrl)
  const site = new URL(siteOrigin)
  const proxy = options.dispatcher.upstreamProxyHost ? proxyTarget(options.dispatcher.upstreamProxyHost) : undefined
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request && init === undefined ? input : new Request(input, init)
    const url = new URL(req.url)
    const ours = url.origin === main.origin
    if (ours) {
      url.protocol = site.protocol
      // hostname/port explicitly, not `url.host = site.host`: the WHATWG URL host setter
      // leaves an existing port untouched when the new value carries none, so a portless
      // site.host would otherwise let the original (mainSiteUrl's) port leak through.
      url.hostname = site.hostname
      url.port = site.port
    }
    const headers = new Headers(req.headers)
    headers.set('user-agent', '@data-fair/mcp')
    if (ours) {
      headers.set('referer', `${siteOrigin}/mcp`)
      if (options.ignoreRateLimiting) headers.set('x-ignore-rate-limiting', options.ignoreRateLimiting)
      if (proxy) {
        // capture the site's host (with its port, if any) and scheme before the proxy hop
        // rewrites both, so X-Forwarded-Host/-Proto reflect what the caller actually reached
        const forwardedHost = url.host
        const forwardedProto = url.protocol.replace(':', '')
        url.protocol = 'http:'
        url.port = String(proxy.port)
        headers.set('x-forwarded-host', forwardedHost)
        headers.set('x-forwarded-proto', forwardedProto)
      }
    } else {
      // a foreign origin never sees the caller's credentials or the rate-limit bypass secret:
      // the library merges the caller's headers into every tool call before siteFetch runs,
      // so a service document pointing a tool at some other host must not receive them.
      headers.delete('cookie')
      headers.delete('x-apikey')
    }
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body
    return fetch(url, { method: req.method, headers, body, signal: req.signal, dispatcher: options.dispatcher.dispatcher, duplex: body ? 'half' : undefined } as RequestInit)
  }) as typeof fetch
}
