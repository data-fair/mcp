import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AxiosRequestConfig } from 'axios'
import { z } from 'zod'
import Debug from 'debug'
import axios from '@data-fair/lib-node/axios.js'
import config from '#config'

const debug = Debug('datasets-tools')
const axiosOptions: AxiosRequestConfig = {
  baseURL: `${config.dataFairUrl}/data-fair/api/v1`,
  headers: {
    'User-Agent': '@data-fair/mcp (Datasets)'
  }
}

/*
  * ==================================================================
  * -----------------------------  Tools -----------------------------
  * ==================================================================
  */

const registerTools = (server: McpServer) => {
  /**
   * Tool to search for datasets in DataFair using full-text search.
   * @param {string} query - French keywords for full-text search.
   */
  server.registerTool(
    'search_datasets',
    {
      title: 'Search Datasets',
      description: 'Full-text search for datasets in DataFair. Uses French keywords to search across dataset titles, descriptions, and metadata. Returns a preview of datasets with their essential metadata: ID, title, description, and link to the dataset page that must be included in responses. Then use describe_dataset to get detailed metadata.',
      inputSchema: {
        query: z.string().min(3, 'Search term must be at least 3 characters long').describe('French keywords for full-text search (simple keywords, not sentences). Examples: "élus", "DPE", "entreprises", "logement social"')
      },
      outputSchema: {
        count: z.number().describe('Number of datasets matching the full-text search criteria'),
        datasets: z.array(
          z.object({
            id: z.string().describe('Unique dataset ID (required for describe_dataset and search_data tools)'),
            title: z.string().describe('Dataset title'),
            description: z.string().optional().describe('A markdown description of the dataset content'),
            link: z.string().describe('Link to the dataset page (must be included in responses as citation source)'),
          })
        ).describe('An array of the top 10 datasets matching the full-text search criteria.')
      },
      annotations: { // https://modelcontextprotocol.io/specification/2025-06-18/schema#toolannotations
        readOnlyHint: true
      }
    },
    async (params: { query: string }) => {
      debug('Executing search_dataset tool with query:', params.query)

      // Fetch datasets matching the search criteria - optimized for discovery
      const fetchedData = (await axios.get(
        `/catalog/datasets?q=${params.query}&size=10&select=id,title,description`,
        axiosOptions
      )).data

      // Format the fetched data into a structured content object
      const structuredContent = {
        datasets: fetchedData.results.map((dataset: any) => {
          const result: any = {
            id: dataset.id,
            title: dataset.title,
            link: dataset.page
          }

          if (dataset.description) result.description = dataset.description

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
            text: JSON.stringify(structuredContent)
          }
        ]
      }
    }
  )

  /**
   * Tool to get detailed metadata for a dataset.
   * @param {string} datasetId - The unique dataset ID obtained from search_datasets or provided by the user.
   */
  server.registerTool(
    'describe_dataset',
    {
      title: 'Describe Dataset',
      description: 'Retrieve detailed metadata for a dataset by its ID including column schema, spatial/temporal coverage, and other metadata. Use this to understand dataset structure after finding it with search_datasets and before searching data with search_data.',
      inputSchema: {
        datasetId: z.string().describe('The unique dataset ID obtained from search_datasets or provided by the user')
      },
      outputSchema: {
        id: z.string().describe('Unique dataset Id (required for search_data tools)'),
        slug: z.string().optional().describe('Human-readable unique identifier for the dataset, used in URLs'),
        title: z.string().describe('Dataset title'),
        description: z.string().optional().describe('A markdown description of the dataset content'),
        link: z.string().describe('Link to the dataset page (must be included in responses as citation source)'),
        count: z.number().describe('Total number of data rows in the dataset'),
        keywords: z.array(z.string()).optional().describe('Keywords associated with the dataset'),
        origin: z.string().optional().describe('Source or provider of the dataset'),
        license: z.object({
          href: z.string().describe('URL to the license text'),
          title: z.string().describe('License name/title')
        }).optional().describe('Dataset license information (must be included in responses)'),
        topics: z.array(z.string()).optional().describe('Topics/categories the dataset belongs to'),
        spatial: z.any().optional().describe('Spatial coverage information'),
        temporal: z.any().optional().describe('Temporal coverage information'),
        frequency: z.string().optional().describe('Update frequency of the dataset'),
        schema: z.array(
          z.object({
            key: z.string().describe('Column identifier'),
            type: z.string().describe('Data type of the column'),
            title: z.string().optional().describe('Human-readable column title'),
            description: z.string().optional().describe('Column description'),
            enum: z.array(z.any()).optional().describe('List of all possible values for this column'),
            labels: z.record(z.string()).optional().describe('Object mapping actual data values (keys) to human-readable labels (values). Use keys for filters.'),
            concept: z.string().optional().describe('Semantic concept associated with the column')
          })
        ).describe('Dataset column schema with types and metadata'),
        sampleLines: z.array(z.record(z.any())).describe(
          'Array of 3 sample data rows showing real values from the dataset. Use these examples to understand exact formatting, casing, and typical values for _eq and _search filters.'
        )
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async (params: { datasetId: string }) => {
      debug('Executing describe_dataset tool with datasetId:', params.datasetId)

      // Fetch detailed dataset information
      const fetchedData = (await axios.get(
        `/datasets/${params.datasetId}`,
        axiosOptions
      )).data

      // Format the fetched data
      const dataset: any = {
        id: fetchedData.id,
        title: fetchedData.title,
        link: fetchedData.page,
        count: fetchedData.count
      }

      // Add optional fields if they exist
      if (fetchedData.slug) dataset.slug = fetchedData.slug
      if (fetchedData.description) dataset.description = fetchedData.description
      if (fetchedData.keywords) dataset.keywords = fetchedData.keywords
      if (fetchedData.origin) dataset.origin = fetchedData.origin
      if (fetchedData.license) dataset.license = fetchedData.license
      if (fetchedData.topics) dataset.topics = fetchedData.topics.map((topic: any) => topic.title)
      if (fetchedData.spatial) dataset.spatial = fetchedData.spatial
      if (fetchedData.temporal) dataset.temporal = fetchedData.temporal
      if (fetchedData.frequency) dataset.frequency = fetchedData.frequency

      // Add schema information
      if (fetchedData.schema) {
        // Filter out special columns before mapping
        dataset.schema = fetchedData.schema
          .filter((col: any) => !['_i', '_id', '_rand'].includes(col.key))
          .map((col: any) => {
            const colResult: any = {
              key: col.key,
              type: col.type
            }

            if (col.title) colResult.title = col.title
            if (col.description) colResult.description = col.description
            if (col['x-concept']?.title || col['x-concept']?.id) {
              colResult.concept = col['x-concept']?.title || col['x-concept']?.id
            }
            if (col.enum) colResult.enum = col.enum
            if (col['x-labels']) colResult.labels = col['x-labels']

            return colResult
          })
      }

      // Add sample lines if available
      const sampleLines = (await axios.get(
        `/datasets/${params.datasetId}/lines?size=3`,
        axiosOptions
      )).data.results
      dataset.sampleLines = sampleLines

      return {
        structuredContent: dataset,
        content: [
          {
            type: 'text',
            text: JSON.stringify(dataset)
          }
        ]
      }
    }
  )

  /**
   * Tool to search for specific data rows within a dataset using either full-text search OR precise filters.
   * This tool can search data in two ways:
   * 1) Full-text search across all columns using keywords (quick and broad search)
   * 2) Precise filtering on specific columns with exact matches, comparisons, or column-specific searches (ideal for structured queries)
   *
   * Returns matching rows with their relevance scores and provides a direct link to view the filtered results in the dataset's table interface.
   * @param {string} datasetId - The unique dataset ID obtained from search_datasets or provided by the user.
   * @param {string} query - Optional French keywords for full-text search across all dataset columns.
   * @param {Object} filters - Optional precise filters on specific columns (alternative to query)
   * @param {string} select - Optional comma-separated list of column keys to reduce output size.
   */
  server.registerTool(
    'search_data',
    {
      title: 'Search data from a dataset',
      description: 'Search for data rows in a specific dataset using either :\n- Full-text search across all columns (query) for quick, broad matches\n- Precise filtering (filters) to apply exact conditions, comparisons, or column-specific searches.\nUse filters whenever your question involves multiple criteria or numerical/date ranges, as they yield more relevant and targeted results. The query parameter is better suited for simple, one-keyword searches across the entire dataset. Returns matching rows with relevance scores and some metadata. Always include the filtered view link, the dataset link and the license information when presenting results to users. Use describe_dataset first to understand the data structure.',
      inputSchema: {
        datasetId: z.string().describe('The unique dataset ID obtained from search_datasets or provided by the user'),
        query: z.string().optional().describe('French keywords for full-text search across all dataset columns (simple keywords, not sentences). Do not use with filters parameter. Examples: "Jean Dupont", "Paris", "2025"'),
        filters: z.record(
          z.string().regex(/^.+_(search|eq|gte|lte)$/, {
            message: 'Filter key must follow pattern: column_key + suffix (_eq, _search, _gte, _lte)'
          }),
          z.string()
        )
          .optional()
          .describe('Precise filters on specific columns. Ideal for multi-condition queries or range searches. Each filter key must be: column_key + suffix. Available suffixes: _eq (strictly equal, case-sensitive), _search (full-text search within that column, case-insensitive and flexible matching), _gte (greater than or equal), _lte (less than or equal). Use column keys from describe_dataset. Example: { "nom_search": "Jean", "age_lte": "30", "ville_eq": "Paris" } searches for people whose names contain "Jean", who are 30 years old or younger, and who live in Paris.'),
        select: z.string().optional().describe('Optional comma-separated list of column keys to include in the results. Useful when the dataset has many columns to reduce output size. If not provided, all columns are returned. Use column keys from describe_dataset. Format: column1,column2,column3 (No spaces after commas). Example: "nom,age,ville"')
      },
      outputSchema: {
        datasetId: z.string().describe('The dataset ID that was searched'),
        count: z.number().describe('Number of data rows matching the search criteria and filters'),
        filteredViewUrl: z.string().describe('Link to view the filtered dataset results in table format (must be included in responses for citation and direct access to filtered view)'),
        lines: z.array(
          z.record(z.any()).describe('Data row object containing column keys as object keys with their values, plus _score field indicating search relevance (higher score = more relevant)')
        ).describe('An array of the top 10 data rows matching the search criteria.')
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async (params: { datasetId: string, query?: string, select?: string, filters?: Record<string, any> }) => {
      debug('Executing search_data tool with dataset:', params.datasetId, 'query:', params.query, 'select:', params.select, 'filters:', params.filters)

      // Build common search parameters for both fetch and source URLs
      const searchParams = new URLSearchParams()
      if (params.query) {
        searchParams.append('q', params.query)
        searchParams.append('q_mode', 'complete')
      }
      if (params.select) {
        searchParams.append('select', params.select)
      }
      if (params.filters) {
        for (const [key, value] of Object.entries(params.filters)) {
          searchParams.append(key, String(value))
        }
      }

      const filteredViewUrlObj = new URL(`${config.dataFairUrl}/data-fair/next-ui/embed/dataset/${params.datasetId}/table`)
      filteredViewUrlObj.search = searchParams.toString()
      const fetchUrl = new URL(`${config.dataFairUrl}/data-fair/api/v1/datasets/${params.datasetId}/lines`)
      searchParams.append('size', '10')
      fetchUrl.search = searchParams.toString()

      // Fetch detailed dataset information
      const response = (await axios.get(
        fetchUrl.toString(),
        axiosOptions
      )).data

      // Format the fetched data into a structured content object
      const structuredContent = {
        datasetId: params.datasetId,
        count: response.total,
        filteredViewUrl: filteredViewUrlObj.toString(),
        lines: response.results
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
