# <img alt="Data FAIR logo" src="https://cdn.jsdelivr.net/gh/data-fair/data-fair@master/ui/src/assets/logo.svg" width="40"> @data-fair/mcp

![GitHub License](https://img.shields.io/github/license/data-fair/mcp) ![GitHub package.json version](https://img.shields.io/github/package-json/v/data-fair/mcp)  
*A Model Context Protocol (MCP) server to interact with the Data Fair ecosystem.*

Part of the [Data Fair](https://datafair.cloud) ecosystem.

## What it serves

This server composes the tools of the deployment's index — every service that publishes an
annotated OpenAPI document (`x-agent` operations) is discovered through
`GET /data-fair/api/v1/agents/index.json` and turned into MCP tools by
[`@data-fair/openapi-mcp`](https://github.com/data-fair/openapi-mcp), grouped by profile:

- `catalog` — what a portal publishes, in its end-user form: the default set;
- the `read` / `write` / `manage` grid per resource family (`read_datasets`, `write_portals`…),
  with the umbrellas `read`, `write`, `manage` — see data-fair's
  `docs/architecture/agent-profiles.md`;

It also serves `geocode_address` (an IGN geocoder, the one hand-written tool — no service
document describes it; it joins `catalog` sets) and a compatibility route,
`/mcp-server/datasets/mcp`, that keeps the seven tool names earlier clients hard-coded, on
data-fair's catalog tools. Nothing here declares a tool's name or schema: those
come from the services' documents, refreshed on an interval.

## Standalone (Docker, stdio)

Run the MCP server as a standalone Docker container that connects remotely to a Data Fair
instance. This mode uses the **stdio** transport and is suited for integrating with LLM
clients (e.g., Claude Desktop, VS Code).

- `PORTAL_URL` is **required** — set it to the base URL of the Data Fair portal you want to query.
- `DATA_FAIR_API_KEY` — optional API key for authenticating requests to the Data Fair instance.
- `PROFILES` — optional, comma-separated list of profiles to compose (default `catalog`).
- `HTTPS_PROXY` — optional forward proxy every call tunnels through (e.g. an identity-injecting proxy such as `@data-fair/nhi-proxy`); a TLS-intercepting proxy's CA goes in `NODE_EXTRA_CA_CERTS`.

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
stack, using the **http** transport (`TRANSPORT=http`), published through the ingress at
`/mcp-server/`. There is one deployment for every caller — external MCP clients and the agents
service alike (parity: our own agents get no surface another agent cannot reach). Every declared
profile is available to every caller; what a caller may actually do is data-fair's permissions
on the identity it forwards (cookie or API key).

This server has no general rate limiting of its own. nginx limits callers on the way in, and every
tool call that costs anything is a data-fair call, limited there by the caller's identity or by the IP
this server forwards (`X-Forwarded-For`, with the `TRUSTED_FORWARDER` secret that lets the ingress trust
it; a caller acting for no address, an autonomous agent's planned task, forwards none). The one
exception is `geocode_address`, which calls IGN: a global budget per instance and a per-caller one (forwarded IP, else identity)
(`EXTRA_TOOLS_GEOCODE_ADDRESS_LIMITS`). See data-fair's `docs/architecture/agent-rate-limiting.md`.

Routes:

- `POST /mcp?profiles=` — the composed set for the requested profiles (default `catalog`), plus extra tools; an undeclared profile is refused
- `POST /datasets/mcp` — the compatibility alias (see below); `?profiles=` is ignored
- `GET /v0/servers` — an [MCP Registry API](https://github.com/modelcontextprotocol/registry) document listing `catalog`, `read`, `write` and `manage` (the cells stay selectable by name)
- `GET /profiles` — the whole profile vocabulary (name, title, description, includes), for hosts that let an author choose profiles (the agents service's `profilesUrl`)
- `GET /mcp-server/ai-catalog.json` — the site's AI Catalog (MCP Server Card of the `catalog` profile); route `/.well-known/ai-catalog.json` of every site host here
- `GET /status` — services, last refresh time, active extra tools; in-cluster callers only

## Environment variables

| Variable              | Description                                                                                                                                                              | Default | Mode              |
|-----------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------|-------------------|
| `PORTAL_URL`          | Base URL of the Data Fair portal. Required in standalone mode.                                                                                                           | —       | standalone         |
| `DATA_FAIR_API_KEY`   | API key sent to Data Fair for authentication.                                                                                                                            | —       | standalone         |
| `LOCALE`              | Locale for tool titles: `en` or `fr`.                                                                                                                                    | `en`    | standalone/stack   |
| `TRUSTED_FORWARDER`   | Secret sent to the ingress (`X-Trusted-Forwarder`) with the caller's IP, or with none for a caller acting for no address; see data-fair `docs/architecture/agent-rate-limiting.md`. | — | stack only |
| `TRANSPORT`           | Transport mode: `stdio` (standalone) or `http` (stack).                                                                                                                  | `stdio` | standalone/stack   |
| `PORT`                | Port for the HTTP server to listen on.                                                                                                                                   | `8080`  | stack only         |
| `OBSERVER_ACTIVE`     | Enable Prometheus metrics.                                                                                                                                               | `true`  | stack only         |
| `OBSERVER_PORT`       | Port for the Prometheus metrics observer.                                                                                                                                | `9090`  | stack only         |
| `MAIN_SITE_URL`       | Origin of the main site. The index and every document are fetched from it; upstream calls swap it for the requesting site's origin. Falls back to `PORTAL_URL` in stdio.| —       | stack only         |
| `INDEX_PATH`          | Path of the deployment's agent index on the main site.                                                                                                                   | `/data-fair/api/v1/agents/index.json` | stack only |
| `REFRESH_INTERVAL`    | Seconds between conditional re-fetches of the index and documents; `0` disables.                                                                                         | `300`   | stack only         |
| `UPSTREAM_PROXY_HOST` | Optional in-cluster reverse proxy (`host` or `host:port`, or a bracketed IPv6 literal such as `[::1]:8080`) every site host resolves to, skipping public DNS and the outer proxy hop. | —       | stack only         |
| `FILE_URL_PREFIXES`   | Comma-separated URL prefixes of the agents' file store (endpoint and bucket path, e.g. `https://s3.example.com/agents/`); the only URLs a file input is fetched from. Unset: tools that need a file are not offered. | — | standalone/stack |
| `FILE_MAX_SIZE`       | Largest file accepted, in bytes. | `104857600` | standalone/stack |
| `FILE_TIMEOUT`        | Seconds from the request to the last byte of a file. | `300` | standalone/stack |
| `EXTRA_TOOLS_GEOCODE_ADDRESS_ACTIVE` | JSON boolean; whether `geocode_address` is composed at all, e.g. `EXTRA_TOOLS_GEOCODE_ADDRESS_ACTIVE=false`.                                             | `true`  | standalone/stack   |
| `EXTRA_TOOLS_GEOCODE_ADDRESS_PROFILES` | The profiles `geocode_address` joins, as a JSON array or a comma-separated list, e.g. `'["catalog"]'` or `catalog`. | `["catalog"]` | standalone/stack |
| `EXTRA_TOOLS_GEOCODE_ADDRESS_LIMITS` | JSON: `{ "global": { "nb", "duration" }, "perCaller": { "nb", "duration" } }`, calls to IGN per instance and per caller (IGN allows 50 requests per second per source IP: divide by replicas). | 40/s, 10/s | standalone/stack |
| `PROFILES`            | Comma-separated list of profiles to compose.                                                                                                                             | `catalog` | standalone       |

## Files and structured results

**Files.** Tools that take a file take a URL marked `x-mcp-file`
([SEP-2631](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2631); the same shape
as ChatGPT's [`openai/fileParams`](https://developers.openai.com/apps-sdk/reference)): the agents
service puts the file in its store and passes a presigned URL. This server fetches only URLs under
`FILE_URL_PREFIXES`, with a plain request that carries none of the caller's credentials, none of
`siteFetch`'s headers and not the rate-limit secret (a presigned URL authorizes itself), and
streams the file to the requesting site with an exact `Content-Length` — data-fair refuses a
chunked upload. Without a prefix, tools that need a file (`datafair_create_dataset_from_file`,
`datafair_replace_dataset_file`) are not offered at all. Mechanics:
[openapi-mcp `docs/x-agent.md#files`](https://github.com/data-fair/openapi-mcp/blob/main/docs/x-agent.md#files).
With `NODE_USE_ENV_PROXY`, put the store's host in `NO_PROXY`.

Tools that return a file (downloads, exports) send no request: they return an MCP
[`resource_link`](https://modelcontextprotocol.io/specification/latest/server/tools) that the
client fetches with its own credentials, so no file crosses this server in either direction.

A link is built on the main site's URL, where the tools were composed; this server moves it onto
the site the call came through (`X-Forwarded-Host`), as `siteFetch` does for every request, so a
caller on a portal receives a portal URL. An in-cluster caller without forwarded headers gets the
main site's.

**Structured results.** Tool results carry the parsed JSON response as `structuredContent` (the
agents service's code mode works on it); the text block stays what a model reads. No tool
publishes an `outputSchema`, which MCP leaves optional. Measured against data-fair's document
(2026-10-13), a client that validates results — the TypeScript SDK 1.x does, in `listTools()` and
`callTool()` — would fail: several response schemas embed the same nested `$id`, which one Ajv
instance refuses to compile twice, so `listTools()` throws; and real responses do not match their
schema (computed fields such as `userPermissions` under `additionalProperties: false`, required
fields projected away by `select`), so `callTool()` refuses them. Output schemas come back when the
documents' response schemas can be honoured.

## Compatibility

`/mcp-server/datasets/mcp` keeps its pre-1.0 URL and its seven tool names
(`list_datasets`, `describe_dataset`, `search_data`, `get_field_values`, `aggregate_data`,
`calculate_metric`, `geocode_address`), unprefixed. Input schemas are generated from the
services' OpenAPI documents and are read per session, so they may differ from what a 0.x
client remembers. HTTP+SSE (`/sse`, `/messages`) is removed; only Streamable HTTP is served.

## Sponsors

<a href="https://koumoul.com"><img alt="Koumoul logo" src="https://cdn.jsdelivr.net/gh/data-fair/data-fair@master/docs/assets/koumoul-logo.png" height="56" align="left"></a>

**[Koumoul](https://koumoul.com)** · *La donnée accessible*<br>
Koumoul develops the Data Fair ecosystem and hosts it as an online service.

<br clear="left">

Click [here to support the development of this project](https://github.com/sponsors/koumoul-dev).

## 🔨 Development

Take a look at the [contribution guidelines](./CONTRIBUTING.md).
