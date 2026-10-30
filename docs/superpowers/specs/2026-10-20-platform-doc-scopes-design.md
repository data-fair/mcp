# The MCP server over the platform document, tools filtered by scopes (phase 3, mcp half)

Roadmap: `simple-directory/docs/superpowers/plans/2026-10-16-platform-authz-roadmap.md`, phase 3
("Profiles are dropped entirely", rows 3, 4a, 6a). The data-fair + openapi-mcp half:
`data-fair_feat-autonomous-agents/docs/architecture/platform-api-docs.md` and its spec
`docs/superpowers/specs/2026-10-19-platform-api-docs-design.md`. Library: `@data-fair/openapi-mcp`
0.7.0 (README, `docs/x-agent.md`, `docs/editor-tool-groups.md`).

Branch: `feat-openapi-mcp` (this repo), continued.

## Intent

The platform has one authorization model (OAuth scopes) and one agent-facing description of
itself: the merged platform OpenAPI document that data-fair serves at
`GET /data-fair/api/v1/platform/api-docs.json`. openapi-mcp 0.7.0 is now "one document in, one
tool set out", with `toolsForScopes` to keep what a token can call. This server follows the same
simplification: it loads that one document, serves it as one large authenticated server whose
tool list is cut by the caller's scopes, and keeps the historic `datasets` server for exploring a
portal's published catalog.

This branch went through an earlier iteration (agent index, openapi-mcp composer, profiles). That
iteration was never released and is a draft inside the same piece of work: **no compatibility
with anything of this branch is kept**. The only contracts are what `main` (0.7.6) released:

- `/mcp-server/datasets/mcp` with its seven tool names;
- the stdio Docker image (`PORTAL_URL`, `DATA_FAIR_API_KEY`) serving those same seven names.

Everything temporary on this branch goes: profiles in every form, the composer, the agent index,
`/profiles`, `/v0/servers`, `?profiles=`, `PROFILES`, `indexPath`,
`extraTools.geocodeAddress.profiles`, the agent-index fixture.

## Goals

- `/mcp`: the **platform server**. Every tool of the merged document, plus `geocode_address`,
  filtered per request by the caller's scopes. Always authenticated.
- `/datasets/mcp`: the **datasets server**. Not deprecated: the server for exploring a portal's
  published data catalog, anonymously or with credentials, under its seven released names.
- `/ai-catalog.json` (the ingress maps `/.well-known/ai-catalog.json` here): auto-discovery, kept
  as the conventional way agents (ours and others, during web exploration) find MCP servers.
- stdio: the datasets server by default (the released contract), the platform server on demand.
- The document is kept current in process: periodic conditional reload, skill bodies cached,
  MCP clients notified on change.
- Code is shorter and plainer than the composer version it replaces.

## Non-goals

- **OAuth for MCP clients (6a)**: protected resource metadata, `WWW-Authenticate` with
  `resource_metadata`, refusing non-NHI tokens, MCP-audience tokens. This phase only makes `/mcp`
  require credentials and read scopes; 6a adds the OAuth discovery on top of the same code.
- **The agents service (4a)**: it reads `/mcp-server/profiles` and sends `?profiles=`; both go
  here. **Accepted breakage** until 4a moves it to "connect to `/mcp` with the NHI's scoped token"
  (same as the platform doc spec's accepted breakage for the index).
- **Per-site documents.** The merged document is identical across sites except for its origin
  (server URL, `tokenUrl`, skill `href`s). It is loaded once from the main site; calls follow the
  caller's site through the existing origin swap (`siteFetch`, `linksOnSite`), unchanged.
- **Rate limiting**: unchanged (only the geocoder is limited here; data-fair limits tool calls).
- Changing which operations are tools, or any tool's name/description/schema: that is data-fair's
  `x-agent` annotations.

## Anti-goals

- A tool offered to a token that cannot call it (the reason scopes filter the list at all).
- Trusting a scope set the server did not verify (a forged token must not choose its tool list,
  even though data-fair would refuse its calls).
- A second vocabulary of tool selection creeping back (profiles under another name, a marker in
  `x-agent`). The datasets server is a fixed list in this repo, named as what it is.
- Keeping dead code or config for the earlier iteration "in case".

## Shape

```
main site ── GET /data-fair/api/v1/platform/api-docs.json (conditional, every refreshInterval)
                │
          live document (src/live-document.ts) ── load(doc, { lint: 'warn', … }) ── ToolSet
                │                                                           │
    platform set = toolSet + geocode_address                 datasets set = 6 renamed tools
                │                                              + geocode_address
     /mcp  (credentials required)                         /datasets/mcp (anonymous ok)
     toolsForScopes(platform, scopes)                     toolsForScopes(datasets, scopes)
                └──────────── onChange → handler.notify.toolsChanged/resourcesChanged ────┘
```

### The live document (moved from openapi-mcp)

`createLiveDocument` from openapi-mcp `582ab70:src/live.ts` moves to `src/live-document.ts`, with
its test (`582ab70:test/live.test.ts`) adapted to this repo's fixtures. It keeps its behaviour:
conditional GET of the document (`If-None-Match` / `If-Modified-Since`), linked skill bodies
fetched once and revalidated, rebuild only on change (fingerprint of `toolSetSnapshot` +
instructions), last good tool set kept on failure with `error` set, overlapping refreshes shared,
first load throws. It is adapted to the 0.7.0 API (`load` options, `ToolSet` = tools, skills,
guides; whatever fields the fingerprint read that no longer exist are replaced by their 0.7.0
equivalents).

This server owns the timer: every `refreshInterval` seconds (config, kept, default 300) it calls
`refresh()`; on change both HTTP handlers call `notify.toolsChanged()` and
`notify.resourcesChanged()`, and the stdio server sends `tools/list_changed`.

Load options: `fetch` = `siteFetch` on the main site (as today), `locale`, `lint: 'warn'` (the
platform doc says a consumer that must survive a misbehaving service loads with `warn`),
`structuredContent: true` (agents service code mode), `files` (as today), `prepareEditorSchema`
(below). Output schemas are stripped as today (README "Structured results").

A failing first load fails startup, as the composer did.

### The platform server: `/mcp`

- **Credentials required.** A request with no cookie session, no `x-apikey`/`x-api-key` and no
  `Authorization: Bearer` gets `401` before the MCP handler. A cookie or bearer that does not
  verify (bad signature, expired, wrong audience) is also `401`. An API key is only checked for
  presence (designer's call): lib-express does not read API keys, a key carries no scopes until
  4b, so a bad key is shown the same tool list the public document already describes, and
  data-fair refuses its every call. Verifying keys comes with 4b, when they carry scopes.
- **Forwarded credentials.** `requestContext` forwards the cookie and the API key as today and
  now also `Authorization` (the agents service in 4a and API clients send `at+jwt` bearers).
- **Scopes.** Read from the caller's session through `@data-fair/lib-express` `session`
  (verified against simple-directory's JWKS, the same code every service runs), initialized
  `scopeAware: true` with the default audience rule (the site origin the request came through).
  `sessionState.scopes` is passed to `toolsForScopes`. A request without forwarded headers (an
  in-cluster caller, e.g. the agents service acting on no site) is read with the main site as its
  site, so a bearer addressed to the main site verifies: the server supplies the main site's
  forwarded host/proto to the session read when the request has none (designer's call; no lib
  change). Callers acting on a site already send `x-forwarded-host` (agents
  `forwardedSiteHeaders`). An unscoped session (a user cookie, an
  unscoped NHI) and an API key (data-fair API keys are not on the scope taxonomy until 4b) give
  `undefined`: every tool. The server never decodes a JWT itself.
- `geocode_address` is part of the platform set (it carries no security in the openapi-mcp sense:
  it is added after `toolsForScopes`, so every authenticated caller has it).
- Server info name: `datafair-mcp-server`.

### The datasets server: `/datasets/mcp`

A fixed map in `src/datasets-server.ts`, documented as the datasets server's contract:

| Tool name | Platform tool |
| --- | --- |
| `list_datasets` | `datafair_list_datasets` |
| `describe_dataset` | `datafair_describe_dataset` |
| `search_data` | `datafair_search_data` |
| `get_field_values` | `datafair_get_field_values` |
| `aggregate_data` | `datafair_aggregate_data` |
| `calculate_metric` | `datafair_calculate_metric` |
| `geocode_address` | the hand-written tool |

- Built from the live tool set on every change: the six tools are taken by platform name and
  renamed; schemas, descriptions and annotations stay data-fair's. A mapped tool missing from the
  document is left out with a warning (logged, and visible in `/status`), never invented.
- Why a fixed list and not scopes: in the merged document `datafair_list_datasets` and
  `datafair_list_account_datasets` carry identical security; no scope set separates the published
  catalog from account data. The list is the selection.
- Anonymous allowed. With credentials, they are forwarded like on `/mcp` and the scopes filter
  the six tools the same way (a token without `datasets:*` sees `geocode_address` only).
- A cookie or bearer that does not verify (expired cookie a browser still sends, bad token) is
  not an error here: the request is served as anonymous and that credential is **not forwarded**
  (designer's call; the released server ignored credentials, and must keep working for them).
- Server info name: `datafair-datasets-mcp-server` (released).
- Skills and guides: only those whose tools are all in the set, with tool names rewritten to the
  datasets names in their tool lists. Skill/guide *texts* naming `datafair_…` tools are not
  rewritten (the released 0.x server had no skills; accepted).

### Discovery: `/ai-catalog.json`

Kept, with one entry: the datasets server's MCP Server Card (`fr.data-fair/datasets`,
`${siteOrigin}/mcp-server/datasets/mcp`, embedded). The agents service's web access only reports
anonymous endpoints, and a card cannot yet say "OAuth required"; the platform server joins the
catalog in 6a, once it publishes its protected resource metadata. Same cache headers and CORS as
today.

### stdio

- `MCP_SERVER=datasets` (default, the released contract) or `platform`.
- Credentials as today: `DATA_FAIR_API_KEY`, or a forward proxy injecting a session
  (nhi-proxy: `HTTPS_PROXY` + `NODE_EXTRA_CA_CERTS`). The server never sees a proxy-injected
  token, so at startup it asks the platform who it is: `GET <PORTAL_URL>/simple-directory/api/auth/my-session`
  through the same dispatcher (any-scope route in simple-directory). Its `scopes` filter the tool
  set for the life of the process. With `DATA_FAIR_API_KEY`, scopes are `undefined` (unscoped
  until 4b) and the session call is skipped.
- `MCP_SERVER=platform` with no session and no API key exits at startup with a clear message
  (the platform server is always authenticated).
- Tool names: platform names (`datafair_…`) for `platform`, the seven names for `datasets`.

### Editor groups: data-fair's form-schema preparation (moved from openapi-mcp)

`a20b7d6^:src/editor/prepare-schema.ts` moves to `src/editor-schema.ts` and is passed as
`prepareEditorSchema`: `v2compat` from `@json-layout/core`, string `layout` → `{ comp }`,
attachment and extension columns hidden. `@json-layout/agents` (and `@json-layout/core`) become
dependencies of this server so an `x-agent.editor` annotation works when data-fair adds one.
No operation of the merged document carries `editor` today: the preparation is covered by a unit
test on a dataset-like schema, not by the fixture.

### HTTP routes after the change

| Route | |
| --- | --- |
| `POST/GET/DELETE /mcp` | platform server, credentials required, CORS as today (+ `Authorization` in allowed headers) |
| `POST/GET/DELETE /datasets/mcp` | datasets server |
| `GET /ai-catalog.json` | discovery |
| `GET /status` | internal: main site, `x-platform.services` of the last document, live document `error`, last refresh, missing datasets tools, extra tools |

Removed: `/profiles`, `/v0/servers`, `?profiles=` handling, the unknown-profile 400.

### Config

- Removed: `indexPath`, `extraTools.geocodeAddress.profiles` (and its list normalization),
  `PROFILES`.
- Added: `docPath` (default `/data-fair/api/v1/platform/api-docs.json`, env `DOC_PATH`);
  `privateDirectoryUrl` (default `http://simple-directory:8080`, env `PRIVATE_DIRECTORY_URL`) for
  the session JWKS in http mode; `MCP_SERVER` for stdio (`mcpServer`, enum `datasets|platform`).
- Kept: everything else (`refreshInterval`, `files`, `trustedForwarder`, `upstreamProxyHost`,
  geocoder `active` and `limits`…).

### Files

- `src/live-document.ts` (moved), `src/editor-schema.ts` (moved), `src/datasets-server.ts`,
  `src/scopes.ts` (request → verified scopes / 401; stdio's `my-session` read),
  `src/platform.ts` replaces `src/composition.ts` (live document + timer + the two sets + change
  listeners), `src/ai-catalog.ts` replaces `src/registry.ts`.
- `test/fake-site.ts` serves the merged document instead of the index; fixtures regenerated from
  data-fair's generator for the merged doc (`scripts/refresh-fixtures.ts` updated); the index
  fixture removed.
- `live-test/`: `PROFILES` → `MCP_SERVER=platform`, docs updated.
- README, AGENTS.md rewritten for the three routes, scopes, stdio modes. Older specs and plans in
  `docs/superpowers/` stay as history.

### Dependencies

`@data-fair/openapi-mcp` ^0.7.0; `@data-fair/lib-express` and `@data-fair/lib-node` at the
versions with bearer `at+jwt` support and the audience check (lib-express ≥ 1.33, lib-node ≥ 2.17);
`@json-layout/agents`, `@json-layout/core`.

## Tests

- **live document**: the moved suite (304 keeps the set, failing refresh keeps the last good one,
  skill bodies revalidated, change → listeners), on this repo's fixtures.
- **platform server** (fake site + real MCP client): 401 without credentials; with an unscoped
  cookie session every tool + `geocode_address`; with a `datasets:read` bearer no write/admin
  tools; `datasets:write` reaches `update_dataset` and not `publish_dataset`; credentials
  (cookie, API key, bearer, client IP) reach the site; `tools/list_changed` after a document
  change. Tokens signed by a test JWKS the fake site serves as simple-directory.
- **datasets server**: the seven names anonymously; a scoped token without `datasets:*` gets only
  `geocode_address`; a mapped tool removed from the document is dropped with a warning.
- **stdio**: default datasets names; `MCP_SERVER=platform` filtered by the scopes `my-session`
  returns; refuses to start without credentials.
- **ai-catalog**: one datasets card on the requesting site.
- **editor schema**: the three preparation steps.
- Existing site/origin, geocoder, config tests kept and adapted.

## Calls made by the designer (check these)

- The datasets server is a fixed rename map in this repo, built from the platform tool set; also
  filtered by scopes when credentials come.
- `/mcp` returns 401 to callers without credentials already in phase 3.
- Scopes are read by verifying the session with lib-express against simple-directory, never by
  decoding the JWT locally.
- `geocode_address` is in both servers and not scope-filtered.
- ai-catalog lists only the datasets server until 6a.
- `/v0/servers` is removed (ai-catalog is the discovery).
- stdio picks its server with `MCP_SERVER` (default `datasets`) and learns its scopes once at
  startup from simple-directory's `my-session`.
- Skills/guides on the datasets server: only those fully covered by its tools (unbound skills such
  as `datafair-workflow` included), texts not rewritten.
- API keys on `/mcp` checked for presence only until 4b.
- In-cluster requests without forwarded headers are read with the main site as audience.
- On `/datasets/mcp` an unverifiable cookie/bearer degrades to anonymous and is not forwarded.
- `lint: 'warn'` for the merged document.
- Editor-group preparation and `@json-layout/*` dependencies land now, though no operation uses
  `editor` yet.
