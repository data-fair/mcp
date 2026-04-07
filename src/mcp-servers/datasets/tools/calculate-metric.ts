import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import Debug from 'debug'
import axios from '@data-fair/lib-node/axios.js'
import { getOrigin, buildAxiosOptions, datasetIdSchema, filtersSchema, bboxSchema, geoDistanceSchema, dateMatchSchema, handleApiError, applyQueryToUrl, getToolTitle, calculateMetric as metricTool } from './_utils.ts'

const debug = Debug('datasets-tools')
const p = metricTool.schema.inputSchema.properties
const o = metricTool.schema.outputSchema.properties

export default (server: McpServer) => {
  server.registerTool(
    metricTool.schema.name,
    {
      title: getToolTitle(metricTool.annotations),
      description: metricTool.schema.description,
      inputSchema: {
        datasetId: datasetIdSchema,
        fieldKey: z.string().describe(p.fieldKey.description),
        metric: z.enum(['avg', 'sum', 'min', 'max', 'stats', 'value_count', 'cardinality', 'percentiles'])
          .describe(p.metric.description),
        percents: z.string().optional().describe(p.percents.description),
        filters: filtersSchema,
        bbox: bboxSchema,
        geoDistance: geoDistanceSchema,
        dateMatch: dateMatchSchema
      },
      outputSchema: {
        datasetId: z.string().describe(o.datasetId.description),
        fieldKey: z.string().describe(o.fieldKey.description),
        total: z.number().describe(o.total.description),
        value: z.any().describe(o.metric.description)
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async (params: { datasetId: string, fieldKey: string, metric: string, percents?: string, filters?: Record<string, string>, bbox?: string, geoDistance?: string, dateMatch?: string }, extra) => {
      debug('Executing calculate_metric tool with dataset:', params.datasetId, 'field:', params.fieldKey, 'metric:', params.metric)

      const baseUrl = getOrigin(extra.requestInfo?.headers)
      const { path, query } = metricTool.buildQuery(params)
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

      const { text, structuredContent } = metricTool.formatResult(response, params)

      return {
        structuredContent,
        content: [{ type: 'text', text }]
      }
    }
  )
}
