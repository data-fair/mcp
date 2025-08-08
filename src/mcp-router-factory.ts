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

  // Store transports for this specific MCP server instance
  const transports = {
    streamable: {} as Record<string, StreamableHTTPServerTransport>,
    sse: {} as Record<string, SSEServerTransport>
  }

  // -------------- Streamable HTTP Server Transport --------------
  // Handle POST requests for client-to-server communication
  router.post('/mcp', async (req: Request, res: Response) => {
    try {
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      })
      res.on('close', () => {
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
  router.get('/mcp', handleSessionRequest)
  // Session termination not needed in stateless mode
  router.delete('/mcp', handleSessionRequest)

  // -------------- Legacy Endpoints for SSE older clients --------------
  router.get('/sse', async (req: Request, res: Response) => {
    const transport = new SSEServerTransport('/messages', res)
    transports.sse[transport.sessionId] = transport

    res.on('close', () => {
      delete transports.sse[transport.sessionId]
    })

    await mcpServer.connect(transport)
  })

  router.post('/messages', async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string
    const transport = transports.sse[sessionId]
    if (transport) {
      await transport.handlePostMessage(req, res, req.body)
    } else {
      res.status(400).send('No transport found for sessionId')
    }
  })

  return router
}
