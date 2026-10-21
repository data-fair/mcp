# <img alt="Data FAIR logo" src="https://cdn.jsdelivr.net/gh/data-fair/data-fair@master/ui/src/assets/logo.svg" width="40"> @data-fair/mcp

![GitHub License](https://img.shields.io/github/license/data-fair/mcp) ![GitHub package.json version](https://img.shields.io/github/package-json/v/data-fair/mcp)  
*A Model Context Protocol (MCP) server to interact with the Data Fair ecosystem.*

Part of the [Data Fair](https://datafair.cloud) ecosystem.

## What it serves

Two MCP servers over data-fair's merged platform OpenAPI document
(`GET /data-fair/api/v1/platform/api-docs.json`, annotated with `x-agent`), turned into tools by
[`@data-fair/openapi-mcp`](https://github.com/data-fair/openapi-mcp). The document is kept live:
re-fetched conditionally on an interval, and clients are notified when the tools change.

- the **platform server** — every tool of the document, cut down to what the caller's token scopes
  allow (`toolsForScopes`). Always authenticated; tool names carry the `datafair_` prefix;
- the **datasets server** — the published catalog's six tools under the names earlier clients
  hard-coded (see Compatibility). Anonymous callers allowed.

Both also serve `geocode_address` (an IGN geocoder, the one hand-written tool — no service
document describes it), whatever the scopes. Nothing here declares a tool's name or schema:
those come from the platform document.

## Standalone (Docker, stdio)

Run the MCP server as a standalone Docker container that connects remotely to a Data Fair
instance. This mode uses the **stdio** transport and is suited for integrating with LLM
clients (e.g., Claude Desktop, VS Code).

- `PORTAL_URL` is **required** — set it to the base URL of the Data Fair portal you want to query.
- `DATA_FAIR_API_KEY` — optional API key for authenticating requests to the Data Fair instance.
- `MCP_SERVER` — `datasets` (default: the seven historic tool names) or `platform` (the `datafair_` tools the credentials allow). `platform` needs credentials and exits at startup without any.
- `HTTPS_PROXY` — optional forward proxy every call tunnels through (e.g. an identity-injecting proxy such as `@data-fair/nhi-proxy`); a TLS-intercepting proxy's CA goes in `NODE_EXTRA_CA_CERTS`.

With an API key the tools are not filtered (data-fair checks the key on every call). Otherwise, at
startup the server asks `<PORTAL_URL>/simple-directory/api/auth/my-session` who the environment
injects (a proxy adding a session), and the scopes of that session cut the tool list for the life
of the process.

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

## Stack deployment (HTTP)

Deploy the MCP server as a web service alongside Data Fair in the same infrastructure
stack, using the **http** transport (`TRANSPORT=http`), published through the ingress at
`/mcp-server/`. There is one deployment for every caller — external MCP clients and the agents
service alike (parity: our own agents get no surface another agent cannot reach).

Credentials are the caller's cookie session, a bearer access token or an API key, forwarded to
data-fair on every call, whose permissions are the boundary. Cookie and bearer sessions are
verified through `@data-fair/lib-express` against the directory (the server never decodes a JWT
itself) and their scopes filter the platform server's tools; a session without scopes and an API
key see every tool. A request without forwarded headers (an in-cluster caller) is read with the
main site as its site.

A cookie session may be anyone's, so an assistant in a portal can act as its user by relaying
the user's cookies. A bearer token must be an NHI's (non-human identity) and name this server in
its audience (`<site>/mcp-server`, which simple-directory gives tokens requested for an MCP
`resource`); a dashboard's user token is refused. When a request carries both, the bearer decides.

MCP clients connect with OAuth on sites where simple-directory runs an authorization server (the
main site and account main sites): a `401` from `/mcp` carries
`WWW-Authenticate: Bearer resource_metadata="<site>/mcp-server/.well-known/oauth-protected-resource/mcp"`,
and that metadata (RFC 9728) names the site's issuer. For example, with Claude Code:

```sh
claude mcp add --transport http datafair https://<site>/mcp-server/mcp
```

Other sites, and sites with a path prefix, offer no OAuth access: use an API key there.

This server has no general rate limiting of its own. nginx limits callers on the way in, and every
tool call that costs anything is a data-fair call, limited there by the caller's identity or by the IP
this server forwards (`X-Forwarded-For`, with the `TRUSTED_FORWARDER` secret that lets the ingress trust
it; a caller acting for no address, an autonomous agent's planned task, forwards none). The one
exception is `geocode_address`, which calls IGN: a global budget per instance and a per-caller one (forwarded IP, else identity)
(`EXTRA_TOOLS_GEOCODE_ADDRESS_LIMITS`). See data-fair's `docs/architecture/agent-rate-limiting.md`.

Routes:

- `POST /mcp` — the platform server; `401` with a `WWW-Authenticate` challenge without credentials, and for a cookie or bearer that does not verify
- `GET /.well-known/oauth-protected-resource/mcp` — the platform server's protected-resource metadata, on OAuth sites only (`404` elsewhere)
- `POST /datasets/mcp` — the datasets server (see Compatibility). A cookie or bearer that does not verify is dropped, not forwarded, and the caller served anonymously; valid credentials are forwarded and their scopes filter the six tools
- `GET /ai-catalog.json` — the site's AI Catalog (the MCP Server Card of the datasets server); route `/.well-known/ai-catalog.json` of every site host here
- `GET /status` — services of the platform document, last refresh time, datasets tools missing from the document, active extra tools; in-cluster callers only

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
| `MAIN_SITE_URL`       | Origin of the main site. The platform document is fetched from it; upstream calls swap it for the requesting site's origin. Falls back to `PORTAL_URL` in stdio.| —       | stack only         |
| `DOC_PATH`            | Path of the platform OpenAPI document on the main site.                                                                                                                  | `/data-fair/api/v1/platform/api-docs.json` | standalone/stack |
| `PRIVATE_DIRECTORY_URL` | In-cluster URL of simple-directory, used to verify sessions.                                                                                                           | `http://simple-directory:8080` | stack only |
| `MCP_SERVER`          | Which server stdio serves: `datasets` or `platform`.                                                                                                                     | `datasets` | standalone      |
| `REFRESH_INTERVAL`    | Seconds between conditional re-fetches of the platform document and its skills; `0` disables.                                                                                         | `300`   | standalone + stack |
| `UPSTREAM_PROXY_HOST` | Optional in-cluster reverse proxy (`host` or `host:port`, or a bracketed IPv6 literal such as `[::1]:8080`) every site host resolves to, skipping public DNS and the outer proxy hop. | —       | stack only         |
| `FILE_URL_PREFIXES`   | Comma-separated URL prefixes of the agents' file store (endpoint and bucket path, e.g. `https://s3.example.com/agents/`); the only URLs a file input is fetched from. Unset: tools that need a file are not offered. | — | standalone/stack |
| `FILE_MAX_SIZE`       | Largest file accepted, in bytes. | `104857600` | standalone/stack |
| `FILE_TIMEOUT`        | Seconds from the request to the last byte of a file. | `300` | standalone/stack |
| `EXTRA_TOOLS_GEOCODE_ADDRESS_ACTIVE` | JSON boolean; whether `geocode_address` is served at all, e.g. `EXTRA_TOOLS_GEOCODE_ADDRESS_ACTIVE=false`.                                             | `true`  | standalone/stack   |
| `EXTRA_TOOLS_GEOCODE_ADDRESS_LIMITS` | JSON: `{ "global": { "nb", "duration" }, "perCaller": { "nb", "duration" } }`, calls to IGN per instance and per caller (IGN allows 50 requests per second per source IP: divide by replicas). | 40/s, 10/s | standalone/stack |

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

A link is built on the main site's URL, where the tools were built; this server moves it onto
the site the call came through (`X-Forwarded-Host`), as `siteFetch` does for every request, so a
caller on a portal receives a portal URL. An in-cluster caller without forwarded headers gets the
main site's.

**Structured results.** Tool results carry the parsed JSON response as `structuredContent` (the
agents service's code mode works on it); the text block stays what a model reads. No tool
publishes an `outputSchema`, which MCP leaves optional. Measured against data-fair's platform document
(2026-10-13), a client that validates results — the TypeScript SDK 1.x does, in `listTools()` and
`callTool()` — would fail: several response schemas embed the same nested `$id`, which one Ajv
instance refuses to compile twice, so `listTools()` throws; and real responses do not match their
schema (computed fields such as `userPermissions` under `additionalProperties: false`, required
fields projected away by `select`), so `callTool()` refuses them. Output schemas come back when the
documents' response schemas can be honoured.

## Compatibility

The datasets server, `/mcp-server/datasets/mcp`, keeps its pre-1.0 URL and its seven tool names,
unprefixed, each mapped to a platform tool:

| Tool name | Platform tool |
|-----------|---------------|
| `list_datasets` | `datafair_list_datasets` |
| `describe_dataset` | `datafair_describe_dataset` |
| `search_data` | `datafair_search_data` |
| `get_field_values` | `datafair_get_field_values` |
| `aggregate_data` | `datafair_aggregate_data` |
| `calculate_metric` | `datafair_calculate_metric` |
| `geocode_address` | the hand-written IGN geocoder |

Descriptions and input schemas come from the platform document and are read per session, so they
may differ from what a 0.x client remembers. A mapped tool the document lacks is left out and
reported in `/status`. Skills and guides are served only when all their tools are in the set.
HTTP+SSE (`/sse`, `/messages`) is removed; only Streamable HTTP is served. In stdio, the datasets
server is the default (`MCP_SERVER=datasets`).

## Sponsors

<a href="https://koumoul.com"><img alt="Koumoul logo" src="https://cdn.jsdelivr.net/gh/data-fair/data-fair@master/docs/assets/koumoul-logo.png" height="56" align="left"></a>

**[Koumoul](https://koumoul.com)** · *La donnée accessible*<br>
Koumoul develops the Data Fair ecosystem and hosts it as an online service.

<br clear="left">

Click [here to support the development of this project](https://github.com/sponsors/koumoul-dev).

## 🔨 Development

Take a look at the [contribution guidelines](./CONTRIBUTING.md).
