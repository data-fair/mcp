import packageJson from '../../../package.json' with { type: 'json' }
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import config from '#config'

import registerResources from './resources.ts'
import registerTools from './tools.ts'
import registerPrompts from './prompts.ts'

/** Base URI for dataset resources */
const prefixUri = 'data-fair://datasets'
/** API endpoint for fetching datasets */
const dataFairApiUrl = `${config.dataFairUrl}/api/v1/datasets`

/**
 * The MCP server instance for datasets
 * This server will handle requests related to datasets, such as listing datasets,
 * retrieving information about specific datasets, and fetching example records.
 * It is initialized with the server name and version from package.json.
 */
const server = new McpServer({
  name: 'Datasets Data Fair',
  version: packageJson.version,
  capabilities: {
    resources: {
      // TODO: Add a description for resources
    },
    tools: {
      description: 'Tools to search and retrieve data from Data Fair datasets.',
    },
    prompts: {
      description: 'Prompts to assist users in efficiently finding frequently requested data by recommending the appropriate tools for each specific task.',
    }
  }
})

registerResources(server, prefixUri, dataFairApiUrl)
registerTools(server, prefixUri, dataFairApiUrl)
registerPrompts(server)

export default server
