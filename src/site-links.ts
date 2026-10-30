/**
 * A file tool (openapi-mcp `response: { file: true }`) sends no request: it returns a link
 * built on the URL the tools were composed with, the main site's. Every other call reaches the
 * requesting site because siteFetch swaps the origin; a link has to be swapped the same way, or a
 * caller on a portal is handed a main-site URL, which the agents service fetches anonymously
 * (it sends credentials only to the origin the call was bound to) and which then fails on
 * private data.
 */
import type { Tool, ToolSet } from '@data-fair/openapi-mcp'

export function linksOnSite (toolSet: ToolSet, siteOrigin: string, mainSiteUrl: string): ToolSet {
  const main = new URL(mainSiteUrl).origin
  const site = new URL(siteOrigin).origin
  if (main === site) return toolSet
  const onSite = (tool: Tool): Tool => ({
    ...tool,
    async execute (params, ctx) {
      const result = await tool.execute(params, ctx)
      const link = result.resourceLink
      if (!link) return result
      const u = new URL(link.uri)
      if (u.origin !== main) return result
      const uri = site + u.pathname + u.search + u.hash
      return { ...result, text: result.text.split(link.uri).join(uri), resourceLink: { ...link, uri } }
    }
  })
  return { ...toolSet, tools: toolSet.tools.map(onSite) }
}
