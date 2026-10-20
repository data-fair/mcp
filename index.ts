import config from '#config'

if (config.transport === 'http') {
  const { start, stop } = await import('./src/server.ts')
  start().then(() => { }, err => {
    console.error('Failure while starting service', err)
    process.exit(1)
  })

  process.on('SIGTERM', function onSigterm () {
    console.info('Received SIGTERM signal, shutdown gracefully...')
    stop().then(() => {
      console.log('shutting down now')
      process.exit()
    }, err => {
      console.error('Failure while stopping service', err)
      process.exit(1)
    })
  })
} else {
  // Standalone: one process, one site (PORTAL_URL), one caller; the API key is the identity.
  const { serveStdio } = await import('@modelcontextprotocol/server/stdio')
  const { mcpServerFactory } = await import('@data-fair/openapi-mcp/adapters/mcp')
  const { createDispatcher } = await import('./src/site-fetch.ts')
  const { createPlatform } = await import('./src/platform.ts')
  const { siteFetch } = await import('./src/site-fetch.ts')
  const { stdioSession } = await import('./src/scopes.ts')
  const mainSiteUrl = config.mainSiteUrl ?? config.portalUrl
  if (!mainSiteUrl) { console.error('PORTAL_URL (or MAIN_SITE_URL) is required in stdio mode'); process.exit(1) }
  // a local server may sit behind a forward proxy (nhi-proxy…); its CA comes through NODE_EXTRA_CA_CERTS
  const forwardProxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy
  const dispatcher = createDispatcher({ mainSiteUrl, forwardProxy: forwardProxy || undefined, timeoutMs: 30_000 })
  // stdio sends no forwarder secret to the site (spec §4): a deployment sharing
  // config.trustedForwarder with a stack sibling must not leak it here.
  const platform = await createPlatform({ config: { ...config, trustedForwarder: undefined }, dispatcher, mainSiteUrl })
  const { authenticated, scopes } = await stdioSession({ mainSiteUrl, dispatcher, apiKey: config.dataFairAPIKey })
  if (config.mcpServer === 'platform' && !authenticated) {
    console.error('MCP_SERVER=platform needs credentials: DATA_FAIR_API_KEY or a proxy injecting a session')
    process.exit(1)
  }
  const headers = config.dataFairAPIKey ? { 'x-apikey': config.dataFairAPIKey } : undefined
  const context = () => ({ fetch: siteFetch(mainSiteUrl, { mainSiteUrl, dispatcher }), headers })
  const version: string = (await import('./package.json', { with: { type: 'json' } })).default.version
  const name = config.mcpServer === 'platform' ? 'datafair-mcp-server' : 'datafair-datasets-mcp-server'
  let pinned: import('@modelcontextprotocol/server').Server | undefined
  const factory = mcpServerFactory(() => config.mcpServer === 'platform' ? platform.platform(scopes) : platform.datasets(scopes), { name, version }, { context })
  serveStdio(async (ctx) => { pinned = await factory(ctx) as import('@modelcontextprotocol/server').Server; return pinned })
  platform.onChange(() => pinned?.sendToolListChanged().catch(() => {}))
  console.error(`${name} ready on stdio (${mainSiteUrl})`)
}
