import express, { type Request, type Response } from 'express'
import { errorHandler, createSiteMiddleware } from '@data-fair/lib-express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import config from '#config'
import MCPServer from './mcp-server/index.ts'

const app = express()
export default app

// no fancy embedded arrays, just string and arrays of strings in req.query
app.set('query parser', 'simple')
app.set('json spaces', 2)

app.use(createSiteMiddleware('mcp-server'))

// Store transports for each session type
const transports = {
  streamable: {} as Record<string, StreamableHTTPServerTransport>,
  sse: {} as Record<string, SSEServerTransport>
}

// Setup MCPServer (resources, tools and prompts)
const mcpServer = await MCPServer(config.dataFairUrl)

// -------------- Streamable HTTP Server Transport --------------
// Based on https://github.com/modelcontextprotocol/typescript-sdk?tab=readme-ov-file#with-session-management

// Handle POST requests for client-to-server communication
app.post('/datasets/mcp', async (req: Request, res: Response) => {
  try {
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    })
    res.on('close', () => {
      console.log('Request closed')
      transport.close()
      mcpServer.close()
    })
    await mcpServer.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (error) {
    console.error('Error handling MCP request:', error)
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      })
    }
  }
})

// Reusable handler for GET and DELETE requests
const handleSessionRequest = async (req: Request, res: Response) => {
  console.log('Received GET or DELETE MCP request')
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: 'Method not allowed.'
    },
    id: null
  }))
}

// SSE notifications not supported in stateless mode
app.get('/datasets/mcp', handleSessionRequest)
// Session termination not needed in stateless mode
app.delete('/datasets/mcp', handleSessionRequest)

// -------------- Legacy Endpoints for SSE older clients --------------
// Based on https://github.com/modelcontextprotocol/typescript-sdk?tab=readme-ov-file#server-side-compatibility

app.get('/datasets/sse', async (req: Request, res: Response) => {
  const transport = new SSEServerTransport('/messages', res)
  transports.sse[transport.sessionId] = transport

  res.on('close', () => {
    delete transports.sse[transport.sessionId]
  })

  await mcpServer.connect(transport)
})

app.post('/datasets/messages', async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string
  const transport = transports.sse[sessionId]
  if (transport) {
    await transport.handlePostMessage(req, res, req.body)
  } else {
    res.status(400).send('No transport found for sessionId')
  }
})

app.use(errorHandler)
