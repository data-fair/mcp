import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import Debug from 'debug'
import axios from '@data-fair/lib-node/axios.js'
import { getOrigin, buildAxiosOptions, encodeDatasetId, filtersSchema } from './_utils.ts'

const debug = Debug('datasets-tools')

export default (server: McpServer) => {
  server.registerTool(
    'search_data',
    {
      title: 'Search data from a dataset',
      description: 'Search for data rows in a dataset using full-text search (query) or precise column filters. Returns matching rows and a filtered view URL.',
      inputSchema: {
        datasetId: z.string().describe('The unique dataset ID obtained from search_datasets or provided by the user'),
        query: z.string().optional().describe('French keywords for full-text search across all dataset columns (simple keywords, not sentences). Do not use with filters parameter. Examples: "Jean Dupont", "Paris", "2025"'),
        filters: filtersSchema,
        select: z.string().optional().describe('Optional comma-separated list of column keys to include in the results. Useful when the dataset has many columns to reduce output size. If not provided, all columns are returned. Use column keys from describe_dataset. Format: column1,column2,column3 (No spaces after commas). Example: "nom,age,ville"')
      },
      outputSchema: {
        datasetId: z.string().describe('The dataset ID that was searched'),
        count: z.number().describe('Number of data rows matching the search criteria and filters'),
        filteredViewUrl: z.string().describe('Link to view the filtered dataset results in table format (must be included in responses for citation and direct access to filtered view)'),
        lines: z.array(
          z.record(z.any()).describe('Data row object containing column keys as object keys with their values, plus _score field indicating search relevance (higher score = more relevant)')
        ).describe('An array of the top 10 data rows matching the search criteria.')
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async (params: { datasetId: string, query?: string, select?: string, filters?: Record<string, any> }, extra) => {
      debug('Executing search_data tool with dataset:', params.datasetId, 'query:', params.query, 'select:', params.select, 'filters:', params.filters)

      const fetchParams = new URLSearchParams()
      const viewParams = new URLSearchParams()

      if (params.query) {
        fetchParams.append('q', params.query)
        fetchParams.append('q_mode', 'complete')
        viewParams.append('q', params.query)
        viewParams.append('q_mode', 'complete')
      }

      if (params.filters) {
        for (const [key, value] of Object.entries(params.filters)) {
          fetchParams.append(key, String(value))
          viewParams.append(key, String(value))
        }
      }

      if (params.select) {
        fetchParams.append('select', params.select)
        viewParams.append('cols', params.select)
      }

      fetchParams.append('size', '10')

      const baseUrl = getOrigin(extra.requestInfo?.headers)
      const fetchUrl = new URL(`/data-fair/api/v1/datasets/${encodeDatasetId(params.datasetId)}/lines`, baseUrl)
      fetchUrl.search = fetchParams.toString()

      const filteredViewUrlObj = new URL(`/datasets/${encodeDatasetId(params.datasetId)}/full`, baseUrl)
      filteredViewUrlObj.search = viewParams.toString()

      const response = (await axios.get(
        fetchUrl.toString(),
        buildAxiosOptions(extra.requestInfo?.headers)
      )).data

      const structuredContent = {
        datasetId: params.datasetId,
        count: response.total,
        filteredViewUrl: filteredViewUrlObj.toString(),
        lines: response.results
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
