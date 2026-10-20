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
  docPath: '/data-fair/api/v1/platform/api-docs.json',
  // in-cluster directory, where in stdio mode and for scope discovery the session is read
  privateDirectoryUrl: 'http://simple-directory:8080',
  mcpServer: 'datasets',
  refreshInterval: 300,
  upstreamProxyHost: undefined,
  extraTools: {
    geocodeAddress: {
      active: true,
      // IGN allows 50 requests per second per source IP: global is per instance, so divide by replicas
      limits: { global: { nb: 40, duration: 1 }, perCaller: { nb: 10, duration: 1 } }
    }
  },
  files: {
    urlPrefixes: []
  }
}
