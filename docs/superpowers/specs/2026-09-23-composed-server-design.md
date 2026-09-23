# The composed server (v2) — design

*2026-09-23.* `data-fair/mcp` becomes the deployed MCP server of the stack composition design
(`openapi-mcp/docs/superpowers/specs/2026-09-22-stack-composition-design.md`, roadmap step 3):
it composes the deployment's index through `@data-fair/openapi-mcp` and serves the result
over stdio and HTTP, carrying each caller's identity and site, and keeps the route existing
clients use.

## Why

The seven hand-written tools in `src/mcp-servers/datasets/` duplicate, in Zod, schemas that
live in `@data-fair/agent-tools-data-fair`, which duplicate what data-fair's OpenAPI document
already says — the drift warning in `AGENTS.md` is the cost. openapi-mcp's parity evaluation
showed tools generated from the annotated document hold up against them, and data-fair now
emits the annotations and an index of the stack's documents (`GET /api/v1/agents/index.json`).
This server stops describing tools and starts composing them.

What it keeps is everything a stack service needs and the library does not own: typed
config, the site middleware, per-IP rate limiting, the observer, the Docker image and the
branch-tagged CI images, and the route external clients have configured.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| How many composers | **One**, over the main site's public index | The tool definitions never vary per site; only where calls go does |
| Site of a call | The request's origin (`reqOrigin(req)`), swapped into every upstream URL per call; an in-cluster caller without forwarded headers keeps the main site | data-fair derives visibility (`publicationSites`) and links from the forwarded host; main-domain semantics is right for a back-office agent |
| Path to the services | The site's **public origin**, with DNS cached by an undici `dns` interceptor, `x-ignore-rate-limiting` and the request's cookies — portals' `01-local-fetch.ts` recipe | The reverse proxy's metrics log counts the calls; the rate-limit key is neutralised by the secret; proven in production |
| Optional in-cluster short-cut | `upstreamProxyHost`: resolve every site host to that service (the L2 nginx), plain HTTP, `X-Forwarded-Host/Proto` added | Same metrics, same rate-limit key, no public DNS or L1 hop; off by default |
| Identity | `Cookie` and `x-apiKey`/`x-api-key` copied from the caller; `identity` = SHA-256 of whichever is present | The library never reads a cookie; the caller is whoever the reverse proxy or the agents service says |
| Deployments | **One image, two deployments**, told apart by `mode`: `public` behind the ingress, `internal` on a ClusterIP with no ingress for the agents service | Isolation (pods, memory, the per-IP limiter would throttle the agents pod as one client), independent scaling, and a boundary made of network reachability rather than a header |
| Profiles | `?profiles=` per request; in `public` mode every request is limited to `publicProfiles` (default `['explore']`), 403 otherwise; `internal` mode has no gate | The door for `edit` later, closed by default on the public side, open where only the agents service can reach |
| `geocode_address` | Copied into this repo, enabled by `extraTools.geocodeAddress.active`, joined into `extraTools.geocodeAddress.profiles` | IGN has no `x-agent` document; the tool stays, the `agent-tools` dependency goes |
| Compatibility | `/mcp-server/datasets/mcp` serves data-fair's `explore` operations unprefixed plus `geocode_address` — the seven names clients have | URL and tool names are what clients hard-code; schemas are read per session |
| HTTP+SSE | Removed | Deprecated since protocol `2025-03-26`; not in SDK v2 |
| stdio | The composed set with `datafair_` prefixes; `PORTAL_URL` is the main site | A stdio process has no route to alias; the documented break for standalone users |
| Discovery | `/mcp-server/v0/servers` in the MCP Registry API format, one entry per profile | How a host with a picker (the agents service) learns what exists |

## 1. Composition

`src/composition.ts` — created at startup, one for the process:

```ts
const composer = await createComposer(`${config.mainSiteUrl}${config.indexPath}`, {
  fetch: siteFetch(config.mainSiteUrl),   // section 2's fetch, pinned to the main site
  locale: config.locale,
  lint: 'warn'
})
setInterval(() => composer.refresh().catch(log), config.refreshInterval * 1000).unref()
```

- `mainSiteUrl` is the main site's origin (`https://staging-koumoul.com`); in stdio mode it is
  `PORTAL_URL`. `indexPath` defaults to `/data-fair/api/v1/agents/index.json`.
- `lint: 'warn'`: a description/schema disagreement in a service's document is that
  service's CI failure, not a reason for this server to serve nothing.
- The composed set for a request is `composer.compose(profiles)`; the alias's set is
  `composer.compose(['explore'], { services: ['data-fair'], namePrefix: '' })`. Both are
  memoized by the library and rebuilt on refresh; `onChange` publishes `tools/list_changed`.
- **`geocode_address`** (`src/tools/geocode-address.ts`, ported from
  `agent-tools/geocode-address.ts`: URL building, result formatting, a 30 s fetch to
  `https://data.geopf.fr/geocodage/search`) is an `openapi-mcp` `Tool` whose `execute`
  never throws. `withExtraTools(toolSet, profiles)` appends it when
  `extraTools.geocodeAddress.active` and the request's profile set intersects
  `extraTools.geocodeAddress.profiles` (default `['explore']`). It is never prefixed: it is
  not data-fair's.

## 2. Requests, site and identity

`src/site-fetch.ts` — the one place upstream calls are shaped:

```ts
siteFetch(siteOrigin: string, headers?: Record<string, string>): typeof fetch
```

- **Origin swap.** The request's URL origin (`mainSiteUrl`, the base every composed tool
  carries) is replaced by `siteOrigin`; paths are untouched, since every service of a site
  lives under one origin.
- **Headers set by the server:** `User-Agent: @data-fair/mcp`, `Referer: <siteOrigin>/mcp`
  (traffic classification, as today), `x-ignore-rate-limiting` from config. The caller's
  headers from the context are merged by the library before this fetch runs.
- **Dispatcher.** An undici `Agent` (`connections: 8`, `allowH2`, `headersTimeout` and
  `bodyTimeout` 30 s) composed with `interceptors.dns({ maxTTL: Infinity })`. With
  `upstreamProxyHost` set, the agent's `connect.lookup` resolves every hostname to that
  service, the URL scheme becomes `http:` and the request gains `X-Forwarded-Host: <host>`
  and `X-Forwarded-Proto: https` — the L2 nginx sees the same request the L1 proxy would
  hand it. `retry` is never used: a tool result carries the error to the agent.

`src/context.ts` — the adapter's context hook:

```ts
requestContext(req: Request): CallContext
```

- `siteOrigin = reqOrigin(req)` when the request carries forwarded headers, else
  `config.mainSiteUrl`.
- `fetch: siteFetch(siteOrigin)`.
- `headers`: `cookie`, `x-apikey` (from `x-apiKey` or `x-api-key`) when present, nothing
  else. `identity`: SHA-256 hex of the cookie or the key, undefined when neither.
- Profile gate (`mode: 'public'` only): the request's `?profiles=` (default `['explore']`)
  must be within `publicProfiles`; otherwise the route answers 403 before the handler runs.
  No header is trusted for this: in `internal` mode there is no gate because nothing
  outside the cluster can reach the deployment.

## 3. Surfaces

Express app as today: `createSiteMiddleware('mcp-server')`, `rateLimitingMiddleware`
(`public` mode only), CORS headers on the MCP routes, `errorHandler`.

The two modes serve the same routes from the same code:

| | `mode: 'public'` (`data-fair-mcp`) | `mode: 'internal'` (`data-fair-mcp-internal`) |
|---|---|---|
| Reachable | through the ingress at `/mcp-server/` | ClusterIP only, no ingress |
| Profiles | gated by `publicProfiles` | unrestricted |
| Rate limiting | per IP, as today | off |
| `/status` | internal requests only (`assertReqInternal`) | open |
| Registry listing | public profiles only | every profile |
| Typical extras | — | `upstreamProxyHost` |
| Consumers | external MCP clients, the compatibility alias | the agents service's autonomous runs |

| Route | Source | Notes |
|---|---|---|
| `POST /mcp` | `composer.compose(profiles)` + extra tools | `createMcpHttpHandler` from openapi-mcp with a request-dependent source; server info `datafair-mcp-server` / package version |
| `POST /datasets/mcp` | the alias composition + `geocode_address` | `?profiles=` ignored; server info `datafair-datasets-mcp-server` (kept) |
| `GET /v0/servers` | `composer.profiles()`, filtered by `publicProfiles` in `public` mode | `{ servers: [{ server: { name: 'fr.data-fair/<profile>', description, version, remotes: [{ type: 'streamable-http', url: '<site>/mcp-server/mcp?profiles=<name>' }] } }] }`; `Cache-Control: public, max-age=300` |
| `GET /status` | — | `composer.services`, last refresh time, extra tools active; `assertReqInternal` in `public` mode |

`GET`/`DELETE` on the MCP routes answer 405 as today (stateless). `/sse` and `/messages`
are gone.

Two small additions to `@data-fair/openapi-mcp` (0.2.1) make the table one handler:
`createMcpHttpHandler`'s `source` may be `(request) => ToolSource`, and
`composer.compose(profiles, { services?, namePrefix? })` restricts a composition to some
services and overrides the prefix. Both are library work, done first.

## 4. stdio

`TRANSPORT=stdio`: `PORTAL_URL` (required) is `mainSiteUrl`; `DATA_FAIR_API_KEY` becomes an
`x-apiKey` header on every upstream call; `PROFILES` (default `explore`); `LOCALE`. Served
through `serveStdio` with the composed set (`datafair_` prefixes) and `geocode_address`.
No `x-ignore-rate-limiting`, no forwarded headers, no profile gate (one process, one
caller).

## 5. Configuration

New keys (typed in `config/type/schema.json`, env in `custom-environment-variables.cjs`):
`mode` (`MODE`, `public` | `internal`, default `public`), `mainSiteUrl` (`MAIN_SITE_URL`;
stdio falls back to `portalUrl`), `indexPath` (`INDEX_PATH`),
`refreshInterval` (`REFRESH_INTERVAL`, seconds, default 300), `publicProfiles`
(`PUBLIC_PROFILES`, comma list, default `explore`), `upstreamProxyHost`
(`UPSTREAM_PROXY_HOST`), `extraTools.geocodeAddress.active` / `.profiles`
(`EXTRA_TOOLS_GEOCODE_ADDRESS_ACTIVE`, `EXTRA_TOOLS_GEOCODE_ADDRESS_PROFILES`).

Kept: `portalUrl`, `dataFairAPIKey`, `ignoreRateLimiting`, `locale`, `defaultLimits`,
`observer`, `port`, `transport`.

Dependencies: `+ @data-fair/openapi-mcp ^0.2.1`, `+ @modelcontextprotocol/server ^2`,
`+ @modelcontextprotocol/node ^2`, `+ undici ^7`; `- @modelcontextprotocol/sdk`,
`- @data-fair/agent-tools-data-fair`, `- zod`, `- csv-stringify`. Dev:
`+ @modelcontextprotocol/client ^2`.

## 6. Testing

`node --test`, as today, no network beyond `127.0.0.1`:

- **A fake site**: one `http.Server` serving `/data-fair/api/v1/agents/index.json`, the
  annotated data-fair document (a frozen copy of what the data-fair branch generates,
  `test/fixtures/data-fair-api-docs.json`, with `servers[0].url` rewritten to the fake
  site), and canned dataset responses that echo the request's host, cookies and
  `x-forwarded-*` headers — so every assertion below reads what actually reached the API.
- Composition: the tool names of `/mcp` (`datafair_*` + `geocode_address`), of the alias
  (seven unprefixed), `tools/list_changed` after a document change and `refresh()`.
- Site and identity: a request with `X-Forwarded-Host: portal.test` calls
  `portal.test`'s paths; one without keeps the main site; `cookie` and `x-apikey` reach the
  API; `x-ignore-rate-limiting` and `Referer` are set.
- Modes: in `public` mode a non-public profile gets 403 whatever the headers, the limiter is
  active and `/status` refuses a proxied request; in `internal` mode all three are open.
- `upstreamProxyHost`: a second local server receives the request with
  `Host: portal.test`, `X-Forwarded-Host`, `X-Forwarded-Proto: https`.
- `geocode_address`: `buildUrl` and `formatResult` ported with their existing behaviours
  (minimum length, limit clamp, empty result text); `active: false` removes it.
- Registry listing shape; `/status` internal-only.
- stdio through `StdioClientTransport` against the fake site.

Evals: `openapi-mcp`'s arm A points at this checkout. After v2, A is the composed set; the
`0.7.6` tag is the last hand-written baseline, run once against v2 to close the loop.

## 7. Rollout

CI builds `ghcr.io/data-fair/mcp:feat-openapi-mcp` on push. In `env-staging3`:

- `data-fair-mcp-next` (`MODE=public`) on that tag with `MAIN_SITE_URL` and the existing
  `ignore-rate-limiting` secret, routed at `/mcp-server-next/` in the L2 nginx configmap and
  the ingress; validated with the MCP inspector (both eras), a Claude Desktop configuration
  on the alias, and arm A of the evals against staging; then the routes swap, the branch
  merges and `keel` on `:main` deploys it as `data-fair-mcp`.
- `data-fair-mcp-internal` (`MODE=internal`, `UPSTREAM_PROXY_HOST=haproxy1-nginx`), a
  Deployment and a ClusterIP Service only, created when the agents service is ready to
  consume it; its URL is the agents service's registry setting.

The manifests are their own step.

## Non-goals

- Per-site composers, private-URL indexes, an `edit` profile, editor tool groups.
- Serving public and internal callers from one deployment, or trusting a header to tell
  them apart.
- Serving skills beyond what the library does (the extension is served by the adapter).
- Any credential of its own beyond `DATA_FAIR_API_KEY` in stdio mode.
- Replacing the evals harness here: `openapi-mcp`'s is the one.

## Layout

```
index.ts                     transport switch (unchanged shape)
src/app.ts                   routes: /mcp, /datasets/mcp, /v0/servers, /status
src/server.ts                unchanged
src/rate-limiting.ts         unchanged
src/composition.ts           the composer, refresh, extra tools, alias composition
src/site-fetch.ts            origin swap, dispatcher, server headers, optional local proxy
src/context.ts               request → CallContext, profile gate
src/registry.ts              the /v0/servers document
src/tools/geocode-address.ts the IGN tool
test/                        fixtures/ (fake site), *.test.ts
config/                      new keys
```
