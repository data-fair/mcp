import type { ApiConfig } from '../config/type/index.ts'
import { assertValid } from '../config/type/index.ts'
import config from 'config'

export type { ApiConfig } from '../config/type/index.ts'

/**
 * FILE_URL_PREFIXES is a comma-separated list, as for the openapi-mcp binary.
 * custom-environment-variables.cjs leaves it unparsed; this runs before assertValid so the
 * schema (which requires an array) sees an array.
 */
export function normalizeLists<T extends { files?: { urlPrefixes?: unknown } }> (config: T): T {
  const value = config.files?.urlPrefixes
  if (typeof value === 'string' && config.files) {
    const trimmed = value.trim()
    config.files.urlPrefixes = trimmed.startsWith('[') ? JSON.parse(trimmed) : trimmed.split(',').map(s => s.trim()).filter(Boolean)
  }
  return config
}

// we reload the config instead of using the singleton from the config module for testing purposes
// @ts-ignore
const apiConfig = process.env.NODE_ENV === 'test' ? config.util.loadFileConfigs(process.env.NODE_CONFIG_DIR, { skipConfigSources: true }) : config

normalizeLists(apiConfig)
assertValid(apiConfig, { lang: 'en', name: 'config', internal: true })

export default apiConfig as ApiConfig
