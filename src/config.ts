import type { ApiConfig } from '../config/type/index.ts'
import { assertValid } from '../config/type/index.ts'
import config from 'config'

export type { ApiConfig } from '../config/type/index.ts'

/**
 * EXTRA_TOOLS_GEOCODE_ADDRESS_PROFILES accepts either a JSON array (`'["catalog","explore"]'`)
 * or a comma-separated list (`'catalog,explore'`). custom-environment-variables.cjs drops
 * `__format: 'json'` for this key so a plain string reaches here unparsed; this runs before
 * assertValid so the schema (which requires an array) always sees one.
 */
export function normalizeProfileLists<T extends { extraTools?: { geocodeAddress?: { profiles?: unknown } } }> (config: T): T {
  const toList = (value: unknown): string[] | undefined => {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    if (trimmed.startsWith('[')) return JSON.parse(trimmed)
    return trimmed.split(',').map(s => s.trim()).filter(Boolean)
  }
  const geocodeAddress = config.extraTools?.geocodeAddress
  const geocodeProfiles = toList(geocodeAddress?.profiles)
  if (geocodeProfiles && geocodeAddress) geocodeAddress.profiles = geocodeProfiles
  return config
}

// we reload the config instead of using the singleton from the config module for testing purposes
// @ts-ignore
const apiConfig = process.env.NODE_ENV === 'test' ? config.util.loadFileConfigs(process.env.NODE_CONFIG_DIR, { skipConfigSources: true }) : config

normalizeProfileLists(apiConfig)
assertValid(apiConfig, { lang: 'en', name: 'config', internal: true })

export default apiConfig as ApiConfig
