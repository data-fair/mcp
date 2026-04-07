import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import Debug from 'debug'
import axios from '@data-fair/lib-node/axios.js'
import { getOrigin, buildAxiosOptions, datasetIdSchema, handleApiError, applyQueryToUrl, getToolTitle, getFieldValues as fieldValuesTool } from './_utils.ts'

const debug = Debug('datasets-tools')
const p = fieldValuesTool.schema.inputSchema.properties
const o = fieldValuesTool.schema.outputSchema.properties

export default (server: McpServer) => {
  server.registerTool(
    fieldValuesTool.schema.name,
    {
      title: getToolTitle(fieldValuesTool.annotations),
      description: fieldValuesTool.schema.description,
      inputSchema: {
        datasetId: datasetIdSchema,
        fieldKey: z.string().describe(p.fieldKey.description),
        query: z.string().optional().describe(p.q.description),
        sort: z.enum(['asc', 'desc']).optional().describe(p.sort.description),
        size: z.number().min(1).max(1000).optional().describe(p.size.description)
      },
      outputSchema: {
        datasetId: z.string().describe(o.datasetId.description),
        fieldKey: z.string().describe(o.fieldKey.description),
        values: z.array(z.union([z.string(), z.number()])).describe(o.values.description)
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async (params: { datasetId: string, fieldKey: string, query?: string, sort?: 'asc' | 'desc', size?: number }, extra) => {
      debug('Executing get_field_values tool with dataset:', params.datasetId, 'field:', params.fieldKey)

      const baseUrl = getOrigin(extra.requestInfo?.headers)
      const { path, query } = fieldValuesTool.buildQuery({
        datasetId: params.datasetId,
        fieldKey: params.fieldKey,
        q: params.query,
        sort: params.sort,
        size: params.size
      })
      const fetchUrl = new URL(`/data-fair/api/v1/${path}`, baseUrl)
      applyQueryToUrl(fetchUrl, query)

      let values: any
      try {
        values = (await axios.get(
          fetchUrl.toString(),
          buildAxiosOptions(extra.requestInfo?.headers)
        )).data
      } catch (err: any) {
        handleApiError(err)
      }

      const { text, structuredContent } = fieldValuesTool.formatResult(values, {
        datasetId: params.datasetId,
        fieldKey: params.fieldKey,
        q: params.query,
        sort: params.sort,
        size: params.size
      })

      return {
        structuredContent,
        content: [{ type: 'text', text }]
      }
    }
  )
}
