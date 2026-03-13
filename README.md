# <img alt="Data FAIR logo" src="https://cdn.jsdelivr.net/gh/data-fair/data-fair@master/ui/public/assets/logo.svg" width="25"> @data-fair/mcp ![GitHub License](https://img.shields.io/github/license/data-fair/mcp) ![GitHub package.json version](https://img.shields.io/github/package-json/v/data-fair/mcp)

A Model Context Protocol (MCP) server to interact with the Data Fair ecosystem.

## Usage modes

This MCP server can be used in two different modes:

### Standalone mode (Docker)

Run the MCP server as a standalone Docker container that connects remotely to a Data Fair instance. This mode uses the **stdio** transport and is suited for integrating with LLM clients (e.g., Claude Desktop, VS Code).

- `PORTAL_URL` is **required** — set it to the base URL of the Data Fair portal you want to query.
- `DATA_FAIR_API_KEY` — optional API key for authenticating requests to the Data Fair instance.

```json
{
  "mcpServers": {
    "data-fair-datasets": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "PORTAL_URL=https://opendata.koumoul.com", "ghcr.io/data-fair/mcp"]
    }
  }
}
```

### Data Fair stack mode (web service)

Deploy the MCP server as a web service alongside Data Fair in the same infrastructure stack. In this mode, the server is typically available on `/mcp-server` on the same domain as the Data Fair instance (Data Fair is deployed on `/data-fair`, a portal on `/`, etc.).

Example endpoint: `https://opendata.koumoul.com/mcp-server/datasets/mcp`

- Uses the **http** transport (`TRANSPORT=http`).
- `PORTAL_URL` is **optional** — it is automatically inferred from reverse-proxy headers (`X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-Port`).
- `IGNORE_RATE_LIMITING` — optional secret to bypass Data Fair rate limiting constraints.
- Authentication is handled by the reverse proxy and session management of the Data Fair stack.

## ⚙️ Environment Variables

| Variable              | Description                                                                                                                                                              | Default | Mode              |
|-----------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------|-------------------|
| `PORTAL_URL`          | Base URL of the Data Fair portal. Required in standalone mode.                                                                                                           | —       | standalone         |
| `DATA_FAIR_API_KEY`   | API key sent to Data Fair for authentication.                                                                                                                            | —       | standalone         |
| `IGNORE_RATE_LIMITING`| Secret key sent to Data Fair to bypass rate limiting constraints.                                                                                                        | —       | stack only         |
| `TRANSPORT`           | Transport mode: `stdio` (standalone) or `http` (stack).                                                                                                                  | `stdio` | standalone/stack   |
| `PORT`                | Port for the HTTP server to listen on.                                                                                                                                   | `8080`  | stack only         |
| `OBSERVER_ACTIVE`     | Enable Prometheus metrics.                                                                                                                                               | `true`  | stack only         |
| `OBSERVER_PORT`       | Port for the Prometheus metrics observer.                                                                                                                                | `9090`  | stack only         |

## 🔨 Development

Take a look at the [contribution guidelines](./CONTRIBUTING.md).
