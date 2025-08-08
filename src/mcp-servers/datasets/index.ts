import packageJson from '../../../package.json' with { type: 'json' }
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import registerResources from './resources.ts'
import registerTools from './tools.ts'
import registerPrompts from './prompts.ts'

/**
 * The MCP server instance for datasets
 * This server will handle requests related to datasets, such as listing datasets,
 * retrieving information about specific datasets, and fetching example records.
 * It is initialized with the server name and version from package.json.
 */
const server = new McpServer({
  name: 'datafair-datasets-mcp-server',
  title: 'Data Fair Datasets MCP Server',
  // I think the description field isn't interpreted by the MCP server...
  // https://modelcontextprotocol.io/specification/2025-06-18/schema#implementation
  description: 'MCP server for DataFair data search and retrieval. DataFair contains primarily French datasets, so search terms should be in French. Always include sources (dataset links or filtered dataset URLs) in responses.',
  version: packageJson.version,
  // Schema of capabilities : https://modelcontextprotocol.io/specification/2025-06-18/schema#servercapabilities
  capabilities: {
    resources: {},
    tools: {},
    prompts: {}
  }
})

registerResources(server)
registerTools(server)
registerPrompts(server)

export default server
