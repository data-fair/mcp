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
   * Tool to search for datasets in DataFair.
   * This tool allows users to search for datasets using simple French keywords.
   * It returns essential dataset information for discovery purposes including ID, title,
   * description (if available), and source URL.
   * Use this tool for dataset discovery, then use describe_dataset for detailed metadata
   * or search_data to query within a specific dataset.
   * @param {string} query - Simple French keywords to search for datasets (not full sentences).
   *                        Examples: "élus", "DPE", "entreprises"
   */
  server.registerTool(
    'search_datasets',
    {
      title: 'Search Datasets',
      description: 'Search for datasets by topic, domain, or content in DataFair. Use simple French keywords (not full sentences). Returns a preview with essential metadata: a list of datasets containing ID, title, description, and link to the source URL that must be included in responses. Then use describe_dataset to get detailed metadata. Examples: "élus", "DPE", "entreprises"',
      inputSchema: {
        query: z.string().min(3, 'Search term must be at least 3 characters long').describe('Search terms in French (simple keywords, not sentences). Examples: "élus", "DPE", "entreprises"')
      },
      outputSchema: {
        totalCount: z.number().describe('Total number of datasets matching the search criteria'),
        datasets: z.array(
          z.object({
            id: z.string().describe('Unique dataset ID (required for describe_dataset and search_data tools)'),
            title: z.string().describe('Dataset title'),
            description: z.string().optional().describe('A markdown description of the dataset content'),
            source: z.string().describe('Direct URL to the dataset page (must be included in AI responses as citation source)'),
          })
        ).describe('Array of datasets matching the search criteria (top 10 results)')
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
            source: dataset.page
          }

          if (dataset.description) result.description = dataset.description

          return result
        }),
        totalCount: fetchedData.count
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
   * Tool to get detailed metadata for a specific dataset.
   * This tool retrieves comprehensive information about a dataset including schema,
   * keywords, topics, frequency, spatial/temporal coverage, and other metadata.
   * Use this after search_datasets to understand dataset structure before using search_data.
   * @param {string} datasetId - The unique ID of the dataset to describe (obtained from search_datasets)
   */
  server.registerTool(
    'describe_dataset',
    {
      title: 'Describe Dataset',
      description: 'Retrieve detailed metadata for a specific dataset including schema, keywords, topics, frequency, spatial/temporal coverage, and other metadata. Use this to understand dataset structure after finding it with search_datasets and before searching data with search_data.',
      inputSchema: {
        datasetId: z.string().describe('The unique dataset ID obtained from search_datasets or provided by the user')
      },
      outputSchema: {
        id: z.string().describe('Unique dataset Id (required for search_data tools)'),
        slug: z.string().optional().describe('Human-readable unique identifier for the dataset, used in URLs'),
        title: z.string().describe('Dataset title'),
        description: z.string().optional().describe('A markdown description of the dataset content'),
        keywords: z.array(z.string()).optional().describe('Keywords associated with the dataset'),
        origin: z.string().optional().describe('Source or provider of the dataset'),
        license: z.object({
          href: z.string().describe('URL to the license text'),
          title: z.string().describe('License name/title')
        }).optional().describe('Dataset license information'),
        topics: z.array(z.string()).optional().describe('Topics/categories the dataset belongs to'),
        spatial: z.any().optional().describe('Spatial coverage information'),
        temporal: z.any().optional().describe('Temporal coverage information'),
        frequency: z.string().optional().describe('Update frequency of the dataset'),
        source: z.string().describe('Direct URL to the dataset page (must be included in responses as citation source)'),
        schema: z.array(
          z.object({
            key: z.string().describe('Column identifier'),
            type: z.string().describe('Data type of the column'),
            title: z.string().optional().describe('Human-readable column title'),
            description: z.string().optional().describe('Column description'),
            concept: z.string().optional().describe('Semantic concept associated with the column')
          })
        ).describe('Dataset column schema with types and metadata')
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
        source: fetchedData.page
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

            return colResult
          })
      }

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
   * Tool to search for specific data rows within a dataset.
   * This tool allows users to search for data within a specific dataset using simple French keywords.
   * It returns matching rows with their relevance scores and provides a direct link to view
   * the filtered results in the dataset's table interface.
   * Use this after describe_dataset to understand the dataset structure.
   * @param {string} datasetId - The unique ID of the dataset to search in (obtained from search_datasets)
   * @param {string} query - Simple French keywords to search for within the dataset data
   */
  server.registerTool(
    'search_data',
    {
      title: 'Search data from a dataset',
      description: 'Search for data rows within a specific dataset using simple French keywords. Returns matching rows with relevance scores and a direct link to view filtered results in the dataset table interface. Always include dataset license and source information when presenting results to users. Use describe_dataset first to understand the data structure.',
      inputSchema: {
        datasetId: z.string().describe('The unique dataset ID obtained from search_datasets'),
        query: z.string().min(1, 'Search query cannot be empty').describe('Simple French keywords to search within the dataset (not full sentences). Examples: "Jean Dupont", "Paris"'),
      },
      outputSchema: {
        totalCount: z.number().describe('Total number of data rows matching the search criteria'),
        datasetId: z.string().describe('The dataset ID that was searched'),
        searchQuery: z.string().describe('The search query that was used'),
        sourceUrl: z.string().describe('Direct URL to view the filtered dataset results in table format (for citation and direct access to filtered view)'),
        lines: z.array(
          z.record(z.any()).describe('Data row object with column keys and values, plus _score field indicating relevance')
        ).describe('Array of matching data rows (top 10 results). Each row contains dataset columns plus _score for search relevance')
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async (params: { datasetId: string, query: string }) => {
      debug('Executing search_data tool with dataset:', params.datasetId, 'and query:', params.query)

      // Fetch detailed dataset information
      const response = (await axios.get(
        `/datasets/${params.datasetId}/lines?q=${params.query}&q_mode=complete&size=10`,
        axiosOptions
      )).data

      // Format the fetched data into a structured content object
      const structuredContent = {
        totalCount: response.total,
        datasetId: params.datasetId,
        searchQuery: params.query,
        sourceUrl: `${config.dataFairUrl}/data-fair/next-ui/embed/dataset/${params.datasetId}/table?q=${params.query}&q_mode=complete`,
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
