import express, { type Request, type Response, type NextFunction } from 'express'
import { readFileSync } from 'node:fs'
import { createSiteMiddleware, errorHandler, assertReqInternal } from '@data-fair/lib-express'
import { createMcpHttpHandler } from '@data-fair/openapi-mcp/adapters/mcp'
import type { ToolSet } from '@data-fair/openapi-mcp'
import { toNodeHandler } from '@modelcontextprotocol/node'
import config from '#config'
import { requestContext, siteOriginOf } from './context.ts'
import { linksOnSite } from './site-links.ts'
import { aiCatalogDocument } from './ai-catalog.ts'
import { credentials, scopesOf } from './scopes.ts'
import type { Platform } from './platform.ts'
import type { SiteDispatcher } from './site-fetch.ts'

const version: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const cacheable = (res: Response) => res.set({ 'Cache-Control': 'public, max-age=300', Vary: 'X-Forwarded-Host' })
const headersOf = (req: Request) => new Headers(Object.entries(req.headers).flatMap(([k, v]) => v === undefined ? [] : [[k, Array.isArray(v) ? v.join(', ') : v] as [string, string]]))
const siteOf = (req: Request) => siteOriginOf(headersOf(req), config.mainSiteUrl!)

export function createApp (platform: Platform, dispatcher: SiteDispatcher) {
  const app = express()
  app.set('query parser', 'simple')
  app.set('json spaces', 2)

  app.use(createSiteMiddleware('mcp-server'))

  // Published servers (parity: our agents reach them like any other client), with no rate limiting
  // of its own: nginx limits callers on the way in and data-fair every tool call it serves, by user or
  // by the IP forwarded here; only the geocoder, which calls IGN, is limited (data-fair
  // docs/architecture/agent-rate-limiting.md).

  // CORS for browser-based MCP clients, on the MCP routes only.
  const cors = (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Protocol-Version, Mcp-Method, Mcp-Name, x-apiKey, Authorization, Mcp-Session-Id')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') { res.status(204).end(); return }
    next()
  }

  const context = requestContext({ config, dispatcher })
  const options = { context }
  // file links follow the requesting site, like every upstream call (src/site-links.ts)
  // the MCP handler passes the fetch Request (globalThis.Request), not Express's `Request` imported above
  const onSite = (request: globalThis.Request | undefined) => (toolSet: ToolSet) => linksOnSite(toolSet, siteOriginOf(request, config.mainSiteUrl!), config.mainSiteUrl!)
  // the scopes the credentials middleware verified: scopesOf is only read behind credentials(...)
  const main = createMcpHttpHandler((request) => onSite(request)(platform.platform(scopesOf(request))), { name: 'datafair-mcp-server', version }, options)
  const datasets = createMcpHttpHandler((request) => onSite(request)(platform.datasets(scopesOf(request))), { name: 'datafair-datasets-mcp-server', version }, options)
  platform.onChange(() => { for (const h of [main, datasets]) { h.notify.toolsChanged(); h.notify.resourcesChanged() } })

  const mainSiteUrl = config.mainSiteUrl!
  app.all('/mcp', cors, credentials({ required: true, mainSiteUrl }), toNodeHandler(main))
  app.all('/datasets/mcp', cors, credentials({ required: false, mainSiteUrl }), toNodeHandler(datasets))

  app.get('/ai-catalog.json', (req, res) => {
    cacheable(res)
    res.set('Access-Control-Allow-Origin', '*')
    res.type('application/ai-catalog+json')
    res.send(JSON.stringify(aiCatalogDocument({ siteOrigin: siteOf(req), version }), null, 2))
  })
  app.get('/status', (req, res) => {
    assertReqInternal(req)
    res.json({ mainSiteUrl: config.mainSiteUrl, ...platform.status(), extraTools: config.extraTools })
  })

  app.use(errorHandler)
  return app
}
