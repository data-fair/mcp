import config from '#config'
import express, { type Request, type Response } from 'express'
import { errorHandler, reqSiteUrl, createSiteMiddleware } from '@data-fair/lib-express'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import datasetMCPServer from './mcp-servers/dataset.ts'

const app = express()
export default app

// no fancy embedded arrays, just string and arrays of strings in req.query
app.set('query parser', 'simple')
app.set('json spaces', 2)

app.use(createSiteMiddleware('mcp', { prefixOptional: true }))

// cf https://github.com/modelcontextprotocol/typescript-sdk?tab=readme-ov-file#http-with-sse
const transports: { [sessionId: string]: SSEServerTransport } = {}

app.get('/api/datasets/:id/sse', async (req: Request, res: Response) => {
  const dataFairUrl = config.dataFairUrl ?? (reqSiteUrl(req) + '/data-fair')
  const server = await datasetMCPServer(dataFairUrl, req.params.id)
  const messagesUrl = `/mcp/api/datasets/${req.params.id}/messages`
  const transport = new SSEServerTransport(messagesUrl, res)
  transports[transport.sessionId] = transport
  res.on('close', () => {
    delete transports[transport.sessionId]
  })
  res.setHeader('X-Accel-Buffering', 'no')
  await server.connect(transport)
})

app.post('/api/datasets/:id/messages', async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string
  const transport = transports[sessionId]
  if (transport) {
    await transport.handlePostMessage(req, res)
  } else {
    res.status(400).send('No transport found for sessionId')
  }
})

app.use(errorHandler)
