/** The MCP Registry API listing (GET /v0/servers): one server per profile, for hosts with pickers. */
import type { Composer } from '@data-fair/openapi-mcp'

export function registryDocument (options: { composer: Composer, siteOrigin: string, version: string, profiles?: string[], locale: string }) {
  const { composer, siteOrigin, version, profiles, locale } = options
  const servers = composer.profiles()
    .filter(p => !profiles || profiles.includes(p.name))
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
