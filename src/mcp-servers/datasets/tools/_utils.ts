import type { IsomorphicHeaders } from '@modelcontextprotocol/sdk/types.js'
import type { AxiosRequestConfig } from 'axios'
import { z } from 'zod'
import config from '#config'
import { filterProperties, datasetIdProperty } from '@data-fair/agent-tools-data-fair/_utils'

type Annotations = { fr: { title: string }, en: { title: string } }
export const getToolTitle = (annotations: Annotations): string => {
  const locale = config.locale as keyof Annotations
  return annotations[locale].title
}

// Re-export shared utilities
export { cleanRow, normalizeSort } from '@data-fair/agent-tools-data-fair/_utils'

// Re-export per-tool modules
export * as searchData from '@data-fair/agent-tools-data-fair/search-data'
export * as aggregateData from '@data-fair/agent-tools-data-fair/aggregate-data'
export * as calculateMetric from '@data-fair/agent-tools-data-fair/calculate-metric'
export * as getFieldValues from '@data-fair/agent-tools-data-fair/get-field-values'
export * as getDatasetSchema from '@data-fair/agent-tools-data-fair/get-dataset-schema'
export * as describeDataset from '@data-fair/agent-tools-data-fair/describe-dataset'
export * as geocodeAddress from '@data-fair/agent-tools-data-fair/geocode-address'
export * as listDatasets from '@data-fair/agent-tools-data-fair/list-datasets'

/**
 * Based on https://github.com/data-fair/lib/blob/664c427f47233379c2051a08c5c610bcf6376b89/packages/express/req-origin.ts#L18
 */
export const getOrigin = (headers: IsomorphicHeaders | undefined): string => {
  if (config.portalUrl) return config.portalUrl
  if (!headers) throw new Error('Headers or portalUrl are required to determine the origin.')

  const forwardedHost = headers['x-forwarded-host']
  if (!forwardedHost) throw new Error('The "X-Forwarded-Host" header is required, please check the configuration of the reverse-proxy.')

  const forwardedProto = headers['x-forwarded-proto']
  if (!forwardedProto) throw new Error('The "X-Forwarded-Proto" header is required, please check the configuration of the reverse-proxy.')

  const origin = `${forwardedProto}://${forwardedHost}`
  const port = headers['x-forwarded-port']
  if (port && !(port === '443' && forwardedProto === 'https') && !(port === '80' && forwardedProto === 'http')) {
    return origin + ':' + port
  } else {
    return origin
  }
}

export const buildAxiosOptions = (headers: IsomorphicHeaders | undefined): AxiosRequestConfig => {
  const axiosHeaders: Record<string, string> = {
    'User-Agent': '@data-fair/mcp (Datasets)'
  }
  if (config.dataFairAPIKey) {
    axiosHeaders['x-api-key'] = config.dataFairAPIKey
  }
  if (config.ignoreRateLimiting) {
    axiosHeaders['x-ignore-rate-limiting'] = config.ignoreRateLimiting
  }
  return {
    headers: axiosHeaders,
    timeout: 30_000
  }
}

/**
 * Shared Zod schemas — descriptions read from agent-tools JSON schemas (single source of truth).
 * Zod adds runtime validation (regex, etc.) on top.
 */
export const datasetIdSchema = z.string().describe(datasetIdProperty.description)

export const filtersSchema = z.record(
  z.string().regex(/^.+_(search|eq|neq|in|nin|starts|contains|gte?|lte?|n?exists)$/, {
    message: 'Filter key must follow pattern: column_key + suffix (_eq, _neq, _search, _in, _nin, _starts, _contains, _gte, _gt, _lte, _lt, _exists, _nexists)'
  }),
  z.string()
).optional().describe(filterProperties.filters.description)

export const bboxSchema = z.string()
  .optional()
  .describe(filterProperties.bbox.description)

export const geoDistanceSchema = z.string()
  .optional()
  .describe(filterProperties.geoDistance.description)

export const dateMatchSchema = z.string()
  .optional()
  .describe(filterProperties.dateMatch.description)

/**
 * Wraps API errors with user-friendly messages to help models recover.
 */
export const handleApiError = (err: any): never => {
  if (err.response?.status === 404) {
    throw new Error('Dataset or resource not found. Verify the dataset ID by running list_datasets first.')
  }
  if (err.response?.status === 400) {
    throw new Error(`Invalid request: ${err.response.data?.message || 'Check column keys and filter syntax against describe_dataset schema.'}`)
  }
  throw err
}

/**
 * Apply a query Record to a URL's searchParams.
 */
export const applyQueryToUrl = (url: URL, query: Record<string, string>) => {
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value)
  }
}
