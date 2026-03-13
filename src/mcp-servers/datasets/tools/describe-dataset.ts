import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import Debug from 'debug'
import axios from '@data-fair/lib-node/axios.js'
import { getOrigin, buildAxiosOptions, encodeDatasetId } from './_utils.ts'

const debug = Debug('datasets-tools')

export default (server: McpServer) => {
  server.registerTool(
    'describe_dataset',
    {
      title: 'Describe Dataset',
      description: 'Get detailed metadata for a dataset: column schema, sample rows, license, spatial/temporal coverage.',
      inputSchema: {
        datasetId: z.string().describe('The unique dataset ID obtained from search_datasets or provided by the user')
      },
      outputSchema: {
        id: z.string().describe('Unique dataset Id (required for search_data tools)'),
        slug: z.string().optional().describe('Human-readable unique identifier for the dataset, used in URLs'),
        title: z.string().describe('Dataset title'),
        summary: z.string().optional().describe('A brief summary of the dataset content'),
        description: z.string().optional().describe('A markdown description of the dataset content'),
        link: z.string().describe('Link to the dataset page (must be included in responses as citation source)'),
        count: z.number().describe('Total number of data rows in the dataset'),
        keywords: z.array(z.string()).optional().describe('Keywords associated with the dataset'),
        origin: z.string().optional().describe('Source or provider of the dataset'),
        license: z.object({
          href: z.string().describe('URL to the license text'),
          title: z.string().describe('License name/title')
        }).optional().describe('Dataset license information (must be included in responses)'),
        topics: z.array(z.string()).optional().describe('Topics/categories the dataset belongs to'),
        spatial: z.any().optional().describe('Spatial coverage information'),
        temporal: z.any().optional().describe('Temporal coverage information'),
        frequency: z.string().optional().describe('Update frequency of the dataset'),
        schema: z.array(
          z.object({
            key: z.string().describe('Column identifier'),
            type: z.string().describe('Data type of the column'),
            title: z.string().optional().describe('Human-readable column title'),
            description: z.string().optional().describe('Column description'),
            enum: z.array(z.any()).optional().describe('List of all possible values for this column'),
            labels: z.record(z.string()).optional().describe('Object mapping actual data values (keys) to human-readable labels (values). Use keys for filters.'),
            concept: z.string().optional().describe('Semantic concept associated with the column')
          })
        ).describe('Dataset column schema with types and metadata'),
        sampleLines: z.array(z.record(z.any())).describe(
          'Array of 3 sample data rows showing real values from the dataset. Use these examples to understand exact formatting, casing, and typical values for _eq and _search filters.'
        )
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async (params: { datasetId: string }, extra) => {
      debug('Executing describe_dataset tool with datasetId:', params.datasetId)

      const baseUrl = getOrigin(extra.requestInfo?.headers)

      const fetchedData = (await axios.get(
        new URL(`/data-fair/api/v1/datasets/${encodeDatasetId(params.datasetId)}`, baseUrl).toString(),
        buildAxiosOptions(extra.requestInfo?.headers)
      )).data

      const dataset: any = {
        id: fetchedData.id,
        title: fetchedData.title,
        link: fetchedData.page,
        count: fetchedData.count
      }

      if (fetchedData.slug) dataset.slug = fetchedData.slug
      if (fetchedData.summary) dataset.summary = fetchedData.summary
      if (fetchedData.description) dataset.description = fetchedData.description
      if (fetchedData.keywords) dataset.keywords = fetchedData.keywords
      if (fetchedData.origin) dataset.origin = fetchedData.origin
      if (fetchedData.license) dataset.license = fetchedData.license
      if (fetchedData.topics) dataset.topics = fetchedData.topics.map((topic: any) => topic.title)
      if (fetchedData.spatial) dataset.spatial = fetchedData.spatial
      if (fetchedData.temporal) dataset.temporal = fetchedData.temporal
      if (fetchedData.frequency) dataset.frequency = fetchedData.frequency

      if (fetchedData.schema) {
        dataset.schema = fetchedData.schema
          .filter((col: any) => !['_i', '_id', '_rand'].includes(col.key))
          .map((col: any) => {
            const colResult: any = {
              key: col.key,
              type: col.type
            }

            if (col.title) colResult.title = col.title
            if (col.description) colResult.description = col.description
            if (col['x-concept']?.title || col['x-concept']?.id) {
              colResult.concept = col['x-concept']?.title || col['x-concept']?.id
            }
            if (col.enum) colResult.enum = col.enum
            if (col['x-labels']) colResult.labels = col['x-labels']

            return colResult
          })
      }

      const sampleUrl = new URL(`/data-fair/api/v1/datasets/${encodeDatasetId(params.datasetId)}/lines`, baseUrl)
      sampleUrl.searchParams.set('size', '3')

      const sampleLines = (await axios.get(
        sampleUrl.toString(),
        buildAxiosOptions(extra.requestInfo?.headers)
      )).data.results
      dataset.sampleLines = sampleLines

      return {
        structuredContent: dataset,
        content: [
          {
            type: 'text',
            text: JSON.stringify(dataset)
          }
        ]
      }
    }
  )
}
