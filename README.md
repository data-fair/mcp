# <img alt="Data FAIR logo" src="https://cdn.jsdelivr.net/gh/data-fair/data-fair@master/ui/public/assets/logo.svg" width="25"> @data-fair/mcp ![GitHub License](https://img.shields.io/github/license/data-fair/mcp) ![GitHub package.json version](https://img.shields.io/github/package-json/v/data-fair/mcp)  

A Model Context Protocol (MCP) server to interact with the Data Fair ecosystem.

## ⚙️ Environment Variables

| Variable          | Description                                                                                                                                                                  | Default | Mode         |
|-------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------|--------------|
| `PORTAL_URL`      | Base URL of the Data Fair portal. If not set and `TRANSPORT=http`, the portal URL is inferred from the request origin. When `TRANSPORT=stdio`, you must set this value.      | —       | http/stdio   |
| `OBSERVER_ACTIVE` | Enable Prometheus metrics.                                                                                                                                                   | `true`  | http only    |
| `OBSERVER_PORT`   | Port for the Prometheus metrics observer.                                                                                                                                    | `9090`  | http only    |
| `PORT`            | Port for the HTTP server to listen on.                                                                                                                                       | `8080`  | http only    |
| `TRANSPORT`       | Transport mode : `stdio` or `http`                                                                                                                                           | `stdio` | http/stdio   |

Notes:

- In HTTP mode, `PORTAL_URL` is optional (derived from request origin). In stdio mode, it is required.
- Prometheus metrics (observer) run only in HTTP mode.

## 🔨 Development

Take a look at the [contribution guidelines](./CONTRIBUTING.md).
