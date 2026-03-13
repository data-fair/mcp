import { Router, type Request, type Response } from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * Creates and configures Express routes for an MCP server instance
 *
 * @param config The configuration for the MCP router
 * @returns An Express Router with all needed MCP routes configured
 */
export function createMCPRouter (mcpServer: McpServer): Router {
  const router = Router()

  // CORS support for browser-based MCP clients
  router.use((req: Request, res: Response, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }
    next()
  })

  // Store transports for legacy SSE clients
  const sseTransports: Record<string, SSEServerTransport> = {}

  // -------------- Streamable HTTP Server Transport --------------
  // Handle POST requests for client-to-server communication
  router.post('/mcp', async (req: Request, res: Response) => {
    try {
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      })
      res.on('close', () => {
        transport.close()
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
  router.get('/mcp', handleSessionRequest)
  // Session termination not needed in stateless mode
  router.delete('/mcp', handleSessionRequest)

  // -------------- Legacy Endpoints for SSE older clients --------------
  router.get('/sse', async (req: Request, res: Response) => {
    const transport = new SSEServerTransport('/messages', res)
    sseTransports[transport.sessionId] = transport

    res.on('close', () => {
      delete sseTransports[transport.sessionId]
    })

    await mcpServer.connect(transport)
  })

  router.post('/messages', async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string
    const transport = sseTransports[sessionId]
    if (transport) {
      await transport.handlePostMessage(req, res, req.body)
    } else {
      res.status(400).send('No transport found for sessionId')
    }
  })

  return router
}
