import express, { type Request, type Response, type NextFunction } from 'express'
import { readFileSync } from 'node:fs'
import { createSiteMiddleware, errorHandler, assertReqInternal } from '@data-fair/lib-express'
import { createMcpHttpHandler } from '@data-fair/openapi-mcp/adapters/mcp'
import { toNodeHandler } from '@modelcontextprotocol/node'
import config from '#config'
import { rateLimitingMiddleware } from './rate-limiting.ts'
import { requestContext, originFromForwarded } from './context.ts'
import { registryDocument } from './registry.ts'
import type { Composition } from './composition.ts'
import type { SiteDispatcher } from './site-fetch.ts'

const version: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const cacheable = (res: Response) => res.set({ 'Cache-Control': 'public, max-age=300', Vary: 'X-Forwarded-Host' })
const headersOf = (req: Request) => new Headers(Object.entries(req.headers).flatMap(([k, v]) => v === undefined ? [] : [[k, Array.isArray(v) ? v.join(', ') : v] as [string, string]]))
const siteOf = (req: Request) => originFromForwarded(headersOf(req)) ?? config.mainSiteUrl!
/**
 * The one profile parser, used by both the gate and the handler so they can never disagree:
 * every occurrence of `profiles` (repeated params included), comma-split, trimmed, emptied
 * entries dropped; an empty result (absent, blank, or only separators/blanks) means the
 * default `explore` set — never "no profiles asked, so nothing to refuse".
 */
const profilesOf = (search: URLSearchParams): string[] => {
  const raw = search.getAll('profiles').join(',')
  const list = raw.split(',').map(s => s.trim()).filter(Boolean)
  return list.length ? list : ['explore']
}

export function createApp (composition: Composition, dispatcher: SiteDispatcher) {
  const app = express()
  app.set('query parser', 'simple')
  app.set('json spaces', 2)

  app.use(createSiteMiddleware('mcp-server'))

  // R3: the limiter is applied per route, after the profile gate, in public mode only.
  // A refused profile must answer 403 before reqIp can throw on a request lacking
  // X-Forwarded-For; in internal mode reqIp would throw unconditionally (no reverse proxy).
  const limiter = config.mode === 'public' ? [rateLimitingMiddleware] : []

  // CORS for browser-based MCP clients, on the MCP routes only.
  const cors = (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Protocol-Version, Mcp-Method, Mcp-Name, x-apiKey, Mcp-Session-Id')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') { res.status(204).end(); return }
    next()
  }

  // The gate: in public mode a request may only ask for public profiles. No header opens more.
  const profileGate = (req: Request, res: Response, next: NextFunction) => {
    if (config.mode !== 'public') return next()
    const asked = profilesOf(new URL(req.url, 'http://x').searchParams)
    const refused = asked.filter(p => !config.publicProfiles.includes(p))
    if (refused.length) { res.status(403).type('text/plain').send(`profile not available here: ${refused.join(', ')}`); return }
    next()
  }

  const context = requestContext({ config, dispatcher })
  const options = { context, refreshMs: config.refreshInterval > 0 ? config.refreshInterval * 1000 : undefined }
  const main = createMcpHttpHandler((request) => composition.main(request ? profilesOf(new URL(request.url).searchParams) : ['explore']), { name: 'datafair-mcp-server', version }, options)
  const alias = createMcpHttpHandler(() => composition.alias(), { name: 'datafair-datasets-mcp-server', version }, options)
  composition.composer.onChange(() => { for (const h of [main, alias]) { h.notify.toolsChanged(); h.notify.resourcesChanged() } })

  app.all('/mcp', cors, profileGate, ...limiter, toNodeHandler(main))
  app.all('/datasets/mcp', cors, ...limiter, toNodeHandler(alias))

  app.get('/v0/servers', ...limiter, (req, res) => {
    cacheable(res)
    res.json(registryDocument({ composer: composition.composer, siteOrigin: siteOf(req), version, locale: config.locale, profiles: config.mode === 'public' ? config.publicProfiles : undefined }))
  })
  app.get('/status', ...limiter, (req, res) => {
    if (config.mode === 'public') assertReqInternal(req)
    res.json({ mode: config.mode, mainSiteUrl: config.mainSiteUrl, services: composition.composer.services, profiles: composition.composer.profiles().map(p => p.name), lastRefresh: composition.lastRefresh(), extraTools: config.extraTools })
  })

  app.use(errorHandler)
  return app
}
