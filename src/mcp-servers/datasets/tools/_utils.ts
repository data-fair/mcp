import type { IsomorphicHeaders } from '@modelcontextprotocol/sdk/types.js'
import type { AxiosRequestConfig } from 'axios'
import { z } from 'zod'
import config from '#config'

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

export const buildAxiosOptions = (headers: IsomorphicHeaders | undefined, defineBaseURL?: boolean): AxiosRequestConfig => {
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
    baseURL: defineBaseURL ? getOrigin(headers) + '/data-fair/api/v1' : undefined,
    headers: axiosHeaders
  }
}

export const encodeDatasetId = (datasetId: string): string => encodeURIComponent(datasetId)

/**
 * Zod schema for filters.
 * Available suffixes are defined in the main data-fair project:
 * see data-fair/api/src/datasets/es/commons.js (filterItem function)
 */
export const filtersSchema = z.record(
  z.string().regex(/^.+_(search|eq|neq|in|nin|starts|contains|gte?|lte?|n?exists)$/, {
    message: 'Filter key must follow pattern: column_key + suffix (_eq, _neq, _search, _in, _nin, _starts, _contains, _gte, _gt, _lte, _lt, _exists, _nexists)'
  }),
  z.string()
).optional().describe('Column filters as key-value pairs. Key format: column_key + suffix (see server instructions for available suffixes). Example: { "nom_search": "Jean", "age_lte": "30", "ville_eq": "Paris" }')
