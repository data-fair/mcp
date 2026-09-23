/**
 * geocode_address — the one tool no OpenAPI document generates: the IGN Géoplateforme
 * geocoder has no x-agent annotations and never will. Ported from
 * data-fair/agent-tools/geocode-address.ts; joined into the composed set by
 * config.extraTools.geocodeAddress. No data-fair identity is involved.
 */
import type { Tool, ToolResult } from '@data-fair/openapi-mcp'

const DEFAULT_BASE = 'https://data.geopf.fr/geocodage/search'
const TIMEOUT_MS = 30_000

const titles = { en: 'Geocode an address', fr: 'Géocoder une adresse' }

export interface Params { q: string, limit?: number }

export function buildUrl (params: Params, base = DEFAULT_BASE): string {
  const q = params.q?.trim()
  if (!q || q.length < 3) throw new Error('Address must be at least 3 characters.')
  const limit = Math.min(Math.max(params.limit || 5, 1), 20)
  const url = new URL(base)
  url.searchParams.set('q', q)
  url.searchParams.set('limit', String(limit))
  return url.toString()
}

export function formatResult (data: any, params: { q: string }): { text: string, structuredContent: { count: number, results: any[] } } {
  const features = data.features ?? []
  const results = features.map((f: any) => ({
    label: f.properties.label ?? '',
    score: f.properties.score ?? 0,
    type: f.properties.type ?? '',
    name: f.properties.name ?? '',
    postcode: f.properties.postcode ?? '',
    city: f.properties.city ?? '',
    citycode: f.properties.citycode ?? '',
    context: f.properties.context ?? '',
    longitude: f.geometry.coordinates[0],
    latitude: f.geometry.coordinates[1]
  }))
  let text: string
  if (features.length === 0) {
    text = `No results found for "${params.q}".`
  } else {
    const lines = results.map((r: any) =>
      `- **${r.label}** (score: ${r.score?.toFixed?.(2) ?? r.score}, type: ${r.type})\n  Coordinates: lon=${r.longitude}, lat=${r.latitude}\n  Postal code: ${r.postcode}, City: ${r.city} (${r.citycode})\n  Context: ${r.context}`
    )
    text = `**${features.length}** result(s) for "${params.q}":\n\n${lines.join('\n\n')}`
  }
  return { text, structuredContent: { count: results.length, results } }
}

export function geocodeAddressTool (options: { fetch?: typeof fetch, base?: string, locale?: 'en' | 'fr' } = {}): Tool {
  const fetchFn = options.fetch ?? globalThis.fetch
  return {
    name: 'geocode_address',
    title: titles[options.locale ?? 'en'],
    description: 'Convert a French address or place name into geographic coordinates using the IGN Geoplateforme geocoding service. Returns matching locations with coordinates, postal code, city, and relevance score.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Address or place name to search for in France. Examples: "20 avenue de Segur, Paris", "Mairie de Bordeaux", "33000"' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum number of results to return (default: 5)' }
      },
      required: ['q']
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async execute (params): Promise<ToolResult> {
      let url: string
      try {
        url = buildUrl(params as unknown as Params, options.base)
      } catch (err: any) {
        return { isError: true, text: err.message }
      }
      try {
        const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
        if (!res.ok) return { isError: true, text: `Geocoding API error: HTTP ${res.status}` }
        const { text, structuredContent } = formatResult(await res.json(), params as { q: string })
        return { text, structuredContent }
      } catch (err: any) {
        return { isError: true, text: `Geocoding API error: ${err?.message ?? err}` }
      }
    }
  }
}
