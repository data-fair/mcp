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
  transport: 'TRANSPORT'
}
