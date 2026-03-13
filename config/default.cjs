module.exports = {
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
    active: true
  },
  port: 8080,
  transport: 'stdio'
}
