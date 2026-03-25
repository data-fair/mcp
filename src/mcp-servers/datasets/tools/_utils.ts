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
).optional().describe('Column filters as key-value pairs. Key format: column_key + suffix (see server instructions for available suffixes). All values must be strings, even for numbers/dates. If a column key has underscores (e.g., code_postal), just append the suffix: code_postal_eq. Example: { "nom_search": "Jean", "age_lte": "30", "ville_eq": "Paris" }')

export const bboxSchema = z.string()
  .optional()
  .describe('Geographic bounding box filter (only for geolocalized datasets). Format: "lonMin,latMin,lonMax,latMax". Example: "-2.5,43,3,47".')

export const geoDistanceSchema = z.string()
  .optional()
  .describe('Geographic proximity filter (only for geolocalized datasets). Restricts results to within a distance from a point. Format: "lon,lat,distance". Example: "2.35,48.85,10km". Use distance "0" for point-in-polygon containment.')

export const dateMatchSchema = z.string()
  .optional()
  .describe('Temporal filter (only for temporal datasets with date fields). Accepts a single date "YYYY-MM-DD" to match that day, or a date range "YYYY-MM-DD,YYYY-MM-DD" to match an overlapping period. ISO datetimes also accepted. Example: "2023-11-21" or "2023-01-01,2023-12-31".')

export const applyGeoParams = (url: URL, bbox?: string, geoDistance?: string) => {
  if (bbox) url.searchParams.set('bbox', bbox)
  if (geoDistance) url.searchParams.set('geo_distance', geoDistance)
}

export const applyDateMatchParam = (url: URL, dateMatch?: string) => {
  if (dateMatch) url.searchParams.set('date_match', dateMatch)
}

/**
 * Join non-empty text sections with blank lines.
 */
export const formatTextOutput = (sections: string[]): string => {
  return sections.filter(s => s.length > 0).join('\n\n')
}

/**
 * Drop incomplete _geo_distance sort entries (without :lon:lat suffix).
 * LLMs sometimes write sort: "_geo_distance" redundantly when a geoDistance filter is already present.
 * The API already auto-sorts by distance when a geo_distance filter is set.
 */
export const normalizeSort = (sort: string): string => {
  return sort.split(',').map(part => {
    const trimmed = part.trim()
    if (/^-?_geo_distance$/.test(trimmed)) return null
    return trimmed
  }).filter(Boolean).join(',')
}

/**
 * Wraps API errors with user-friendly messages to help models recover.
 */
export const handleApiError = (err: any): never => {
  if (err.response?.status === 404) {
    throw new Error('Dataset or resource not found. Verify the dataset ID by running search_datasets first.')
  }
  if (err.response?.status === 400) {
    throw new Error(`Invalid request: ${err.response.data?.message || 'Check column keys and filter syntax against describe_dataset schema.'}`)
  }
  throw err
}
