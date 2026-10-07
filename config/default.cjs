module.exports = {
  locale: 'en',
  portalUrl: undefined,
  dataFairAPIKey: undefined,
  ignoreRateLimiting: undefined,
  defaultLimits: {
    apiRate: {
      duration: 60, // in seconds
      nb: 100 // requests per duration
    }
  },
  observer: {
    active: true,
    port: 9090
  },
  port: 8080,
  transport: 'stdio',
  mainSiteUrl: undefined,
  indexPath: '/data-fair/api/v1/agents/index.json',
  refreshInterval: 300,
  upstreamProxyHost: undefined,
  extraTools: {
    geocodeAddress: { active: true, profiles: ['catalog', 'explore'] }
  }
}
