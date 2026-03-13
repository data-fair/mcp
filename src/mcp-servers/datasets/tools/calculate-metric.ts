import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import Debug from 'debug'
import axios from '@data-fair/lib-node/axios.js'
import { getOrigin, buildAxiosOptions, encodeDatasetId, filtersSchema } from './_utils.ts'

const debug = Debug('datasets-tools')

export default (server: McpServer) => {
  server.registerTool(
    'calculate_metric',
    {
      title: 'Calculate a metric on a dataset column',
      description: 'Calculate a single metric (avg, sum, min, max, stats, value_count, cardinality, percentiles) on a dataset column. Supports filters to restrict the calculation to a subset of rows.',
      inputSchema: {
        datasetId: z.string().describe('The unique dataset ID obtained from search_datasets or provided by the user'),
        fieldKey: z.string().describe('The column key to calculate the metric on (use keys from describe_dataset)'),
        metric: z.enum(['avg', 'sum', 'min', 'max', 'stats', 'value_count', 'cardinality', 'percentiles'])
          .describe('Metric to calculate. Available: avg, sum, min, max (for numbers); min, max, cardinality, value_count (for strings); value_count (for others); stats returns count/min/max/avg/sum; percentiles returns distribution.'),
        percents: z.string().optional().describe('Comma-separated percentages for percentiles metric (default: "1,5,25,50,75,95,99"). Only used when metric is "percentiles".'),
        filters: filtersSchema
      },
      outputSchema: {
        datasetId: z.string().describe('The dataset ID that was queried'),
        fieldKey: z.string().describe('The column key that was queried'),
        metric: z.string().describe('The metric that was calculated'),
        total: z.number().describe('Total number of rows included in the calculation'),
        value: z.any().describe('The calculated metric value (number for most metrics, object for stats/percentiles)')
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async (params: { datasetId: string, fieldKey: string, metric: string, percents?: string, filters?: Record<string, string> }, extra) => {
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

      const response = (await axios.get(
        fetchUrl.toString(),
        buildAxiosOptions(extra.requestInfo?.headers)
      )).data

      const structuredContent = {
        datasetId: params.datasetId,
        fieldKey: params.fieldKey,
        metric: params.metric,
        total: response.total,
        value: response.metric
      }

      return {
        structuredContent,
        content: [
          {
            type: 'text',
            text: JSON.stringify(structuredContent)
          }
        ]
      }
    }
  )
}
