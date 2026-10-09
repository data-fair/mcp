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

/**
 * The AI Catalog a site publishes at /.well-known/ai-catalog.json (the ingress maps it here): one entry
 * embedding the MCP Server Card of the `catalog` profile — what the portal publishes, usable anonymously
 * — so a client reading the site (an agent's web access) can discover and connect it. Embedded rather
 * than linked: one request instead of two.
 */
export function aiCatalogDocument (options: { composer: Composer, siteOrigin: string, version: string }) {
  const { composer, siteOrigin, version } = options
  const catalog = composer.profiles().find(p => p.name === 'catalog')
  const host = new URL(siteOrigin).host
  return {
    specVersion: '1.0' as const,
    entries: catalog
      ? [{
          identifier: `urn:air:${host}:mcp:catalog`,
          type: 'application/mcp-server-card+json' as const,
          data: {
            $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
            name: 'fr.data-fair/catalog',
            version,
            description: catalog.description ?? catalog.title ?? 'catalog',
            ...(catalog.title ? { title: catalog.title } : {}),
            remotes: [{ type: 'streamable-http', url: `${siteOrigin}/mcp-server/mcp?profiles=catalog` }]
          }
        }]
      : []
  }
}
