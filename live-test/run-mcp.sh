#!/bin/sh
# Starts the published MCP server image on stdio, behind nhi-proxy, with the settings of .env.
# HTTPS_PROXY and NODE_EXTRA_CA_CERTS use the names nhi-proxy prints ("Other tools: …"), so its
# line can be pasted as is.
set -e
cd "$(dirname "$0")"
[ -f .env ] || { echo "live-test: no .env, copy .env.example and fill it from nhi-proxy's output" >&2; exit 1; }
set -a; . ./.env; set +a
: "${HTTPS_PROXY:?live-test: HTTPS_PROXY missing in .env}"
: "${NODE_EXTRA_CA_CERTS:?live-test: NODE_EXTRA_CA_CERTS missing in .env}"
[ -r "$NODE_EXTRA_CA_CERTS" ] || { echo "live-test: cannot read the CA $NODE_EXTRA_CA_CERTS" >&2; exit 1; }
# the proxy settings are for the server in the container, not for the docker CLI itself
exec env -u HTTPS_PROXY -u NODE_EXTRA_CA_CERTS docker run -i --rm --pull always --network host \
  -e "PORTAL_URL=${DF_PORTAL_URL:-https://staging-koumoul.com}" \
  -e "PROFILES=${DF_PROFILES:-catalog,read}" \
  -e "HTTPS_PROXY=$HTTPS_PROXY" \
  -e NODE_EXTRA_CA_CERTS=/nhi-ca.crt \
  -v "$NODE_EXTRA_CA_CERTS:/nhi-ca.crt:ro" \
  "ghcr.io/data-fair/mcp:${DF_MCP_TAG:-feat-openapi-mcp}"
