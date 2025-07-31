// TODO handle SSE or STDIO transports based on config

import config from '#config'

if (config.transport === 'SSE') {
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
  const params = process.argv.slice(2)
  const mcpType = params[0]
  if (!mcpType) throw new Error('expected at least 1 argument: MCP server type (supported "dataset")')
  if (mcpType === 'dataset') {
    const datasetId = params[1]
    if (!datasetId) throw new Error('expected at least 2 arguments: "dataset" and datasetId')
    const { datasetMCPServer } = await import('./src/mcp-servers/dataset.ts')
    if (!config.dataFairUrl) throw new Error('dataFairUrl is required in config')
    const server = await datasetMCPServer(config.dataFairUrl, datasetId)
    const transport = new StdioServerTransport()
    await server.connect(transport)
  } else {
    throw new Error(`MDC server type unknown, expected "dataset" got "${mcpType}"`)
  }
}
