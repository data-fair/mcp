import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import Debug from 'debug'
import axios from '@data-fair/lib-node/axios.js'
import { getOrigin, buildAxiosOptions, encodeDatasetId } from './_utils.ts'

const debug = Debug('datasets-tools')

export default (server: McpServer) => {
  server.registerTool(
    'get_field_values',
    {
      title: 'Get distinct values of a dataset column',
      description: 'List distinct values of a specific column. Useful to discover what values exist before filtering, or to populate a filter list.',
      inputSchema: {
        datasetId: z.string().describe('The unique dataset ID obtained from search_datasets or provided by the user'),
        fieldKey: z.string().describe('The column key to get values for (use keys from describe_dataset)'),
        query: z.string().optional().describe('Optional text to filter values (prefix/substring match within this column)'),
        sort: z.enum(['asc', 'desc']).optional().describe('Sort order for the values (default: asc)'),
        size: z.number().min(1).max(1000).optional().describe('Number of values to return (default: 10, max: 1000)')
      },
      outputSchema: {
        datasetId: z.string().describe('The dataset ID that was queried'),
        fieldKey: z.string().describe('The column key that was queried'),
        values: z.array(z.union([z.string(), z.number()])).describe('Array of distinct values for the specified column')
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async (params: { datasetId: string, fieldKey: string, query?: string, sort?: 'asc' | 'desc', size?: number }, extra) => {
      debug('Executing get_field_values tool with dataset:', params.datasetId, 'field:', params.fieldKey)

      const fetchUrl = new URL(
        `/data-fair/api/v1/datasets/${encodeDatasetId(params.datasetId)}/values/${encodeURIComponent(params.fieldKey)}`,
        getOrigin(extra.requestInfo?.headers)
      )
      if (params.query) fetchUrl.searchParams.set('q', params.query)
      if (params.sort) fetchUrl.searchParams.set('sort', params.sort)
      fetchUrl.searchParams.set('size', String(params.size ?? 10))

      const values = (await axios.get(
        fetchUrl.toString(),
        buildAxiosOptions(extra.requestInfo?.headers)
      )).data

      const structuredContent = {
        datasetId: params.datasetId,
        fieldKey: params.fieldKey,
        values
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
