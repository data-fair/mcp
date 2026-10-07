/**
 * From the incoming MCP request to the context every tool call carries: which site the
 * caller came through, and who the caller is. Nothing here is trusted for authorization —
 * data-fair's permissions decide what a caller may do; this only says where the upstream
 * call goes and which identity data-fair will see.
 */
import { createHash } from 'node:crypto'
import type { CallContext } from '@data-fair/openapi-mcp'
import type { ApiConfig } from '#config'
import { siteFetch, type SiteDispatcher } from './site-fetch.ts'

/** host, optionally with a port; case-insensitive, no scheme, no path — rejects anything else */
const HOST_RE = /^[a-z0-9.-]+(:\d{1,5})?$/i

/** The de-facto standard the reverse proxy sets; the same rule as lib-express's reqOrigin, without throwing. */
export function originFromForwarded (headers: Headers): string | undefined {
  const host = headers.get('x-forwarded-host')
  const proto = headers.get('x-forwarded-proto')
  if (!host || !proto) return undefined
  if (proto !== 'http' && proto !== 'https') return undefined
  if (!HOST_RE.test(host)) return undefined
  const port = headers.get('x-forwarded-port')
  const explicit = port && !(port === '443' && proto === 'https') && !(port === '80' && proto === 'http')
  return `${proto}://${host}${explicit ? ':' + port : ''}`
}

export function requestContext (options: { config: Pick<ApiConfig, 'mainSiteUrl' | 'ignoreRateLimiting'>, dispatcher: SiteDispatcher }): (request: Request | undefined) => CallContext {
  const { config, dispatcher } = options
  return (request) => {
    const headers = request?.headers ?? new Headers()
    const siteOrigin = originFromForwarded(headers) ?? config.mainSiteUrl!
    const forwarded: Record<string, string> = {}
    const cookie = headers.get('cookie')
    const apiKey = headers.get('x-apikey') ?? headers.get('x-api-key')
    if (cookie) forwarded.cookie = cookie
    if (apiKey) forwarded['x-apikey'] = apiKey
    const secret = cookie ?? apiKey
    return {
      fetch: siteFetch(siteOrigin, { mainSiteUrl: config.mainSiteUrl!, dispatcher, ignoreRateLimiting: config.ignoreRateLimiting }),
      headers: Object.keys(forwarded).length ? forwarded : undefined,
      identity: secret ? createHash('sha256').update(secret).digest('hex') : undefined
    }
  }
}
