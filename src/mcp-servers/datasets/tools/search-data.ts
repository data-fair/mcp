import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import Debug from 'debug'
import axios from '@data-fair/lib-node/axios.js'
import { getOrigin, buildAxiosOptions, datasetIdSchema, filtersSchema, bboxSchema, geoDistanceSchema, dateMatchSchema, handleApiError, applyQueryToUrl, getToolTitle, normalizeSort, searchData as searchDataTool } from './_utils.ts'

const debug = Debug('datasets-tools')
const p = searchDataTool.schema.inputSchema.properties
const o = searchDataTool.schema.outputSchema.properties

export default (server: McpServer) => {
  server.registerTool(
    searchDataTool.schema.name,
    {
      title: getToolTitle(searchDataTool.annotations),
      description: searchDataTool.schema.description,
      inputSchema: {
        datasetId: datasetIdSchema,
        query: z.string().optional().describe(p.q.description),
        filters: filtersSchema,
        bbox: bboxSchema,
        geoDistance: geoDistanceSchema,
        dateMatch: dateMatchSchema,
        select: z.string().optional().describe(p.select.description),
        sort: z.string().optional().describe(p.sort.description),
        size: z.number().optional().describe(p.size.description),
        next: z.string().optional().describe(p.next.description)
      },
      outputSchema: {
        datasetId: z.string().describe(o.datasetId.description),
        total: z.number().describe(o.total.description),
        filteredViewUrl: z.string().describe('Link to view the filtered dataset results in table format (must be included in responses for citation and direct access to filtered view)'),
        results: z.array(z.record(z.any())).describe(o.results.description),
        next: z.string().optional().describe(o.next.description)
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async (params: { datasetId: string, query?: string, select?: string, sort?: string, filters?: Record<string, any>, bbox?: string, geoDistance?: string, dateMatch?: string, size?: number, next?: string }, extra) => {
      debug('Executing search_data tool with dataset:', params.datasetId, 'query:', params.query, 'select:', params.select, 'sort:', params.sort, 'filters:', params.filters, 'size:', params.size, 'next:', params.next)

      const baseUrl = getOrigin(extra.requestInfo?.headers)
      let fetchUrlStr: string

      if (params.next) {
        const nextUrl = new URL(params.next)
        const expectedOrigin = new URL(baseUrl).origin
        if (nextUrl.origin !== expectedOrigin) {
          throw new Error(`Invalid next URL origin: expected ${expectedOrigin}, got ${nextUrl.origin}`)
        }
        fetchUrlStr = params.next
      } else {
        const { path, query } = searchDataTool.buildQuery({
          datasetId: params.datasetId,
          q: params.query,
          filters: params.filters,
          select: params.select,
          sort: params.sort,
          size: params.size,
          bbox: params.bbox,
          geoDistance: params.geoDistance,
          dateMatch: params.dateMatch
        })
        const fetchUrl = new URL(`/data-fair/api/v1/${path}`, baseUrl)
        applyQueryToUrl(fetchUrl, query)
        fetchUrlStr = fetchUrl.toString()
      }

      let response: any
      try {
        response = (await axios.get(
          fetchUrlStr,
          buildAxiosOptions(extra.requestInfo?.headers)
        )).data
      } catch (err: any) {
        handleApiError(err)
      }

      const { text, structuredContent } = searchDataTool.formatResult(response, {
        datasetId: params.datasetId,
        q: params.query,
        filters: params.filters,
        select: params.select,
        sort: params.sort,
        size: params.size,
        bbox: params.bbox,
        geoDistance: params.geoDistance,
        dateMatch: params.dateMatch
      })

      // Add MCP-specific filtered view URL
      const filteredViewUrl = new URL(`/datasets/${encodeURIComponent(params.datasetId)}/full`, baseUrl)
      if (params.query) {
        filteredViewUrl.searchParams.set('q', params.query)
        filteredViewUrl.searchParams.set('q_mode', 'complete')
      }
      if (params.filters) {
        for (const [key, value] of Object.entries(params.filters)) {
          filteredViewUrl.searchParams.set(key, String(value))
        }
      }
      if (params.bbox) filteredViewUrl.searchParams.set('bbox', params.bbox)
      if (params.geoDistance) filteredViewUrl.searchParams.set('geo_distance', params.geoDistance)
      if (params.dateMatch) filteredViewUrl.searchParams.set('date_match', params.dateMatch)
      if (params.select) filteredViewUrl.searchParams.set('cols', params.select)
      if (params.sort) {
        const normalizedSort = normalizeSort(params.sort)
        if (normalizedSort) filteredViewUrl.searchParams.set('sort', normalizedSort)
      }
      structuredContent.filteredViewUrl = filteredViewUrl.toString()

      return {
        structuredContent,
        content: [{ type: 'text', text }]
      }
    }
  )
}
