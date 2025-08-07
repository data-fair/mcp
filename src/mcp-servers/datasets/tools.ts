import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import Debug from 'debug'
import axios from '@data-fair/lib-node/axios.js'

const debug = Debug('datasets-tools')

/*
  * ==================================================================
  * -----------------------------  Tools -----------------------------
  * ==================================================================
  */

const registerTools = (
  server: McpServer,
  prefixUri: string,
  dataFairApiUrl: string
) => {
  /**
   * Tool to search for a specific dataset.
   * This tool allows users to search for datasets using a short string of text or keywords.
   * It returns key dataset information including ID, slug, title, description, keywords (if available),
   * origin (if available), and a schema of the columns.
   * The column schema includes key, type, title (if available), description (if available), and concept (if available).
   * @param {string} search - The text or keywords related to the dataset to search for.
   */
  server.registerTool(
    'search_dataset',
    {
      title: 'Search a dataset',
      description: 'Search for a specific dataset using text or keywords',
      inputSchema: {
        search: z.string().min(3, 'Search term must be at least 3 characters long').describe('The text or keywords related to the dataset')
      },
      outputSchema: {
        count: z.number().describe('The number of datasets matching the search criteria'),
        datasets: z.array(
          z.object({
            id: z.string().describe('The ID of the dataset'),
            slug: z.string().describe('The slug of the dataset'),
            title: z.string().describe('The title of the dataset'),
            description: z.string().optional().describe('The description of the dataset'),
            keywords: z.array(z.string()).optional().describe('Keywords related to the dataset, if available'),
            origin: z.string().optional().describe('The origin of the dataset, if available'),
            schema: z.array(
              z.object({
                key: z.string().describe('The key of the column'),
                type: z.string().describe('The type of the column'),
                title: z.string().optional().describe('The title of the column, if available'),
                description: z.string().optional().describe('The description of the column, if available'),
                concept: z.string().optional().describe('The concept related to the column, if available')
              })
            ).describe('The schema of the columns in the dataset')
          })
        ).describe('An array of the top 5 datasets matching the search criteria')
      },
      annotations: {
        readOnlyHint: false
      }
    },
    async (params: { search: string }) => {
      debug('Executing search_dataset tool with search:', params.search)
      // Fetch datasets matching the search criteria
      const dataUrl = `${dataFairApiUrl}?q=${params.search}&raw=true&size=5&select=id,slug,title,description,keywords,origin,schema`
      const fetchedData = (await axios.get(dataUrl)).data

      // Format the fetched data into a structured content object
      const structuredContent = {
        datasets: fetchedData.results.map((dataset: any) => {
          const result: any = {
            id: dataset.id,
            slug: dataset.slug
          }

          if (dataset.title) result.title = dataset.title
          if (dataset.description) result.description = dataset.description
          if (dataset.keywords) result.keywords = dataset.keywords
          if (dataset.origin) result.origin = dataset.origin

          result.schema = dataset.schema.map((col: any) => {
            const colResult: any = {
              key: col.key,
              type: col.type
            }

            if (col.title) colResult.title = col.title
            if (col.description) colResult.description = col.description
            if (col['x-concept']?.title || col['x-concept']?.id) {
              colResult.concept = col['x-concept']?.title || col['x-concept']?.id
            }

            return colResult
          })

          return result
        }),
        count: fetchedData.count
      }

      return { // https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool-result
        structuredContent,
        // For backwards compatibility, a tool that returns structured content
        // SHOULD also return the serialized JSON in a TextContent block.
        content: [
          {
            type: 'text',
            text: JSON.stringify(structuredContent),
          }
        ]
      }
    }
  )

  /**
   * Tool to get detailed information about the fields of a specific dataset
   * @param {string} datasetId - The ID of the dataset to fetch information for
   */
  server.registerTool(
    'get_information',
    {
      title: 'Resource Information',
      description: 'Provide some information about one specific dataset',
      inputSchema: {
        datasetId: z.string().describe('The ID of the dataset to fetch information for'),
      },
    },
    async (params: { datasetId: string }) => {
      console.info('Nouveau fetch de tool get-information : ' + params.datasetId)
      const urlRequest = `${dataFairApiUrl}/${params.datasetId}`
      // Fetch detailed information about the dataset
      const datasetInfo = (await axios.get(urlRequest)).data

      // Start with the description of the dataset
      const contents = [{
        name: 'Description',
        uri: `${prefixUri}/${params.datasetId}#description`,
        mimeType: 'application/markdown',
        text: `# ${datasetInfo.title}\n\n${datasetInfo.description as string}`
      }]

      // Iterate over each property in the dataset schema to gather detailed information
      for (const property of datasetInfo.schema) {
        let propInfo = `key: ${property.key}`
        if (property['x-originalName'] && property['x-originalName'] !== property.key) {
          propInfo += `\noriginal name (column name in the original file): ${property['x-originalName']}`
        }
        if (property.title) {
          propInfo += `\ntitle: ${property.title}`
        }
        propInfo += `\ntype: ${property.format ?? property.type}`
        if (property.enum) {
          propInfo += `\npossible values: ${property.enum.join(', ')}`
        }
        if (property['x-labels']) {
          propInfo += '\nvalue labels: '
          propInfo += Object.entries(property['x-labels']).map(([k, v]) => `${k}=${v}`).join(', ')
        }
        contents.push({
          name: `Column ${property.title || property['x-originalName'] || property.key}`,
          uri: `${prefixUri}/${params.datasetId}#col-info-${property.key}`,
          mimeType: 'text/plain',
          text: propInfo
        })
        if (property.description) {
          contents.push({
            name: `Column ${property.title || property['x-originalName'] || property.key} description`,
            uri: `${prefixUri}/${params.datasetId}#col-desc-${property.key}`,
            mimeType: 'application/markdown',
            text: property.description
          })
        }
      }
      // Format each content item into a resource object
      return {
        content: contents.map((item) => ({
          type: 'resource',
          resource: item
        }))
      }
    }
  )

  /**
   * Tool to search and select specific data rows from a dataset.
   * This tool allows users to search for specific data rows within a dataset using a search term.
   * It returns the count of matching rows and the actual data rows.
   * The structure of each row depends on the specific dataset being queried.
   * @param {string} datasetId - The ID of the dataset to search in
   * @param {string} search - A value to search for in the dataset
   */
  server.registerTool(
    'search_data',
    {
      title: 'Search data from a dataset',
      description: 'Search for data rows in a specific dataset using a search term',
      inputSchema: {
        datasetId: z.string().describe('The ID of the dataset'),
        search: z.string().describe('A value to search in the dataset'),
      },
      outputSchema: {
        count: z.number().describe('The number of data rows matching the search criteria'),
        lines: z.array(z.record(z.any())).describe('An array of data rows matching the search criteria. The structure varies by dataset')
      },
      annotations: {
        readOnlyHint: false
      }
    },
    async (params: { datasetId: string, search: string }) => {
      debug('Executing search_data tool with dataset:', params.datasetId, 'and search:', params.search)
      const dataUrl = `${dataFairApiUrl}/${params.datasetId}/lines?q=${params.search}&q_mode=complete&size=10`

      // Fetch data rows matching the search criteria
      const response = (await axios.get(dataUrl)).data
      const dataRows = response.results

      // Format the fetched data into a structured content object
      const structuredContent = {
        count: response.total,
        lines: dataRows
      }

      return { // https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool-result
        structuredContent,
        // For backwards compatibility, also return the serialized JSON in TextContent blocks
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

export default registerTools
