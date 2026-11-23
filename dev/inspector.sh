#!/bin/bash
# The MCP inspector on the dev server
. dev/env.sh
# inspector 2: SERVER_PORT is the MCP Apps sandbox; the app origin takes any free port
export CLIENT_PORT="${CLIENT_PORT:-$INSPECTOR_PORT}" SERVER_PORT="${SERVER_PORT:-$INSPECTOR_PROXY_PORT}" MCP_APP_ORIGIN_PORT=0
exec ./node_modules/.bin/mcp-inspector --transport http --server-url "http://localhost:${PORT:-$DEV_API_PORT}/mcp-server/mcp"
