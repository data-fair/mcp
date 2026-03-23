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
1. **search_datasets** — find relevant datasets using French keywords (simple terms, not sentences). If 0 results, try synonyms or broader French terms. If many results, read titles and summaries to pick the most relevant.
2. **describe_dataset** — get the schema, sample rows, and metadata for a dataset. Always do this before querying data.
3. Choose the right tool based on the question:
   - "Show me rows / find specific records / who / which" → **search_data**
   - "How many X per Y / breakdown by category / distribution" → **aggregate_data**
   - "What is the total / average / min / max of X?" → **calculate_metric**
   - "What values exist in column X?" → **get_field_values**

When a dataset has many columns (10+), use the \`select\` parameter in search_data to request only relevant columns.

## Filters (search_data, aggregate_data & calculate_metric)
Filters are key-value pairs where the key is \`column_key\` + a suffix:
- \`_eq\` / \`_neq\`: exact match / not equal (case-sensitive)
- \`_in\` / \`_nin\`: value in / not in comma-separated list (case-sensitive)
- \`_search\`: full-text search within that column (case-insensitive)
- \`_starts\`: prefix match, \`_contains\`: substring match
- \`_gt\` / \`_gte\` / \`_lt\` / \`_lte\`: numeric/date comparisons
- \`_exists\` / \`_nexists\`: field presence

If a column key contains underscores (e.g., code_postal), just append the suffix: code_postal_eq, code_postal_search.

**Important: all filter values must be strings**, even for numbers and dates.

Example — find people named "Dupont" in Paris over 30 years old:
  filters: { "nom_eq": "Dupont", "ville_eq": "Paris", "age_gte": "30" }

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
