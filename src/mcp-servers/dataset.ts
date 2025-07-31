import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import axios from '@data-fair/lib-node/axios.js'
import { z } from 'zod'

// Load package.json to get the version of the application
const pJson = JSON.parse(await readFile(resolve(import.meta.dirname, '../../package.json'), 'utf8'))

/** Function to create and configure an MCP server for datasets */
export const datasetMCPServer = async (dataFairUrl: string, _datasetId: string) => {
  /** Base URI for dataset resources */
  const prefixUri = 'data-fair://datasets'
  /** API endpoint for fetching datasets */
  const dataFairApiUrl = `${dataFairUrl}/api/v1/datasets`

  /**
   * The MCP server instance for datasets
   * This server will handle requests related to datasets, such as listing datasets,
   * retrieving information about specific datasets, and fetching example records.
   * It is initialized with the server name and version from package.json.
   */
  const server = new McpServer({
    name: 'datasets data-fair',
    version: pJson.version
  })

  /**
   * Lists all available datasets as resources.
   * This resource provides a list of datasets with their basic information, including name, URI, and description.
   * Useful for discovering datasets available in the Data Fair instance.
   */
  server.registerResource(
    'list-datasets',
    prefixUri,
    {
      title: 'List Available Datasets',
      description: 'Fetches and lists all datasets available in the Data Fair instance, providing their names, URIs, and descriptions for discovery and selection.',
      mimeType: 'application/json'
    },
    async () => {
      console.info('Nouveau fetch de resources list-datasets')
      const contents: Array<{
        name: string
        uri: string
        mimeType: string
        text: string
        _meta: { origin: string }
      }> = []
      const listDatasets = (await axios.get(`${dataFairApiUrl}?select=id,description,title`)).data.results
      for (const dataset of listDatasets) {
        contents.push({
          name: dataset.title,
          uri: `${prefixUri}/${dataset.id}`,
          mimeType: 'application/markdown',
          text: `# ${dataset.title}\n\n${dataset.description as string}`,
          _meta: {
            origin: `${dataFairApiUrl}/${dataset.id}`
          }
        })
      }
      return { contents }
    }
  )

  /**
   * recupere les informations sur les champs d'un jeu de données
   */
  server.resource(
    'get-information',
    new ResourceTemplate(`${prefixUri}/{datasetId}`, { list: undefined }),
    {
      title: 'Resource Information',
      description: 'Gave some information about one specific dataset',
      mimeType: 'application/json'
    },
    async (url, { datasetId }) => {
      console.info('Nouveau fetch de resources get-information : ' + datasetId)
      const urlRequest = `${dataFairApiUrl}/${datasetId}`
      const datasetInfo = (await axios.get(urlRequest)).data

      const contents = [{
        name: 'Description',
        uri: url + '#description',
        mimeType: 'application/markdown',
        text: `# ${datasetInfo.title}\n\n${datasetInfo.description as string}`
      }]
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
          uri: url + '#col-info-' + property.key,
          mimeType: 'text/plain',
          text: propInfo
        })
        if (property.description) {
          contents.push({
            name: `Column ${property.title || property['x-originalName'] || property.key} description`,
            uri: url + '#col-desc-' + property.key,
            mimeType: 'application/markdown',
            text: property.description
          })
        }
      }
      return { contents }
    }
  )

  /**
   * Tool to list the different datasets
   * This tool fetches and lists all available datasets with their basic information.
   */
  server.registerTool(
    'list-datasets',
    {
      title: 'Lists the different datasets',
      description: 'List the different datasets and provide some information',
      inputSchema: {},
    },
    async () => {
      console.info('Nouveau fetch de tool list-datasets')
      // Fetch datasets from the API with selected fields: id, description, and title
      const listDatasets = (await axios.get(`${dataFairApiUrl}?select=id,description,title`)).data.results
      return {
        // Format each dataset into a resource object
        content: listDatasets.map((dataset: any) => ({
          type: 'resource',
          resource: {
            name: dataset.title,
            uri: `${prefixUri}/${dataset.id}`,
            mimeType: 'application/markdown',
            text: `# ${dataset.title}\n\n${dataset.description as string}`,
            _meta: {
              id: dataset.id,
              origin: `${dataFairApiUrl}/${dataset.id}`
            }
          }
        }))
      }
    }
  )

  /**
   * Tool to get detailed information about the fields of a specific dataset
   * @param {string} datasetId - The ID of the dataset to fetch information for
   */
  server.registerTool(
    'get-information',
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
    'get-records',
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
   * Tool to search for a specific dataset
   * @param {string} search - The value related to the dataset to search for
   * @param {boolean} isSimplified - If true, return only basic information; otherwise, return all metadata
   */
  server.registerTool(
    'search-dataset',
    {
      title: 'Search a dataset',
      description: 'Search a specific dataset',
      inputSchema: {
        search: z.string().describe('The value related to the dataset'),
        isSimplified: z.boolean().describe('If true, the return value will only contain simple information (like name, id, description of the dataset), otherwise, all metadata will be returned'),
      },
    },
    async (params: { search: string; isSimplified: boolean }) => {
      console.info('Nouveau fetch de tool search-dataset : ' + params.search)
      let dataUrl = `${dataFairApiUrl}?q=${params.search}&q_mode=complete`
      if (params.isSimplified) {
        dataUrl += '&select=id,title,description'
      }
      // Fetch datasets matching the search criteria
      const datasets = (await axios.get(dataUrl)).data.results
      return {
        content: datasets.map((dataset: any) => ({
          type: 'text',
          text: `id: ${dataset.id}\n\n# ${dataset.title}\n\n${dataset.description}\n\norigin: ${dataset.href} | ${dataset.page}`,
          uri: `${prefixUri}/${dataset.id}`,
          mimeType: 'application/json',
        })),
      }
    }
  )

  /**
   * Tool to search and select data from a dataset
   * @param {string} datasetId - The ID of the dataset to search within
   * @param {string} [search] - Optional value to search for within the dataset
   * @param {string[]} [filters] - Optional array of fields to retrieve
   */
  server.registerTool(
    'search-and-select-data',
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

  return server
}

export default datasetMCPServer
