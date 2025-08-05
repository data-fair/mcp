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
  // /**
  //  * Tool to list all datasets.
  //  * This tool fetches and lists all available datasets, including their ID, title, and description.
  //  * It is useful for discovering datasets available in the Data Fair instance.
  //  */
  // server.registerTool(
  //   'list_datasets',
  //   {
  //     title: 'Lists all datasets',
  //     description: 'Lists all datasets and provides their ID, title, and description',
  //     inputSchema: {},
  //   },
  //   async () => {
  //     // Fetch datasets from the API with selected fields: ID, title, and description
  //     const listDatasets = (await axios.get(`${dataFairApiUrl}?select=id,title,description`)).data.results
  //     return {
  //       // Format each dataset into a resource object
  //       content: listDatasets.map((dataset: any) => ({
  //         type: 'resource',
  //         resource: {
  //           name: dataset.title,
  //           uri: `${prefixUri}/${dataset.id}`,
  //           mimeType: 'application/markdown',
  //           text: `# ${dataset.title}\n\n${dataset.description as string}`,
  //           _meta: {
  //             id: dataset.id,
  //             origin: `${dataFairApiUrl}/${dataset.id}`
  //           }
  //         }
  //       }))
  //     }
  //   }
  // )

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
      const dataUrl = `${dataFairApiUrl}?q=${params.search}&raw=true&limit=5&select=id,slug,title,description,keywords,origin,schema`
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
   * Tool to get examples of data from a specific dataset
   * @param {string} datasetId - The ID of the dataset to fetch records from
   */
  server.registerTool(
    'get_records',
    {
      title: 'Get some examples of data from one dataset',
      description: 'Get some examples of data (also called records) from one dataset',
      inputSchema: {
        datasetId: z.string().describe('The datasetId to fetch'),
      },
    },
    async (params: { datasetId: string }) => {
      console.info('Nouveau fetch de tool get-records : ' + params.datasetId)
      const dataUrl = `${dataFairApiUrl}/${params.datasetId}/lines`
      // Fetch example records from the dataset
      const dataRows = (await axios.get(dataUrl)).data.results
      const content = dataRows.map((row: any, idx: number) => ({
        type: 'text',
        text: JSON.stringify(row),
        uri: `${prefixUri}/${params.datasetId}/data#row-nb-${idx}`,
        mimeType: 'application/json',
      }))
      return { content }
    }
  )

  /**
   * Tool to search and select data from a dataset
   * @param {string} datasetId - The ID of the dataset to search within
   * @param {string} [search] - Optional value to search for within the dataset
   * @param {string[]} [filters] - Optional array of fields to retrieve
   */
  server.registerTool(
    'search_and_select_data',
    {
      title: 'Search and select data from a dataset',
      description: 'Fetch values by searching and selecting specific fields from a dataset. The different fields can be found with the tool get-information/{datasetId} with the corresponding dataset ID',
      inputSchema: {
        datasetId: z.string().describe('The ID of the dataset'),
        search: z.string().optional().describe('A value to search in the dataset'),
        filters: z.array(z.string()).optional().describe('The array of fields to retrieve, if not provided, all fields will be returned'),
      },
    },
    async (params: { datasetId: string, search?: string, filters?: string[] }) => {
      console.info('Nouveau fetch de tool search-and-select-data : ' + params.datasetId + (params.search ? ` with search: ${params.search}` : '') + (params.filters ? ` and filters: ${params.filters.join(', ')}` : ''))
      let dataUrl = `${dataFairApiUrl}/${params.datasetId}/lines?`
      if (params.search && params.search !== '') {
        dataUrl += `q=${params.search}&q_mode=complete`
      }
      if (params.filters && params.filters.length !== 0) {
        dataUrl += '&select=' + params.filters.join(',')
      }
      // Fetch data rows matching the search criteria and selected fields
      const dataRows = (await axios.get(dataUrl)).data.results
      return {
        content: dataRows.map((row: any, idx: number) => ({
          type: 'text',
          text: JSON.stringify(row),
          uri: `${prefixUri}/${params.datasetId}/data#search-row-${idx}`,
          mimeType: 'application/json',
        })),
      }
    }
  )
}

export default registerTools
