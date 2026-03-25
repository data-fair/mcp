import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import Debug from 'debug'
import axios from '@data-fair/lib-node/axios.js'
import { formatTextOutput } from './_utils.ts'

const debug = Debug('datasets-tools')

export default (server: McpServer) => {
  server.registerTool(
    'geocode_address',
    {
      title: 'Geocode French Address',
      description: 'Convert a French address or place name into geographic coordinates using the IGN Géoplateforme geocoding service. Returns matching locations with coordinates, postal code, city, and relevance score.',
      inputSchema: {
        q: z.string().min(3, 'Address must be at least 3 characters').describe('Address or place name to search for in France. Examples: "20 avenue de Segur, Paris", "Mairie de Bordeaux", "33000"'),
        limit: z.number().int().min(1).max(20).optional().describe('Maximum number of results to return (default: 5)')
      },
      outputSchema: {
        count: z.number().describe('Number of results returned'),
        results: z.array(z.object({
          label: z.string().describe('Full formatted address'),
          score: z.number().describe('Relevance score between 0 and 1'),
          type: z.string().describe('Result type: housenumber, street, locality, municipality'),
          name: z.string().describe('Street name or place name'),
          postcode: z.string().describe('Postal code'),
          city: z.string().describe('City name'),
          citycode: z.string().describe('INSEE city code'),
          context: z.string().describe('Administrative hierarchy (department, region)'),
          longitude: z.number().describe('Longitude (WGS84)'),
          latitude: z.number().describe('Latitude (WGS84)')
        })).describe('Geocoding results ordered by relevance')
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async (params: { q: string, limit?: number }) => {
      debug('Executing geocode_address with q:', params.q)

      const fetchUrl = new URL('https://data.geopf.fr/geocodage/search')
      fetchUrl.searchParams.set('q', params.q)
      fetchUrl.searchParams.set('limit', String(params.limit ?? 5))

      let fetchedData: any
      try {
        fetchedData = (await axios.get(fetchUrl.toString(), { timeout: 30_000 })).data
      } catch (err: any) {
        const message = err.response?.data?.message || err.response?.data?.description || err.message
        throw new Error(`Geocoding API error: ${message}`)
      }

      const features = fetchedData.features ?? []

      const structuredContent = {
        count: features.length,
        results: features.map((f: any) => ({
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
      }

      const resultLines = structuredContent.results.map((r: any) =>
        `- ${r.label} (score: ${r.score}, type: ${r.type})\n  Longitude: ${r.longitude}, Latitude: ${r.latitude}\n  Context: ${r.context}`
      ).join('\n\n')

      const text = formatTextOutput([
        `${structuredContent.count} result(s) for "${params.q}".`,
        resultLines
      ])

      return {
        structuredContent,
        content: [{ type: 'text', text }]
      }
    }
  )
}
