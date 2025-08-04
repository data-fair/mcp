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
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
  const { datasetMCPServer } = await import('./src/mcp-server/index.ts')
  const server = await datasetMCPServer(config.dataFairUrl)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
