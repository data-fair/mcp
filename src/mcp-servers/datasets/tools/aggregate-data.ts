import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import Debug from 'debug'
import axios from '@data-fair/lib-node/axios.js'
import { getOrigin, buildAxiosOptions, encodeDatasetId, filtersSchema } from './_utils.ts'

const debug = Debug('datasets-tools')

/** Recursive zod type for aggregation results */
const AggregationResult: z.ZodType<any> = z.object({
  total: z.number().describe('Total number of rows aggregated for this column'),
  totalAggregated: z.number().optional().describe('Total number of different values aggregated for this column'),
  nonRepresented: z.number().optional().describe('The number of non-represented rows for this column'),
  columnValue: z.union([z.string(), z.number()]).describe('The value of the aggregated column (string or number)'),
  metricValue: z.number().nullable().optional().describe('The value of the aggregation metric (e.g., sum, avg) on the selected column'),
  aggregations: z.lazy(() => z.array(AggregationResult)).optional().describe('Nested aggregation results when multiple columns are specified (max 3 levels deep)')
})

export default (server: McpServer) => {
  server.registerTool(
    'aggregate_data',
    {
      title: 'Aggregate data from a dataset',
      description: 'Aggregate dataset rows by 1-3 columns with optional metrics (sum, avg, min, max, count). Defaults to counting unique values.',
      inputSchema: {
        datasetId: z.string().describe('The unique dataset ID obtained from search_datasets tool'),
        aggregationColumns: z.array(z.string())
          .min(1, 'You must specify at least one column to aggregate')
          .max(3, 'You can aggregate by at most 3 columns')
          .describe('List of column keys to aggregate (use keys from describe_dataset, min 1 column, max 3 columns)'),
        aggregation: z.object({
          column: z.string().describe('The column key to aggregate (use keys from describe_dataset)'),
          metric: z.enum(['sum', 'avg', 'min', 'max', 'count']).describe('Aggregation metric to perform on the column. Available operations are: sum, avg, min, max, count.')
        })
          .optional()
          .describe('The aggregation specification to perform on the specified column. Use keys from describe_dataset. If not provided, defaults to counting unique values in the aggregation column.'),
        filters: filtersSchema
      },
      outputSchema: {
        total: z.number().describe('The total number of rows in the dataset'),
        totalAggregated: z.number().describe('The total number of different values aggregated across all specified columns'),
        nonRepresented: z.number().describe('The number of non-represented rows in the dataset, 0 if totalAggregated is less than 20, otherwise the number of non-represented rows'),
        datasetId: z.string().describe('The dataset ID that was aggregated'),
        requestUrl: z.string().describe('Direct URL to API results in JSON format (must be included in responses for citation and direct access to aggregated view)'),
        aggregations: z.array(AggregationResult).describe('Array of aggregation results for each specified column (limited to 20 rows)')
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async (params: { datasetId: string, aggregationColumns: string[], aggregation?: { column: string, metric: 'sum' | 'avg' | 'min' | 'max' | 'count' }, filters?: Record<string, string> }, extra) => {
      debug('Executing aggregate_data tool with dataset:', params.datasetId, 'columns:', params.aggregationColumns, 'aggregation:', JSON.stringify(params.aggregation))

      if (params.aggregationColumns.length > 3) {
        throw new Error('You can aggregate by at most 3 columns')
      }

      const fetchUrl = new URL(`/data-fair/api/v1/datasets/${encodeDatasetId(params.datasetId)}/values_agg`, getOrigin(extra.requestInfo?.headers))

      const aggsParams = new URLSearchParams()
      aggsParams.append('field', params.aggregationColumns.slice(0, 3).join(';'))
      if (params.aggregation && params.aggregation.metric !== 'count') {
        aggsParams.append('metric', params.aggregation.metric)
        aggsParams.append('metric_field', params.aggregation.column)
      }

      if (params.filters) {
        for (const [key, value] of Object.entries(params.filters)) {
          aggsParams.append(key, value)
        }
      }

      fetchUrl.search = aggsParams.toString()

      const response = (await axios.get(
        fetchUrl.toString(),
        buildAxiosOptions(extra.requestInfo?.headers)
      )).data

      const mapAggregation = (agg: any): any => ({
        total: agg.total,
        totalAggregated: agg.total_values,
        nonRepresented: agg.total_other,
        columnValue: agg.value,
        metricValue: agg.metric,
        ...(agg.aggs && agg.aggs.length > 0 && {
          aggregations: agg.aggs.map(mapAggregation)
        })
      })

      const structuredContent = {
        total: response.total,
        totalAggregated: response.total_values,
        nonRepresented: response.total_other,
        datasetId: params.datasetId,
        requestUrl: fetchUrl.toString(),
        aggregations: response.aggs.map(mapAggregation)
      }

      return {
        structuredContent,
        content: [
          {
            type: 'text',
            text: JSON.stringify(structuredContent),
          }
        ]
      }
    }
  )
}
