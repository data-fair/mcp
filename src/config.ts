import type { ApiConfig } from '../config/type/index.ts'
import { assertValid } from '../config/type/index.ts'
import config from 'config'

export type { ApiConfig } from '../config/type/index.ts'

/**
 * Two variables are lists in a string. EXTRA_TOOLS_GEOCODE_ADDRESS_PROFILES accepts a JSON array
 * (`'["catalog","read"]'`) or a comma-separated list (`'catalog,read'`); FILE_URL_PREFIXES is a
 * comma-separated list, as for the openapi-mcp binary. custom-environment-variables.cjs leaves
 * both unparsed; this runs before assertValid so the schema (which requires arrays) sees arrays.
 */
export function normalizeLists<T extends { extraTools?: { geocodeAddress?: { profiles?: unknown } }, files?: { urlPrefixes?: unknown } }> (config: T): T {
  const toList = (value: unknown): string[] | undefined => {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    if (trimmed.startsWith('[')) return JSON.parse(trimmed)
    return trimmed.split(',').map(s => s.trim()).filter(Boolean)
  }
  const geocodeAddress = config.extraTools?.geocodeAddress
  const geocodeProfiles = toList(geocodeAddress?.profiles)
  if (geocodeProfiles && geocodeAddress) geocodeAddress.profiles = geocodeProfiles
  const urlPrefixes = toList(config.files?.urlPrefixes)
  if (urlPrefixes && config.files) config.files.urlPrefixes = urlPrefixes
  return config
}

// we reload the config instead of using the singleton from the config module for testing purposes
// @ts-ignore
const apiConfig = process.env.NODE_ENV === 'test' ? config.util.loadFileConfigs(process.env.NODE_CONFIG_DIR, { skipConfigSources: true }) : config

normalizeLists(apiConfig)
assertValid(apiConfig, { lang: 'en', name: 'config', internal: true })

export default apiConfig as ApiConfig
