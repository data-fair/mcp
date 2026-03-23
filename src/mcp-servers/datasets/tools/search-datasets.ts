import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import Debug from 'debug'
import axios from '@data-fair/lib-node/axios.js'
import { getOrigin, buildAxiosOptions, handleApiError, formatTextOutput } from './_utils.ts'

const debug = Debug('datasets-tools')

export default (server: McpServer) => {
  server.registerTool(
    'search_datasets',
    {
      title: 'Search Datasets',
      description: 'Full-text search for datasets by French keywords. Returns matching datasets with ID, title, summary, and page link.',
      inputSchema: {
        query: z.string().min(3, 'Search term must be at least 3 characters long').describe('French keywords for full-text search (simple terms, not sentences). If 0 results, try synonyms or broader terms. Examples: "élus", "DPE", "entreprises", "logement social"')
      },
      outputSchema: {
        count: z.number().describe('Number of datasets matching the full-text search criteria'),
        datasets: z.array(
          z.object({
            id: z.string().describe('Unique dataset ID (required for describe_dataset and search_data tools)'),
            title: z.string().describe('Dataset title'),
            summary: z.string().optional().describe('A summary of the dataset content'),
            link: z.string().describe('Link to the dataset page (must be included in responses as citation source)'),
          })
        ).describe('An array of the top 20 datasets matching the full-text search criteria.')
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async (params: { query: string }, extra) => {
      debug('Executing search_dataset tool with query:', params.query)

      const fetchUrl = new URL('/data-fair/api/v1/catalog/datasets', getOrigin(extra.requestInfo?.headers))
      fetchUrl.searchParams.set('q', params.query)
      fetchUrl.searchParams.set('size', '20')
      fetchUrl.searchParams.set('select', 'id,title,summary')

      let fetchedData: any
      try {
        fetchedData = (await axios.get(
          fetchUrl.toString(),
          buildAxiosOptions(extra.requestInfo?.headers)
        )).data
      } catch (err: any) {
        handleApiError(err)
      }

      const structuredContent = {
        datasets: fetchedData.results.map((dataset: any) => {
          const result: any = {
            id: dataset.id,
            title: dataset.title,
            link: dataset.page
          }

          if (dataset.summary) result.summary = dataset.summary

          return result
        }),
        count: fetchedData.count
      }

      const datasetLines = structuredContent.datasets.map((d: any) => {
        let line = `- ${d.title} (id: ${d.id})`
        if (d.summary) line += `\n  ${d.summary}`
        line += `\n  Link: ${d.link}`
        return line
      }).join('\n\n')

      const text = formatTextOutput([
        `${structuredContent.count} datasets found.`,
        datasetLines
      ])

      return {
        structuredContent,
        content: [{ type: 'text', text }]
      }
    }
  )
}
