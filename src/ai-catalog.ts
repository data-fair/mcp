/**
 * The AI Catalog a site publishes at /.well-known/ai-catalog.json (the ingress maps it here): the MCP
 * Server Cards of the two servers, so a client reading the site (an agent's web access) can discover
 * and connect them. Embedded rather than linked: one request instead of two. The datasets server is
 * the portal's published data, usable anonymously; the platform server requires credentials, which
 * a card does not announce: its 401 challenge does (OAuth discovery on issuer sites).
 */
export function aiCatalogDocument (options: { siteOrigin: string, version: string }) {
  const { siteOrigin, version } = options
  const host = new URL(siteOrigin).host
  return {
    specVersion: '1.0' as const,
    entries: [{
      identifier: `urn:air:${host}:mcp:platform`,
      type: 'application/mcp-server-card+json' as const,
      data: {
        $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
        name: 'fr.data-fair/platform',
        version,
        description: 'Work with the Data Fair platform as an authenticated identity: manage datasets, applications, portals and the other resources its permissions allow. Requires credentials (OAuth on the sites that offer it, an API key or a session elsewhere).',
        remotes: [{ type: 'streamable-http', url: `${siteOrigin}/mcp-server/mcp` }]
      }
    }, {
      identifier: `urn:air:${host}:mcp:datasets`,
      type: 'application/mcp-server-card+json' as const,
      data: {
        $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
        name: 'fr.data-fair/datasets',
        version,
        description: 'Explore the data catalog published on this portal: find datasets, read their schema, search, aggregate and compute metrics over their data.',
        remotes: [{ type: 'streamable-http', url: `${siteOrigin}/mcp-server/datasets/mcp` }]
      }
    }]
  }
}
