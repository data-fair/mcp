/** The MCP Registry API listing (GET /v0/servers): one server per profile, for hosts with pickers. */
import type { Composer } from '@data-fair/openapi-mcp'

/**
 * What the registry offers: the catalog and the grid umbrellas. The cells stay selectable by name.
 */
export const REGISTRY_PROFILES = ['catalog', 'read', 'write', 'manage']

export function registryDocument (options: { composer: Composer, siteOrigin: string, version: string, locale: string }) {
  const { composer, siteOrigin, version, locale } = options
  const declared = new Map(composer.profiles().map(p => [p.name, p]))
  const servers = REGISTRY_PROFILES
    .map(name => declared.get(name))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map(p => ({
      server: {
        name: `fr.data-fair/${p.name}`,
        description: p.description ?? p.title ?? p.name,
        version,
        remotes: [{ type: 'streamable-http', url: `${siteOrigin}/mcp-server/mcp?profiles=${encodeURIComponent(p.name)}` }]
      },
      _meta: { 'fr.data-fair/profile': { name: p.name, title: p.title, services: p.services, locale } }
    }))
  return { servers }
}
