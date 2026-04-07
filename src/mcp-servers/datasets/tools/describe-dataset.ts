import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import Debug from 'debug'
import axios from '@data-fair/lib-node/axios.js'
import { getOrigin, buildAxiosOptions, datasetIdSchema, handleApiError, applyQueryToUrl, getToolTitle, getDatasetSchema as schemaTool, describeDataset as describeTool } from './_utils.ts'

const debug = Debug('datasets-tools')
const o = describeTool.schema.outputSchema.properties

export default (server: McpServer) => {
  server.registerTool(
    describeTool.schema.name,
    {
      title: getToolTitle(describeTool.annotations),
      description: describeTool.schema.description,
      inputSchema: {
        datasetId: datasetIdSchema
      },
      outputSchema: {
        id: z.string().describe(o.id.description),
        slug: z.string().optional().describe(o.slug.description),
        title: z.string().describe(o.title.description),
        summary: z.string().optional().describe(o.summary.description),
        description: z.string().optional().describe(o.description.description),
        page: z.string().describe(o.page.description),
        count: z.number().describe(o.count.description),
        keywords: z.array(z.string()).optional().describe(o.keywords.description),
        origin: z.string().optional().describe(o.origin.description),
        license: z.object({
          href: z.string().describe(o.license.properties.href.description),
          title: z.string().describe(o.license.properties.title.description)
        }).optional().describe(o.license.description),
        topics: z.array(z.string()).optional().describe(o.topics.description),
        spatial: z.any().optional().describe(o.spatial.description),
        temporal: z.any().optional().describe(o.temporal.description),
        frequency: z.string().optional().describe(o.frequency.description),
        geolocalized: z.boolean().optional().describe(o.geolocalized.description),
        bbox: z.array(z.number()).optional().describe(o.bbox.description),
        temporalDataset: z.boolean().optional().describe(o.temporalDataset.description),
        timePeriod: z.object({
          startDate: z.string().describe(o.timePeriod.properties.startDate.description),
          endDate: z.string().describe(o.timePeriod.properties.endDate.description)
        }).optional().describe(o.timePeriod.description),
        schema: z.array(z.object({
          key: z.string().describe(o.schema.items.properties.key.description),
          type: z.string().describe(o.schema.items.properties.type.description),
          title: z.string().optional().describe(o.schema.items.properties.title.description),
          description: z.string().optional().describe(o.schema.items.properties.description.description),
          enum: z.array(z.any()).optional().describe(o.schema.items.properties.enum.description),
          enumTruncated: z.boolean().optional().describe(o.schema.items.properties.enumTruncated.description),
          enumTotal: z.number().optional().describe(o.schema.items.properties.enumTotal.description),
          labels: z.record(z.string()).optional().describe(o.schema.items.properties.labels.description),
          concept: z.string().optional().describe(o.schema.items.properties.concept.description)
        })).describe(o.schema.description),
        sampleLines: z.array(z.record(z.any())).describe(o.sampleLines.description)
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async (params: { datasetId: string }, extra) => {
      debug('Executing describe_dataset tool with datasetId:', params.datasetId)

      const baseUrl = getOrigin(extra.requestInfo?.headers)

      let fetchedData: any
      try {
        fetchedData = (await axios.get(
          new URL(`/data-fair/api/v1/datasets/${encodeURIComponent(params.datasetId)}`, baseUrl).toString(),
          buildAxiosOptions(extra.requestInfo?.headers)
        )).data
      } catch (err: any) {
        handleApiError(err)
      }

      const { samplesReq } = schemaTool.buildQuery(params)
      const sampleUrl = new URL(`/data-fair/api/v1/${samplesReq.path}`, baseUrl)
      applyQueryToUrl(sampleUrl, samplesReq.query)

      let sampleLines: any[] = []
      try {
        sampleLines = (await axios.get(
          sampleUrl.toString(),
          buildAxiosOptions(extra.requestInfo?.headers)
        )).data.results
      } catch (err: any) {
        handleApiError(err)
      }

      const { text, structuredContent } = describeTool.formatResult(fetchedData, { sampleLines })

      return {
        structuredContent,
        content: [{ type: 'text', text }]
      }
    }
  )
}
