import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import Debug from 'debug'
import axios from '@data-fair/lib-node/axios.js'
import { getOrigin, buildAxiosOptions, encodeDatasetId, filtersSchema, handleApiError, formatTextOutput } from './_utils.ts'
import csvStringify from 'csv-stringify/sync'

const debug = Debug('datasets-tools')

export default (server: McpServer) => {
  server.registerTool(
    'search_data',
    {
      title: 'Search data from a dataset',
      description: 'Search for data rows in a dataset using full-text search (query) or precise column filters. Returns matching rows and a filtered view URL. Use to retrieve individual rows. Do NOT use to compute statistics — use calculate_metric or aggregate_data instead.',
      inputSchema: {
        datasetId: z.string().describe('The exact dataset ID from the "id" field in search_datasets results. Do not use the title or slug.'),
        query: z.string().optional().describe('French keywords for full-text search across all dataset columns (simple keywords, not sentences). Can be combined with filters, but prefer filters alone when criteria target specific columns. Use query for broad keyword matching across all columns. Examples: "Jean Dupont", "Paris", "2025"'),
        filters: filtersSchema,
        select: z.string().optional().describe('Optional comma-separated list of column keys to include in the results. Useful when the dataset has many columns to reduce output size. If not provided, all columns are returned. Use column keys from describe_dataset. Format: column1,column2,column3 (No spaces after commas). Example: "nom,age,ville"'),
        sort: z.string().optional().describe('Sort order for results. Comma-separated list of column keys. Prefix with - for descending order. Special keys: _score (relevance), _i (index order), _updatedAt, _rand (random). Examples: "population" (ascending), "-population" (descending), "city,-population" (city asc then population desc)'),
        size: z.number().optional().describe('Number of rows to return per page (default: 10, max: 50). Increase when you know you need more results upfront to avoid multiple pagination round-trips.'),
        next: z.string().optional().describe('URL from a previous search_data response to fetch the next page of results. When provided, all other parameters (query, filters, select, sort, size) are ignored since the URL already contains them.')
      },
      outputSchema: {
        datasetId: z.string().describe('The dataset ID that was searched'),
        count: z.number().describe('Number of data rows matching the search criteria and filters'),
        filteredViewUrl: z.string().describe('Link to view the filtered dataset results in table format (must be included in responses for citation and direct access to filtered view)'),
        lines: z.array(
          z.record(z.any()).describe('Data row object containing column keys as object keys with their values, plus _score field indicating search relevance (higher score = more relevant)')
        ).describe('An array of data rows matching the search criteria (up to the requested size).'),
        next: z.string().optional().describe('URL to fetch the next page of results. Absent when there are no more results. Pass this value as the next input parameter to get the next page.')
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async (params: { datasetId: string, query?: string, select?: string, sort?: string, filters?: Record<string, any>, size?: number, next?: string }, extra) => {
      debug('Executing search_data tool with dataset:', params.datasetId, 'query:', params.query, 'select:', params.select, 'sort:', params.sort, 'filters:', params.filters, 'size:', params.size, 'next:', params.next)

      let fetchUrlStr: string
      const baseUrl = getOrigin(extra.requestInfo?.headers)

      if (params.next) {
        const nextUrl = new URL(params.next)
        const expectedOrigin = new URL(baseUrl).origin
        if (nextUrl.origin !== expectedOrigin) {
          throw new Error(`Invalid next URL origin: expected ${expectedOrigin}, got ${nextUrl.origin}`)
        }
        fetchUrlStr = params.next
      } else {
        const fetchUrl = new URL(`/data-fair/api/v1/datasets/${encodeDatasetId(params.datasetId)}/lines`, baseUrl)

        if (params.query) {
          fetchUrl.searchParams.set('q', params.query)
          fetchUrl.searchParams.set('q_mode', 'complete')
        }

        if (params.filters) {
          for (const [key, value] of Object.entries(params.filters)) {
            fetchUrl.searchParams.set(key, String(value))
          }
        }

        if (params.select) {
          fetchUrl.searchParams.set('select', params.select.split(',').map(s => s.trim()).join(','))
        }

        if (params.sort) {
          fetchUrl.searchParams.set('sort', params.sort)
        }

        const size = Math.min(Math.max(params.size || 10, 1), 50)
        fetchUrl.searchParams.set('size', String(size))

        fetchUrlStr = fetchUrl.toString()
      }

      const filteredViewUrlObj = new URL(`/datasets/${encodeDatasetId(params.datasetId)}/full`, baseUrl)
      if (params.query) {
        filteredViewUrlObj.searchParams.set('q', params.query)
        filteredViewUrlObj.searchParams.set('q_mode', 'complete')
      }
      if (params.filters) {
        for (const [key, value] of Object.entries(params.filters)) {
          filteredViewUrlObj.searchParams.set(key, String(value))
        }
      }
      if (params.select) {
        filteredViewUrlObj.searchParams.set('cols', params.select)
      }
      if (params.sort) {
        filteredViewUrlObj.searchParams.set('sort', params.sort)
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

      const structuredContent: Record<string, any> = {
        datasetId: params.datasetId,
        count: response.total,
        filteredViewUrl: filteredViewUrlObj.toString(),
        lines: response.results.map((line: any) => {
          const { _id, _i, _rand, ...clean } = line
          return clean
        })
      }

      if (response.next) {
        structuredContent.next = response.next
      }

      const resultCount = structuredContent.lines.length
      const csvData = csvStringify(structuredContent.lines, { header: true }).trimEnd()

      const headerBlock = [
        `${resultCount} results (${structuredContent.count} total)`,
        `Filtered view: ${structuredContent.filteredViewUrl}`
      ].join('\n')

      const sections = [headerBlock, csvData]

      if (structuredContent.next) {
        sections.push('Next page available.')
      }

      const text = formatTextOutput(sections)

      return {
        structuredContent,
        content: [{ type: 'text', text }]
      }
    }
  )
}
