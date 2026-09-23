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
    active: 'OBSERVER_ACTIVE'
  },
  port: 'PORT',
  transport: 'TRANSPORT',
  mode: 'MODE',
  mainSiteUrl: 'MAIN_SITE_URL',
  indexPath: 'INDEX_PATH',
  refreshInterval: 'REFRESH_INTERVAL',
  publicProfiles: { __name: 'PUBLIC_PROFILES', __format: 'json' },
  upstreamProxyHost: 'UPSTREAM_PROXY_HOST',
  extraTools: {
    geocodeAddress: {
      active: { __name: 'EXTRA_TOOLS_GEOCODE_ADDRESS_ACTIVE', __format: 'json' },
      profiles: { __name: 'EXTRA_TOOLS_GEOCODE_ADDRESS_PROFILES', __format: 'json' }
    }
  }
}
