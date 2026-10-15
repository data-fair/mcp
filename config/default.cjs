module.exports = {
  locale: 'en',
  portalUrl: undefined,
  dataFairAPIKey: undefined,
  // the secret proving to the ingress that this relay forwards its callers' IP (or none)
  trustedForwarder: undefined,
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
    geocodeAddress: {
      active: true,
      profiles: ['catalog'],
      // IGN allows 50 requests per second per source IP: global is per instance, so divide by replicas
      limits: { global: { nb: 40, duration: 1 }, perCaller: { nb: 10, duration: 1 } }
    }
  },
  files: {
    urlPrefixes: []
  }
}
