# <img alt="Data FAIR logo" src="https://cdn.jsdelivr.net/gh/data-fair/data-fair@master/ui/public/assets/logo.svg" width="25"> @data-fair/mcp ![GitHub License](https://img.shields.io/github/license/data-fair/mcp) ![GitHub package.json version](https://img.shields.io/github/package-json/v/data-fair/mcp)

A Model Context Protocol (MCP) server to interact with the Data Fair ecosystem.

## What it serves

This server composes the `explore` tools of the deployment's index — every service that
publishes an annotated OpenAPI document (`x-agent` operations) is discovered through
`GET /data-fair/api/v1/agents/index.json` and turned into MCP tools by
[`@data-fair/openapi-mcp`](https://github.com/data-fair/openapi-mcp). It also serves
`geocode_address` (an IGN geocoder, the one hand-written tool — no service document
describes it) and a compatibility route, `/mcp-server/datasets/mcp`, that keeps the seven
tool names earlier clients hard-coded. Nothing here declares a tool's name or schema: those
come from the services' documents, refreshed on an interval.

## Standalone (Docker, stdio)

Run the MCP server as a standalone Docker container that connects remotely to a Data Fair
instance. This mode uses the **stdio** transport and is suited for integrating with LLM
clients (e.g., Claude Desktop, VS Code).

- `PORTAL_URL` is **required** — set it to the base URL of the Data Fair portal you want to query.
- `DATA_FAIR_API_KEY` — optional API key for authenticating requests to the Data Fair instance.
- `PROFILES` — optional, comma-separated list of profiles to compose (default `explore`).

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

Tool names carry the `datafair_` prefix since 1.0 (e.g. `datafair_list_datasets`).

## Stack deployment (HTTP)

Deploy the MCP server as a web service alongside Data Fair in the same infrastructure
stack, using the **http** transport (`TRANSPORT=http`). One image, two deployments, told
apart by `mode`:

| | `mode: public` (`data-fair-mcp`) | `mode: internal` (`data-fair-mcp-internal`) |
|---|---|---|
| Reachable | through the ingress at `/mcp-server/` | ClusterIP only, no ingress |
| Profiles | gated by `publicProfiles` | unrestricted |
| Rate limiting | per IP, as today | off |
| `/status` | internal requests only | open |
| Registry listing | public profiles only | every profile |
| Typical extras | — | `upstreamProxyHost` |
| Consumers | external MCP clients, the compatibility alias | the agents service's autonomous runs |

Routes:

- `POST /mcp?profiles=` — the composed set for the requested profiles (default `explore`), plus extra tools
- `POST /datasets/mcp` — the compatibility alias (see below); `?profiles=` is ignored
- `GET /v0/servers` — an [MCP Registry API](https://github.com/modelcontextprotocol/registry) document, one entry per profile
- `GET /status` — services, last refresh time, active extra tools; `internal` mode only when deployed as `public`

## Environment variables

| Variable              | Description                                                                                                                                                              | Default | Mode              |
|-----------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------|-------------------|
| `PORTAL_URL`          | Base URL of the Data Fair portal. Required in standalone mode.                                                                                                           | —       | standalone         |
| `DATA_FAIR_API_KEY`   | API key sent to Data Fair for authentication.                                                                                                                            | —       | standalone         |
| `IGNORE_RATE_LIMITING`| Secret key sent to Data Fair to bypass rate limiting constraints.                                                                                                        | —       | stack only         |
| `TRANSPORT`           | Transport mode: `stdio` (standalone) or `http` (stack).                                                                                                                  | `stdio` | standalone/stack   |
| `PORT`                | Port for the HTTP server to listen on.                                                                                                                                   | `8080`  | stack only         |
| `OBSERVER_ACTIVE`     | Enable Prometheus metrics.                                                                                                                                               | `true`  | stack only         |
| `OBSERVER_PORT`       | Port for the Prometheus metrics observer.                                                                                                                                | `9090`  | stack only         |
| `MODE`                | `public` (behind the ingress, profiles gated, rate limited) or `internal` (ClusterIP only, no gate, no rate limiting).                                                  | `public`| stack only         |
| `MAIN_SITE_URL`       | Origin of the main site. The index and every document are fetched from it; upstream calls swap it for the requesting site's origin. Falls back to `PORTAL_URL` in stdio.| —       | stack only         |
| `INDEX_PATH`          | Path of the deployment's agent index on the main site.                                                                                                                   | `/data-fair/api/v1/agents/index.json` | stack only |
| `REFRESH_INTERVAL`    | Seconds between conditional re-fetches of the index and documents; `0` disables.                                                                                         | `300`   | stack only         |
| `PUBLIC_PROFILES`     | JSON array of the profiles a `public`-mode request may ask for, e.g. `PUBLIC_PROFILES='["explore"]'`.                                                                    | `["explore"]` | stack only (`public`) |
| `UPSTREAM_PROXY_HOST` | Optional in-cluster reverse proxy (`host` or `host:port`) every site host resolves to, skipping public DNS and the outer proxy hop.                                      | —       | stack only         |
| `EXTRA_TOOLS_GEOCODE_ADDRESS_ACTIVE` | JSON boolean; whether `geocode_address` is composed at all, e.g. `EXTRA_TOOLS_GEOCODE_ADDRESS_ACTIVE=false`.                                             | `true`  | standalone/stack   |
| `EXTRA_TOOLS_GEOCODE_ADDRESS_PROFILES` | JSON array; `geocode_address` joins the set when the request's profiles intersect this list.                                                          | `["explore"]` | standalone/stack |
| `PROFILES`            | Comma-separated list of profiles to compose.                                                                                                                             | `explore` | standalone       |

## Compatibility

`/mcp-server/datasets/mcp` keeps its pre-1.0 URL and its seven tool names
(`list_datasets`, `describe_dataset`, `search_data`, `get_field_values`, `aggregate_data`,
`calculate_metric`, `geocode_address`), unprefixed. Input schemas are generated from the
services' OpenAPI documents and are read per session, so they may differ from what a 0.x
client remembers. HTTP+SSE (`/sse`, `/messages`) is removed; only Streamable HTTP is served.

## Development

Take a look at the [contribution guidelines](./CONTRIBUTING.md).
