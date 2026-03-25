import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import registerSearchDatasets from './tools/search-datasets.ts'
import registerDescribeDataset from './tools/describe-dataset.ts'
import registerSearchData from './tools/search-data.ts'
import registerAggregateData from './tools/aggregate-data.ts'
import registerGetFieldValues from './tools/get-field-values.ts'
import registerCalculateMetric from './tools/calculate-metric.ts'
import registerGeocodeAddress from './tools/geocode-address.ts'

const registerTools = (server: McpServer) => {
  registerSearchDatasets(server)
  registerDescribeDataset(server)
  registerSearchData(server)
  registerAggregateData(server)
  registerGetFieldValues(server)
  registerCalculateMetric(server)
  registerGeocodeAddress(server)
}

export default registerTools
