import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import Debug from 'debug'
import axios from '@data-fair/lib-node/axios.js'
import { getOrigin, buildAxiosOptions, encodeDatasetId, filtersSchema, bboxSchema, geoDistanceSchema, applyGeoParams, handleApiError, formatTextOutput } from './_utils.ts'

const debug = Debug('datasets-tools')

/** Recursive zod type for aggregation results */
const AggregationResult: z.ZodType<any> = z.object({
  total: z.number().describe('Total number of rows aggregated for this column'),
  totalAggregated: z.number().optional().describe('Total number of different values aggregated for this column'),
  nonRepresented: z.number().optional().describe('Number of rows NOT included in the returned aggregations for this column (only top groups are returned)'),
  columnValue: z.union([z.string(), z.number()]).describe('The value of the aggregated column (string or number)'),
  metricValue: z.number().nullable().optional().describe('The value of the aggregation metric (e.g., sum, avg) on the selected column'),
  aggregations: z.lazy(() => z.array(AggregationResult)).optional().describe('Nested aggregation results when multiple columns are specified (max 3 levels deep)')
})

export default (server: McpServer) => {
  server.registerTool(
    'aggregate_data',
    {
      title: 'Aggregate data from a dataset',
      description: 'Aggregate dataset rows by 1-3 columns with optional metrics (sum, avg, min, max, count). Defaults to counting rows per group. Use for grouped counts or grouped metrics (e.g., average salary per city). For a single global metric without grouping, use calculate_metric instead.',
      inputSchema: {
        datasetId: z.string().describe('The exact dataset ID from the "id" field in search_datasets results. Do not use the title or slug.'),
        groupByColumns: z.array(z.string())
          .min(1, 'You must specify at least one column to group by')
          .max(3, 'You can group by at most 3 columns')
          .describe('Columns to GROUP BY (like SQL GROUP BY). These define the categories/buckets, NOT the column to compute metrics on. Use column keys from describe_dataset (min 1, max 3).'),
        metric: z.object({
          column: z.string().describe('The column to compute the metric ON (e.g., "salary" for average salary). This is NOT the grouping column. Use column keys from describe_dataset.'),
          type: z.enum(['sum', 'avg', 'min', 'max', 'count']).describe('Metric to compute on each group. "count" counts rows per group (identical to omitting the metric parameter — does NOT count non-null values of the specified column).')
        })
          .optional()
          .describe('Optional metric to compute ON EACH GROUP. If not provided, defaults to counting rows per group.'),
        filters: filtersSchema,
        bbox: bboxSchema,
        geoDistance: geoDistanceSchema,
        sort: z.string().optional().describe('Sort order for aggregation results. Use special keys: "count" or "-count" (by row count asc/desc), "key" or "-key" (by column value asc/desc), "metric" or "-metric" (by metric value asc/desc). Default: sorts by metric desc (if metric specified), then count desc. Example: "-count" to sort by most frequent values first')
      },
      outputSchema: {
        total: z.number().describe('The total number of rows in the dataset'),
        totalAggregated: z.number().describe('The total number of different values aggregated across all specified columns'),
        nonRepresented: z.number().describe('Number of rows NOT included in the returned aggregations (only the top 20 groups are returned). Add this to the sum of all group totals to reconstruct the dataset total.'),
        datasetId: z.string().describe('The dataset ID that was aggregated'),
        requestUrl: z.string().describe('Direct URL to API results in JSON format (must be included in responses for citation and direct access to aggregated view)'),
        aggregations: z.array(AggregationResult).describe('Array of aggregation results for each specified column (limited to 20 rows)')
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async (params: { datasetId: string, groupByColumns: string[], metric?: { column: string, type: 'sum' | 'avg' | 'min' | 'max' | 'count' }, filters?: Record<string, string>, bbox?: string, geoDistance?: string, sort?: string }, extra) => {
      debug('Executing aggregate_data tool with dataset:', params.datasetId, 'columns:', params.groupByColumns, 'metric:', JSON.stringify(params.metric))

      const fetchUrl = new URL(`/data-fair/api/v1/datasets/${encodeDatasetId(params.datasetId)}/values_agg`, getOrigin(extra.requestInfo?.headers))

      fetchUrl.searchParams.set('field', params.groupByColumns.join(';'))
      if (params.metric && params.metric.type !== 'count') {
        fetchUrl.searchParams.set('metric', params.metric.type)
        fetchUrl.searchParams.set('metric_field', params.metric.column)
      }

      if (params.filters) {
        for (const [key, value] of Object.entries(params.filters)) {
          fetchUrl.searchParams.set(key, value)
        }
      }

      applyGeoParams(fetchUrl, params.bbox, params.geoDistance)

      if (params.sort) {
        fetchUrl.searchParams.set('sort', params.sort)
      }

      let response: any
      try {
        response = (await axios.get(
          fetchUrl.toString(),
          buildAxiosOptions(extra.requestInfo?.headers)
        )).data
      } catch (err: any) {
        handleApiError(err)
      }

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

      const formatAggLine = (agg: any, metric: typeof params.metric, indent: string): string => {
        let line = `${indent}- ${agg.columnValue}: ${agg.total} rows`
        if (metric && metric.type !== 'count' && agg.metricValue != null) {
          line += `, ${metric.type} ${metric.column} = ${agg.metricValue}`
        }
        if (agg.aggregations) {
          for (const sub of agg.aggregations) {
            line += '\n' + formatAggLine(sub, metric, indent + '  ')
          }
        }
        return line
      }

      const aggLines = structuredContent.aggregations
        .map((agg: any) => formatAggLine(agg, params.metric, ''))
        .join('\n')

      const headerBlock = [
        `Aggregation on dataset ${params.datasetId}`,
        `Total: ${structuredContent.total} rows | Groups shown: ${structuredContent.totalAggregated} | Rows not shown: ${structuredContent.nonRepresented}`,
        `API URL: ${structuredContent.requestUrl}`
      ].join('\n')

      const text = formatTextOutput([headerBlock, aggLines])

      return {
        structuredContent,
        content: [{ type: 'text', text }]
      }
    }
  )
}
