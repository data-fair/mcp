#!/bin/bash
# The MCP server in HTTP mode under nodemon; no container, it calls the site of config/development.cjs
. dev/env.sh
export NODE_ENV=development DEBUG="${DEBUG:-rate-limiting}"
export TRANSPORT="${TRANSPORT:-http}" PORT="${PORT:-$DEV_API_PORT}" OBSERVER_PORT="${OBSERVER_PORT:-$DEV_OBSERVER_PORT}"
exec ./node_modules/.bin/nodemon -e js,ts,cjs,json index.ts
