import express from 'express'
import { errorHandler, createSiteMiddleware } from '@data-fair/lib-express'
import datasetMCPServer from './mcp-servers/datasets/index.ts'
import { createMCPRouter } from './mcp-router-factory.ts'

const app = express()
export default app

// no fancy embedded arrays, just string and arrays of strings in req.query
app.set('query parser', 'simple')
app.set('json spaces', 2)

app.use(createSiteMiddleware('mcp-server'))

// Initialize the datasets MCP server
const datasetsRouter = createMCPRouter(datasetMCPServer)
app.use('/datasets', datasetsRouter)

app.use(errorHandler)
