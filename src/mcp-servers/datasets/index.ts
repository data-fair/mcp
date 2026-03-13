import packageJson from '../../../package.json' with { type: 'json' }
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import registerTools from './tools.ts'
// import registerResources from './resources.ts'
// import registerPrompts from './prompts.ts'

/**
 * The MCP server instance for datasets
 * This server will handle requests related to datasets, such as listing datasets,
 * retrieving information about specific datasets, and fetching example records.
 * It is initialized with the server name and version from package.json.
 */
const server = new McpServer({
  name: 'datafair-datasets-mcp-server',
  title: 'Data Fair Datasets MCP Server',
  version: packageJson.version,
  instructions: `You are querying French open data through Data Fair. Follow this workflow and these rules.

## Workflow
1. **search_datasets** — find relevant datasets using French keywords (simple terms, not sentences).
2. **describe_dataset** — get the schema, sample rows, and metadata for a dataset. Always do this before querying data.
3. Use the appropriate tool(s) depending on the question:
   - **search_data** — find specific rows matching a query or filters.
   - **aggregate_data** — group rows by 1-3 columns with optional metrics.
   - **get_field_values** — list distinct values of a column (useful before filtering to know what values exist).
   - **calculate_metric** — compute a single metric (avg, sum, min, max, cardinality, percentiles, etc.) on a column, optionally with filters.

## Filters (search_data, aggregate_data & calculate_metric)
Filters are key-value pairs where the key is \`column_key\` + a suffix:
- \`_eq\` / \`_neq\`: exact match / not equal (case-sensitive)
- \`_in\` / \`_nin\`: value in / not in comma-separated list (case-sensitive)
- \`_search\`: full-text search within that column (case-insensitive)
- \`_starts\`: prefix match, \`_contains\`: substring match
- \`_gt\` / \`_gte\` / \`_lt\` / \`_lte\`: numeric/date comparisons
- \`_exists\` / \`_nexists\`: field presence

Prefer filters over the \`query\` parameter when the question involves multiple criteria or numeric/date ranges.
Use sample rows from describe_dataset to understand exact value formatting before filtering.
Use get_field_values to discover possible values before applying _eq or _in filters.

## Citations
Always include in your responses:
- The **dataset page link** (from search_datasets or describe_dataset)
- The **filtered view URL** (from search_data) when applicable
- The **license** information (from describe_dataset) when available`,
  capabilities: {
    resources: {},
    tools: {},
    prompts: {}
  }
})

registerTools(server)
// registerResources(server)
// registerPrompts(server)

export default server
