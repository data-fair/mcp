import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import Debug from 'debug'
import axios from '@data-fair/lib-node/axios.js'
import { getOrigin, buildAxiosOptions, encodeDatasetId, handleApiError, formatTextOutput } from './_utils.ts'
import { stringify as csvStringify } from 'csv-stringify/sync'

const debug = Debug('datasets-tools')

export default (server: McpServer) => {
  server.registerTool(
    'describe_dataset',
    {
      title: 'Describe Dataset',
      description: 'Get detailed metadata for a dataset: column schema, sample rows, license, spatial/temporal coverage.',
      inputSchema: {
        datasetId: z.string().describe('The exact dataset ID from the "id" field in search_datasets results. Do not use the title or slug.')
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

      let fetchedData: any
      try {
        fetchedData = (await axios.get(
          new URL(`/data-fair/api/v1/datasets/${encodeDatasetId(params.datasetId)}`, baseUrl).toString(),
          buildAxiosOptions(extra.requestInfo?.headers)
        )).data
      } catch (err: any) {
        handleApiError(err)
      }

      const dataset: any = {
        id: fetchedData.id,
        title: fetchedData.title,
        link: fetchedData.page,
        count: fetchedData.count
      }

      if (fetchedData.slug) dataset.slug = fetchedData.slug
      if (fetchedData.summary) dataset.summary = fetchedData.summary
      if (fetchedData.description) {
        dataset.description = fetchedData.description.length > 2000
          ? fetchedData.description.slice(0, 2000) + '… (truncated, see dataset page for full description)'
          : fetchedData.description
      }
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
            if (col.enum) {
              if (col.enum.length <= 20) {
                colResult.enum = col.enum
              } else {
                colResult.enum = col.enum.slice(0, 20)
                colResult.enumTruncated = true
                colResult.enumTotal = col.enum.length
              }
            }
            if (col['x-labels']) colResult.labels = col['x-labels']

            return colResult
          })
      }

      const sampleUrl = new URL(`/data-fair/api/v1/datasets/${encodeDatasetId(params.datasetId)}/lines`, baseUrl)
      sampleUrl.searchParams.set('size', '3')

      let sampleLines: any[]
      try {
        sampleLines = (await axios.get(
          sampleUrl.toString(),
          buildAxiosOptions(extra.requestInfo?.headers)
        )).data.results
      } catch (err: any) {
        handleApiError(err) // always throws
      }
      dataset.sampleLines = sampleLines!.map((line: any) => {
        const { _id, _i, _rand, ...clean } = line
        return clean
      })

      // Build text output
      const metadataLines = [`Dataset: ${dataset.title}`, `ID: ${dataset.id}`]
      if (dataset.slug) metadataLines.push(`Slug: ${dataset.slug}`)
      metadataLines.push(`Link: ${dataset.link}`)
      if (dataset.summary) metadataLines.push(`Summary: ${dataset.summary}`)
      metadataLines.push(`Rows: ${dataset.count}`)
      if (dataset.license) metadataLines.push(`License: ${dataset.license.title} (${dataset.license.href})`)
      if (dataset.origin) metadataLines.push(`Origin: ${dataset.origin}`)
      if (dataset.keywords) metadataLines.push(`Keywords: ${dataset.keywords.join(', ')}`)
      if (dataset.topics) metadataLines.push(`Topics: ${dataset.topics.join(', ')}`)
      if (dataset.frequency) metadataLines.push(`Frequency: ${dataset.frequency}`)
      if (dataset.spatial) metadataLines.push(`Spatial: ${typeof dataset.spatial === 'string' ? dataset.spatial : JSON.stringify(dataset.spatial)}`)
      if (dataset.temporal) metadataLines.push(`Temporal: ${typeof dataset.temporal === 'string' ? dataset.temporal : JSON.stringify(dataset.temporal)}`)

      let descriptionSection = ''
      if (dataset.description) {
        descriptionSection = `Description:\n${dataset.description}`
      }

      let schemaSection = ''
      if (dataset.schema && dataset.schema.length > 0) {
        const schemaLines = dataset.schema.map((col: any) => {
          let line = `- ${col.key} (${col.type})`
          if (col.title) line += `: ${col.title}`
          if (col.description) line += ` — ${col.description}`
          if (col.concept) line += ` [concept: ${col.concept}]`
          if (col.enum) {
            const shown = col.enum.join(', ')
            if (col.enumTruncated) {
              line += ` [enum: ${shown}, ... (${col.enumTotal} total)]`
            } else {
              line += ` [enum: ${shown}]`
            }
          }
          if (col.labels) {
            const entries = Object.entries(col.labels)
            const shown = entries.slice(0, 10).map(([k, v]) => `${k}=${v}`).join(', ')
            if (entries.length > 10) {
              line += ` [labels: ${shown}, ... (${entries.length} total)]`
            } else {
              line += ` [labels: ${shown}]`
            }
          }
          return line
        })
        schemaSection = `Schema (${dataset.schema.length} columns):\n${schemaLines.join('\n')}`
      }

      let sampleSection = ''
      if (dataset.sampleLines && dataset.sampleLines.length > 0) {
        sampleSection = `Sample data:\n${csvStringify(dataset.sampleLines, { header: true }).trimEnd()}`
      }

      const text = formatTextOutput([
        metadataLines.join('\n'),
        descriptionSection,
        schemaSection,
        sampleSection
      ])

      return {
        structuredContent: dataset,
        content: [{ type: 'text', text }]
      }
    }
  )
}
