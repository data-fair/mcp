/**
 * OAuth discovery for MCP clients (RFC 9728): the platform server's protected-resource metadata
 * names the authorization server of the site it is called on. SD runs one only on issuer sites
 * (the global main site, account main sites), so the server asks SD's discovery whether a site
 * is one, and caches the answer. Other sites offer no OAuth access: API keys or cookies only.
 */
import type { ToolSet } from '@data-fair/openapi-mcp'
import { MCP_PATH } from './scopes.ts'
import { siteFetch, type SiteDispatcher } from './site-fetch.ts'

const METADATA_PATH = '/.well-known/oauth-protected-resource/mcp'

/** where the metadata is published, the `resource_metadata` of a 401 */
export const resourceMetadataUrl = (siteOrigin: string): string => siteOrigin + MCP_PATH + METADATA_PATH

/** the app route serving it, under the server's mount */
export const resourceMetadataRoute = METADATA_PATH

/** An MCP client can finish its flow: authorization code, and a way to register (DCR or client metadata documents). */
const completeFlow = (doc: any): doc is { issuer: string } =>
  typeof doc?.issuer === 'string' && !!doc.authorization_endpoint && (!!doc.registration_endpoint || doc.client_id_metadata_document_supported === true)

/**
 * The issuer of a site, undefined when it is not an issuer site. Any failure (not found, not
 * JSON, timeout, unreachable) is a missing answer, cached for less time than a found one.
 */
export function createIssuerLookup (options: { mainSiteUrl: string, dispatcher: SiteDispatcher, trustedForwarder?: string, timeoutMs?: number, ttlMs?: { found: number, missing: number } }): (siteOrigin: string) => Promise<string | undefined> {
  const timeoutMs = options.timeoutMs ?? 3000
  const ttl = options.ttlMs ?? { found: 10 * 60_000, missing: 60_000 }
  const cache = new Map<string, { answer: Promise<string | undefined>, expires: number }>()

  const probe = async (siteOrigin: string): Promise<string | undefined> => {
    try {
      const fetch = siteFetch(siteOrigin, { mainSiteUrl: options.mainSiteUrl, dispatcher: options.dispatcher, trustedForwarder: options.trustedForwarder })
      const res = await fetch(`${options.mainSiteUrl}/simple-directory/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) { await res.body?.cancel(); return undefined }
      const doc = await res.json()
      return completeFlow(doc) ? doc.issuer : undefined
    } catch (err) {
      console.warn(`oauth discovery of ${siteOrigin} failed`, err instanceof Error ? err.message : err)
      return undefined
    }
  }

  return (siteOrigin) => {
    const cached = cache.get(siteOrigin)
    if (cached && cached.expires > Date.now()) return cached.answer
    // the promise is cached at once, so concurrent cold lookups share one request
    const entry = { answer: probe(siteOrigin), expires: Infinity }
    cache.set(siteOrigin, entry)
    entry.answer.then(issuer => { entry.expires = Date.now() + (issuer ? ttl.found : ttl.missing) })
    return entry.answer
  }
}

/** Every scope the tools accept, once, sorted: the `scopes_supported` of the metadata. */
export function scopesSupported (toolSet: ToolSet): string[] {
  const scopes = new Set<string>()
  for (const tool of toolSet.tools) {
    for (const requirement of tool.security ?? []) for (const scope of requirement.oauth2 ?? []) scopes.add(scope)
  }
  return [...scopes].sort()
}

export function protectedResourceMetadata (options: { siteOrigin: string, issuer: string, scopes: string[] }) {
  return {
    resource: options.siteOrigin + MCP_PATH + '/mcp',
    authorization_servers: [options.issuer],
    scopes_supported: options.scopes,
    bearer_methods_supported: ['header'],
    resource_name: `Data Fair (${new URL(options.siteOrigin).host})`
  }
}
