/**
 * The AI Catalog a site publishes at /.well-known/ai-catalog.json (the ingress maps it here): one entry
 * embedding the MCP Server Card of the datasets server — the portal's published data, usable
 * anonymously — so a client reading the site (an agent's web access) can discover and connect it.
 * Embedded rather than linked: one request instead of two. The platform server is not listed: it
 * requires credentials, which a card cannot announce yet.
 */
export function aiCatalogDocument (options: { siteOrigin: string, version: string }) {
  const { siteOrigin, version } = options
  const host = new URL(siteOrigin).host
  return {
    specVersion: '1.0' as const,
    entries: [{
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
