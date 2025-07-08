import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import axios from '@data-fair/lib-node/axios.js'

const pJson = JSON.parse(await readFile(resolve(import.meta.dirname, '../../package.json'), 'utf8'))

export const datasetMCPServer = async (dataFairUrl: string, datasetId: string) => {
  const datasetUrl = `${dataFairUrl}/api/v1/datasets/${datasetId}`
  const datasetInfo = await axios.get(datasetUrl).then(r => r.data)
  const server = new McpServer({
    name: datasetInfo.title,
    version: pJson.version
  })

  const datasetInfoUrl = `data-fair://datasets/${datasetInfo.slug || datasetId}`

  server.resource(
    'Information',
    datasetInfoUrl,
    async () => {
      const contents = [{
        name: 'Description',
        uri: datasetInfoUrl + '#description',
        mimeType: 'application/markdown',
        text: `# ${datasetInfo.title}
        
${datasetInfo.description as string}`
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
          uri: datasetInfoUrl + '#col-info-' + property.key,
          mimeType: 'text/plain',
          text: propInfo
        })
        if (property.description) {
          contents.push({
            name: `Column ${property.title || property['x-originalName'] || property.key} description`,
            uri: datasetInfoUrl + '#col-desc-' + property.key,
            mimeType: 'application/markdown',
            text: property.description
          })
        }
      }
      return { contents }
    }
  )

  return server
}

export default datasetMCPServer
