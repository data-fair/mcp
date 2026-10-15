/**
 * @param {string} key
 */

module.exports = {
  locale: 'LOCALE',
  portalUrl: 'PORTAL_URL',
  dataFairAPIKey: 'DATA_FAIR_API_KEY',
  trustedForwarder: 'TRUSTED_FORWARDER',
  observer: {
    active: 'OBSERVER_ACTIVE',
    port: 'OBSERVER_PORT'
  },
  port: 'PORT',
  transport: 'TRANSPORT',
  mainSiteUrl: 'MAIN_SITE_URL',
  indexPath: 'INDEX_PATH',
  refreshInterval: 'REFRESH_INTERVAL',
  // JSON array or comma-separated list, both accepted (see normalizeLists in
  // src/config.ts) — so __format: 'json' is left off here, the raw string reaches config.
  upstreamProxyHost: 'UPSTREAM_PROXY_HOST',
  extraTools: {
    geocodeAddress: {
      active: { __name: 'EXTRA_TOOLS_GEOCODE_ADDRESS_ACTIVE', __format: 'json' },
      profiles: 'EXTRA_TOOLS_GEOCODE_ADDRESS_PROFILES',
      limits: { __name: 'EXTRA_TOOLS_GEOCODE_ADDRESS_LIMITS', __format: 'json' }
    }
  },
  // FILE_URL_PREFIXES: a comma-separated list, split by normalizeLists in src/config.ts
  files: {
    urlPrefixes: 'FILE_URL_PREFIXES',
    maxSize: { __name: 'FILE_MAX_SIZE', __format: 'json' },
    timeout: { __name: 'FILE_TIMEOUT', __format: 'json' }
  }
}
