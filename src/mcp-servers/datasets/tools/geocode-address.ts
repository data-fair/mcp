import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import Debug from 'debug'
import axios from '@data-fair/lib-node/axios.js'
import { getToolTitle, geocodeAddress as geocodeTool } from './_utils.ts'

const debug = Debug('datasets-tools')
const p = geocodeTool.schema.inputSchema.properties
const o = geocodeTool.schema.outputSchema.properties

export default (server: McpServer) => {
  server.registerTool(
    geocodeTool.schema.name,
    {
      title: getToolTitle(geocodeTool.annotations),
      description: geocodeTool.schema.description,
      inputSchema: {
        q: z.string().min(3, 'Address must be at least 3 characters').describe(p.q.description),
        limit: z.number().int().min(1).max(20).optional().describe(p.limit.description)
      },
      outputSchema: {
        count: z.number().describe(o.count.description),
        results: z.array(z.object({
          label: z.string().describe(o.results.items.properties.label.description),
          score: z.number().describe(o.results.items.properties.score.description),
          type: z.string().describe(o.results.items.properties.type.description),
          name: z.string().describe(o.results.items.properties.name.description),
          postcode: z.string().describe(o.results.items.properties.postcode.description),
          city: z.string().describe(o.results.items.properties.city.description),
          citycode: z.string().describe(o.results.items.properties.citycode.description),
          context: z.string().describe(o.results.items.properties.context.description),
          longitude: z.number().describe(o.results.items.properties.longitude.description),
          latitude: z.number().describe(o.results.items.properties.latitude.description)
        })).describe(o.results.description)
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async (params: { q: string, limit?: number }) => {
      debug('Executing geocode_address with q:', params.q)

      const fetchUrlStr = geocodeTool.buildUrl(params)

      let fetchedData: any
      try {
        fetchedData = (await axios.get(fetchUrlStr, { timeout: 30_000 })).data
      } catch (err: any) {
        const message = err.response?.data?.message || err.response?.data?.description || err.message
        throw new Error(`Geocoding API error: ${message}`)
      }

      const { text, structuredContent } = geocodeTool.formatResult(fetchedData, params)

      return {
        structuredContent,
        content: [{ type: 'text', text }]
      }
    }
  )
}
