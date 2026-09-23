/**
 * @param {string} key
 */

module.exports = {
  locale: 'LOCALE',
  portalUrl: 'PORTAL_URL',
  dataFairAPIKey: 'DATA_FAIR_API_KEY',
  ignoreRateLimiting: 'IGNORE_RATE_LIMITING',
  defaultLimits: {
    apiRate: {
      duration: 'DEFAULT_LIMITS_API_RATE_DURATION',
      nb: 'DEFAULT_LIMITS_API_RATE_NB'
    }
  },
  observer: {
    active: 'OBSERVER_ACTIVE',
    port: 'OBSERVER_PORT'
  },
  port: 'PORT',
  transport: 'TRANSPORT',
  mode: 'MODE',
  mainSiteUrl: 'MAIN_SITE_URL',
  indexPath: 'INDEX_PATH',
  refreshInterval: 'REFRESH_INTERVAL',
  // JSON array or comma-separated list, both accepted (see normalizeProfileLists in
  // src/config.ts) — so __format: 'json' is left off here, the raw string reaches config.
  publicProfiles: 'PUBLIC_PROFILES',
  upstreamProxyHost: 'UPSTREAM_PROXY_HOST',
  extraTools: {
    geocodeAddress: {
      active: { __name: 'EXTRA_TOOLS_GEOCODE_ADDRESS_ACTIVE', __format: 'json' },
      profiles: 'EXTRA_TOOLS_GEOCODE_ADDRESS_PROFILES'
    }
  }
}
