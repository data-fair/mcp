import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import Debug from 'debug'
import axios from '@data-fair/lib-node/axios.js'
import { getOrigin, buildAxiosOptions, datasetIdSchema, filtersSchema, bboxSchema, geoDistanceSchema, dateMatchSchema, handleApiError, applyQueryToUrl, getToolTitle, aggregateData as aggTool } from './_utils.ts'

const debug = Debug('datasets-tools')
const p = aggTool.schema.inputSchema.properties
const o = aggTool.schema.outputSchema.properties

export default (server: McpServer) => {
  server.registerTool(
    aggTool.schema.name,
    {
      title: getToolTitle(aggTool.annotations),
      description: aggTool.schema.description,
      inputSchema: {
        datasetId: datasetIdSchema,
        groupByColumns: z.array(z.string())
          .min(1, 'You must specify at least one column to group by')
          .max(3, 'You can group by at most 3 columns')
          .describe(p.groupByColumns.description),
        metric: z.object({
          column: z.string().describe(p.metric.properties.column.description),
          type: z.enum(['sum', 'avg', 'min', 'max', 'count']).describe(p.metric.properties.type.description)
        })
          .optional()
          .describe(p.metric.description),
        filters: filtersSchema,
        bbox: bboxSchema,
        geoDistance: geoDistanceSchema,
        dateMatch: dateMatchSchema,
        sort: z.string().optional().describe(p.sort.description)
      },
      outputSchema: {
        datasetId: z.string().describe(o.datasetId.description),
        total: z.number().describe(o.total.description),
        total_values: z.number().describe(o.total_values.description),
        total_other: z.number().describe(o.total_other.description),
        requestUrl: z.string().describe('Direct URL to API results in JSON format (must be included in responses for citation and direct access to aggregated view)'),
        aggs: z.array(z.any()).describe(o.aggs.description)
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async (params: { datasetId: string, groupByColumns: string[], metric?: { column: string, type: 'sum' | 'avg' | 'min' | 'max' | 'count' }, filters?: Record<string, string>, bbox?: string, geoDistance?: string, dateMatch?: string, sort?: string }, extra) => {
      debug('Executing aggregate_data tool with dataset:', params.datasetId, 'columns:', params.groupByColumns, 'metric:', JSON.stringify(params.metric))

      const baseUrl = getOrigin(extra.requestInfo?.headers)
      const { path, query } = aggTool.buildQuery(params)
      const fetchUrl = new URL(`/data-fair/api/v1/${path}`, baseUrl)
      applyQueryToUrl(fetchUrl, query)

      let response: any
      try {
        response = (await axios.get(
          fetchUrl.toString(),
          buildAxiosOptions(extra.requestInfo?.headers)
        )).data
      } catch (err: any) {
        handleApiError(err)
      }

      const { text, structuredContent } = aggTool.formatResult(response, params)
      structuredContent.requestUrl = fetchUrl.toString()

      return {
        structuredContent,
        content: [{ type: 'text', text }]
      }
    }
  )
}
