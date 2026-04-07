import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import Debug from 'debug'
import axios from '@data-fair/lib-node/axios.js'
import { getOrigin, buildAxiosOptions, handleApiError, applyQueryToUrl, getToolTitle, listDatasets as listDatasetsTool } from './_utils.ts'

const debug = Debug('datasets-tools')
const p = listDatasetsTool.schema.inputSchema.properties
const o = listDatasetsTool.schema.outputSchema.properties

export default (server: McpServer) => {
  server.registerTool(
    listDatasetsTool.schema.name,
    {
      title: getToolTitle(listDatasetsTool.annotations),
      description: listDatasetsTool.schema.description,
      inputSchema: {
        q: z.string().optional().describe(p.q.description),
        page: z.number().optional().describe(p.page.description),
        size: z.number().optional().describe(p.size.description)
      },
      outputSchema: {
        count: z.number().describe(o.count.description),
        results: z.array(z.object({
          id: z.string().describe(o.results.items.properties.id.description),
          title: z.string().describe(o.results.items.properties.title.description),
          page: z.string().describe(o.results.items.properties.page.description),
          summary: z.string().optional().describe(o.results.items.properties.summary.description)
        })).describe(o.results.description)
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async (params: { q?: string, page?: number, size?: number }, extra) => {
      debug('Executing list_datasets tool with q:', params.q, 'page:', params.page, 'size:', params.size)

      const baseUrl = getOrigin(extra.requestInfo?.headers)
      const { path, query } = listDatasetsTool.buildQuery({ q: params.q, page: params.page, size: params.size }, true)
      const fetchUrl = new URL(`/data-fair/api/v1/${path}`, baseUrl)
      applyQueryToUrl(fetchUrl, query)

      let fetchedData: any
      try {
        fetchedData = (await axios.get(
          fetchUrl.toString(),
          buildAxiosOptions(extra.requestInfo?.headers)
        )).data
      } catch (err: any) {
        handleApiError(err)
      }

      const { text, structuredContent } = listDatasetsTool.formatResult(fetchedData, params.page ?? 1, params.size ?? 10)

      return {
        structuredContent,
        content: [{ type: 'text', text }]
      }
    }
  )
}
