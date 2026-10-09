import express, { type Request, type Response, type NextFunction } from 'express'
import { readFileSync } from 'node:fs'
import { createSiteMiddleware, errorHandler, assertReqInternal } from '@data-fair/lib-express'
import { createMcpHttpHandler } from '@data-fair/openapi-mcp/adapters/mcp'
import { toNodeHandler } from '@modelcontextprotocol/node'
import config from '#config'
import { rateLimitingMiddleware } from './rate-limiting.ts'
import { requestContext, originFromForwarded } from './context.ts'
import { aiCatalogDocument, registryDocument } from './registry.ts'
import type { Composition } from './composition.ts'
import type { SiteDispatcher } from './site-fetch.ts'

const version: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const cacheable = (res: Response) => res.set({ 'Cache-Control': 'public, max-age=300', Vary: 'X-Forwarded-Host' })
const headersOf = (req: Request) => new Headers(Object.entries(req.headers).flatMap(([k, v]) => v === undefined ? [] : [[k, Array.isArray(v) ? v.join(', ') : v] as [string, string]]))
const siteOf = (req: Request) => originFromForwarded(headersOf(req)) ?? config.mainSiteUrl!
/**
 * The one profile parser, used by both the profile check and the handler so they can never disagree:
 * every occurrence of `profiles` (repeated params included), comma-split, trimmed, emptied
 * entries dropped; an empty result (absent, blank, or only separators/blanks) means the
 * default `catalog` set.
 */
const profilesOf = (search: URLSearchParams): string[] => {
  const raw = search.getAll('profiles').join(',')
  const list = raw.split(',').map(s => s.trim()).filter(Boolean)
  return list.length ? list : ['catalog']
}

export function createApp (composition: Composition, dispatcher: SiteDispatcher) {
  const app = express()
  app.set('query parser', 'simple')
  app.set('json spaces', 2)

  app.use(createSiteMiddleware('mcp-server'))

  // One published server (parity: our agents reach it like any other client), limited per
  // caller on every route; see data-fair docs/architecture/agent-rate-limiting.md.
  const limiter = [rateLimitingMiddleware]

  // CORS for browser-based MCP clients, on the MCP routes only.
  const cors = (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Protocol-Version, Mcp-Method, Mcp-Name, x-apiKey, Mcp-Session-Id')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') { res.status(204).end(); return }
    next()
  }

  // An undeclared profile is the caller's mistake: a 400 naming it, not an error deep in the MCP handler.
  const knownProfiles = (req: Request, res: Response, next: NextFunction) => {
    const declared = new Set(composition.composer.profiles().map(p => p.name))
    const unknown = profilesOf(new URL(req.url, 'http://x').searchParams).filter(p => !declared.has(p))
    if (unknown.length) { res.status(400).type('text/plain').send(`unknown profile: ${unknown.join(', ')} (declared: ${[...declared].join(', ')})`); return }
    next()
  }

  const context = requestContext({ config, dispatcher })
  const options = { context, refreshMs: config.refreshInterval > 0 ? config.refreshInterval * 1000 : undefined }
  const main = createMcpHttpHandler((request) => composition.main(request ? profilesOf(new URL(request.url).searchParams) : ['catalog']), { name: 'datafair-mcp-server', version }, options)
  const alias = createMcpHttpHandler(() => composition.alias(), { name: 'datafair-datasets-mcp-server', version }, options)
  composition.composer.onChange(() => { for (const h of [main, alias]) { h.notify.toolsChanged(); h.notify.resourcesChanged() } })

  app.all('/mcp', cors, ...limiter, knownProfiles, toNodeHandler(main))
  app.all('/datasets/mcp', cors, ...limiter, toNodeHandler(alias))

  app.get('/v0/servers', ...limiter, (req, res) => {
    cacheable(res)
    res.json(registryDocument({ composer: composition.composer, siteOrigin: siteOf(req), version, locale: config.locale }))
  })
  app.get('/ai-catalog.json', ...limiter, (req, res) => {
    cacheable(res)
    res.set('Access-Control-Allow-Origin', '*')
    res.type('application/ai-catalog+json')
    res.send(JSON.stringify(aiCatalogDocument({ composer: composition.composer, siteOrigin: siteOf(req), version }), null, 2))
  })
  app.get('/status', ...limiter, (req, res) => {
    assertReqInternal(req)
    res.json({ mainSiteUrl: config.mainSiteUrl, services: composition.composer.services, profiles: composition.composer.profiles().map(p => p.name), lastRefresh: composition.lastRefresh(), extraTools: config.extraTools })
  })

  app.use(errorHandler)
  return app
}
