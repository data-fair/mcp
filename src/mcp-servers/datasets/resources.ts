import { type McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import axios from '@data-fair/lib-node/axios.js'

/*
  * ==================================================================
  * ---------------------------  Resources ---------------------------
  * ==================================================================
  */
const registerResources = (
  server: McpServer,
  prefixUri: string,
  dataFairApiUrl: string
) => {
  /**
   * Lists all available datasets as resources.
   * This resource provides a list of datasets with their basic information, including name, URI, and description.
   * Useful for discovering datasets available in the Data Fair instance.
   */
  server.registerResource(
    'list_datasets',
    prefixUri,
    {
      title: 'List Available Datasets',
      description: 'Fetches and lists all datasets available in the Data Fair instance, providing their names, URIs, and descriptions for discovery and selection.',
      mimeType: 'application/json'
    },
    async () => {
      console.info('Nouveau fetch de resources list-datasets')
      const contents: Array<{
        name: string,
        uri: string,
        mimeType: string,
        text: string,
        _meta?: { origin?: string }
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
  server.registerResource(
    'get_information',
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
}

export default registerResources
