import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import Debug from 'debug'
import axios from '@data-fair/lib-node/axios.js'
import { getOrigin, buildAxiosOptions, encodeDatasetId, filtersSchema, bboxSchema, geoDistanceSchema, applyGeoParams, handleApiError } from './_utils.ts'

const debug = Debug('datasets-tools')

export default (server: McpServer) => {
  server.registerTool(
    'calculate_metric',
    {
      title: 'Calculate a metric on a dataset column',
      description: 'Calculate a single metric (avg, sum, min, max, stats, value_count, cardinality, percentiles) on a dataset column. Supports filters to restrict the calculation to a subset of rows. Use for a single statistic on the whole dataset or a filtered subset. For per-group breakdowns, use aggregate_data instead.',
      inputSchema: {
        datasetId: z.string().describe('The exact dataset ID from the "id" field in search_datasets results. Do not use the title or slug.'),
        fieldKey: z.string().describe('The column key to calculate the metric on (use keys from describe_dataset)'),
        metric: z.enum(['avg', 'sum', 'min', 'max', 'stats', 'value_count', 'cardinality', 'percentiles'])
          .describe('Metric to calculate. Available: avg, sum, min, max (for numbers); min, max, cardinality, value_count (for strings); value_count (for others); stats returns count/min/max/avg/sum; percentiles returns distribution.'),
        percents: z.string().optional().describe('Comma-separated percentages for percentiles metric (default: "1,5,25,50,75,95,99"). Only used when metric is "percentiles".'),
        filters: filtersSchema,
        bbox: bboxSchema,
        geoDistance: geoDistanceSchema
      },
      outputSchema: {
        datasetId: z.string().describe('The dataset ID that was queried'),
        fieldKey: z.string().describe('The column key that was queried'),
        metric: z.string().describe('The metric that was calculated'),
        total: z.number().describe('Total number of rows included in the calculation'),
        value: z.any().describe('The calculated metric value. For avg/sum/min/max/value_count/cardinality: a single number. For stats: an object {count, min, max, avg, sum}. For percentiles: an object mapping percentage strings to values, e.g. {"25": 30000, "50": 42000, "75": 55000}.')
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async (params: { datasetId: string, fieldKey: string, metric: string, percents?: string, filters?: Record<string, string>, bbox?: string, geoDistance?: string }, extra) => {
      debug('Executing calculate_metric tool with dataset:', params.datasetId, 'field:', params.fieldKey, 'metric:', params.metric)

      const fetchUrl = new URL(
        `/data-fair/api/v1/datasets/${encodeDatasetId(params.datasetId)}/metric_agg`,
        getOrigin(extra.requestInfo?.headers)
      )
      fetchUrl.searchParams.set('metric', params.metric)
      fetchUrl.searchParams.set('field', params.fieldKey)
      if (params.percents) fetchUrl.searchParams.set('percents', params.percents)

      if (params.filters) {
        for (const [key, value] of Object.entries(params.filters)) {
          fetchUrl.searchParams.set(key, String(value))
        }
      }

      applyGeoParams(fetchUrl, params.bbox, params.geoDistance)

      let response: any
      try {
        response = (await axios.get(
          fetchUrl.toString(),
          buildAxiosOptions(extra.requestInfo?.headers)
        )).data
      } catch (err: any) {
        handleApiError(err)
      }

      const structuredContent = {
        datasetId: params.datasetId,
        fieldKey: params.fieldKey,
        metric: params.metric,
        total: response.total,
        value: response.metric
      }

      let resultStr: string
      if (params.metric === 'stats' && typeof structuredContent.value === 'object' && structuredContent.value !== null) {
        resultStr = Object.entries(structuredContent.value).map(([k, v]) => `${k}=${v}`).join(', ')
      } else if (params.metric === 'percentiles' && typeof structuredContent.value === 'object' && structuredContent.value !== null) {
        resultStr = Object.entries(structuredContent.value).map(([k, v]) => `${k}%=${v}`).join(', ')
      } else {
        resultStr = String(structuredContent.value)
      }

      const text = [
        `Metric: ${params.metric} of "${params.fieldKey}"`,
        `Dataset: ${params.datasetId}`,
        `Total rows: ${structuredContent.total}`,
        `Result: ${resultStr}`
      ].join('\n')

      return {
        structuredContent,
        content: [{ type: 'text', text }]
      }
    }
  )
}
