#!/bin/bash
# The MCP server in HTTP mode under nodemon; no container, it calls the site of config/development.cjs
. dev/env.sh
export NODE_ENV=development DEBUG="${DEBUG:-rate-limiting}"
export TRANSPORT="${TRANSPORT:-http}" PORT="${PORT:-$DEV_API_PORT}" OBSERVER_PORT="${OBSERVER_PORT:-$DEV_OBSERVER_PORT}"
# A local site started together with this server may not answer yet: the server exits when the first load of the
# platform document fails, and nodemon then waits for a file change. Wait for it (bounded) before starting.
site="${MAIN_SITE_URL:-${PORTAL_URL:-}}"
if [ -n "$site" ]; then
  doc="${site%/}${DOC_PATH:-/data-fair/api/v1/platform/api-docs.json}"
  for _ in $(seq 1 90); do
    curl -sf -o /dev/null "$doc" && break
    sleep 2
  done
fi
exec ./node_modules/.bin/nodemon -e js,ts,cjs,json index.ts
