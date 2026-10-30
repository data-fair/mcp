# MCP OAuth discovery and bearer rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/mcp` accepts bearer tokens only when they carry the MCP audience and an NHI subject, answers 401 with an RFC 9728 `WWW-Authenticate` pointer, and serves protected-resource metadata naming the site's SD issuer on issuer sites.

**Architecture:** lib-express's `audiences` option does the audience check; `src/scopes.ts` adds the NHI rule and the 401 header; a new `src/oauth-discovery.ts` probes SD's discovery per site (cached) and builds the metadata document; `src/app.ts` mounts the metadata route and passes the discovery to the credentials middleware.

**Tech Stack:** Node 24 TypeScript (no build), Express 5, lib-express 1.34 session, node:test.

**Spec:** `docs/superpowers/specs/2026-10-21-mcp-oauth-discovery-design.md`

## Global Constraints

- MCP mount is the constant `/mcp-server`; MCP audience is `<siteUrl>/mcp-server`.
- Cookie sessions of any subject stay accepted on `/mcp`; API keys unchanged.
- Metadata URL: `<siteOrigin>/mcp-server/.well-known/oauth-protected-resource/mcp` (app route `/.well-known/oauth-protected-resource/mcp`); `resource`: `<siteOrigin>/mcp-server/mcp`.
- Issuer site = SD discovery `GET <siteOrigin>/simple-directory/.well-known/oauth-authorization-server` answers 200 with `issuer`, `authorization_endpoint`, and (`registration_endpoint` or `client_id_metadata_document_supported: true`).
- Requests on a site with a path prefix (`reqSitePathSafe(req) !== ''`) get no OAuth discovery.
- `/datasets/mcp` never answers 401 nor sends `WWW-Authenticate`.
- Commits: conventional commits, header ≤ 100 chars, ending with the `Co-Authored-By` line.
- `npm run quality` green at the end of every task.

## Review Focus

1. A slow or hanging SD discovery must not hang the 401: the probe has its own timeout (3 s) and a timeout is a negative answer — Task 2 test.
2. Concurrent cold lookups for one site make one request (the cache holds the promise) — Task 2 test.
3. Browser MCP clients must read the header: `WWW-Authenticate` is in `Access-Control-Expose-Headers`, and the metadata route answers `Access-Control-Allow-Origin: *` — Task 3 test.
4. A failing bearer next to a valid cookie is a 401 `invalid_token`, not a cookie session — Task 1 test.
5. A platform document change updates `scopes_supported` without restart — Task 3 test.

---

### Task 1: MCP audience and NHI-only bearers

**Files:**
- Modify: `src/server.ts` (`session.init` options), `src/scopes.ts`, `test/tokens.ts`
- Test: `src/scopes.test.ts`, `src/app.test.ts`, `src/server.test.ts` (wherever `session.init` is called in tests, use the same options)

**Interfaces:**
- Produces: `export const MCP_PATH = '/mcp-server'` and `export const sessionOptions = { scopeAware: true, audiences: (siteUrl: string) => [siteUrl + MCP_PATH] }` in `src/scopes.ts`; `server.ts` and every test call `session.init(dir, undefined, undefined, sessionOptions)`.
- Produces: `credentials()` unchanged signature for now; on a bearer whose verified state has no `user.nhi`, it fails like a bad token (`httpError(401, 'invalid token')`).
- Produces in `test/tokens.ts`: `nhiClaims(scope, site, aud = [site + '/mcp-server', site])` (aud default changes from `site` to the SD MCP pair); `userClaims(scope, aud)` — same as `nhiClaims` without `nhi`.

- [ ] **Step 1: Tests in `src/scopes.test.ts`**
  - `reads the scopes of an NHI bearer with the MCP audience` — `nhiClaims('datasets:read', 'https://portal.test')` → scopes `['datasets:read']` (replaces "bearer addressed to the site").
  - `refuses an NHI bearer with the site audience only` — `nhiClaims('datasets:read', 'https://portal.test', 'https://portal.test')` on `/required` → 401.
  - `refuses a user bearer with the MCP audience` — `userClaims('datasets:read', ['https://portal.test/mcp-server', 'https://portal.test'])` → 401.
  - `judges a request on its bearer, not its cookie` — valid `cookieFor(USER)` + site-audience-only NHI bearer → 401.
  - `drops a site-audience bearer on the optional route` — `/optional` → 200, `authorization: null`, scopes null.
  - In-cluster test (no forwarded headers): bearer `nhiClaims(..., site.origin)` still accepted.
- [ ] **Step 2: Run `node --test src/scopes.test.ts`** — expect the new refusals to FAIL (200 instead of 401).
- [ ] **Step 3: Implement** `MCP_PATH`, `sessionOptions`, the NHI check (bearer only: `/^bearer/i` on the authorization header and `!state.user.nhi`), wire `sessionOptions` in `server.ts` and tests.
- [ ] **Step 4: Update `src/app.test.ts`** — the `/mcp` and `/datasets/mcp` bearer tests keep passing with the new `nhiClaims` default; add `serves the datasets server anonymously to a dashboard bearer` (`userClaims('datasets:read', 'https://portal.test')` → `DATASETS_NAMES`).
- [ ] **Step 5: `npm run quality`** — PASS.
- [ ] **Step 6: Commit** `feat!: bearer tokens on the mcp need the mcp audience and an nhi subject`

### Task 2: Issuer discovery and metadata document

**Files:**
- Create: `src/oauth-discovery.ts`, `src/oauth-discovery.test.ts`
- Modify: `test/fake-site.ts` (SD discovery route + `setDiscovery`)

**Interfaces:**
- Consumes: `siteFetch(siteOrigin, { mainSiteUrl, dispatcher, trustedForwarder })` from `src/site-fetch.ts`.
- Produces:
  - `createIssuerLookup(options: { mainSiteUrl: string, dispatcher: SiteDispatcher, trustedForwarder?: string, timeoutMs?: number /* 3000 */, ttlMs?: { found: number /* 600_000 */, missing: number /* 60_000 */ } }): (siteOrigin: string) => Promise<string | undefined>` — the SD `issuer`, or undefined when the site is not an issuer site (non-200, invalid JSON, criteria unmet, timeout, network error; errors logged with `console.warn`). Caches the promise per origin.
  - `scopesSupported(toolSet: ToolSet): string[]` — sorted union of every `oauth2` scope in `tool.security`.
  - `protectedResourceMetadata(o: { siteOrigin: string, issuer: string, scopes: string[] }): object` — the spec's document: `resource`, `authorization_servers: [issuer]`, `scopes_supported`, `bearer_methods_supported: ['header']`, `resource_name: 'Data Fair (<host>)'`.
  - `resourceMetadataUrl(siteOrigin: string): string`.
- Fake site: `setDiscovery(doc: object | number | 'hang' | undefined)` — object → 200 JSON (default: `{ issuer: origin + '/simple-directory', authorization_endpoint, registration_endpoint, client_id_metadata_document_supported: true }`), number → that status, `'hang'` → never answers, undefined → 404.

- [ ] **Step 1: Tests** — `issuer site → SD's issuer`; `404 → undefined`; `no authorization_endpoint → undefined`; `no registration_endpoint but client_id_metadata_document_supported → issuer`; `neither → undefined`; `hang → undefined within timeoutMs (use 200)`; `two concurrent cold lookups → one discovery hit`; `found answer cached (second call no hit)`; `missing answer expires after ttl.missing (use 50 ms)`; `the probe carries the site's forwarded host` (hit headers `x-forwarded-host`); `scopesSupported` on the fixture contains `datasets:read` and has no duplicates; `protectedResourceMetadata` exact object.
- [ ] **Step 2: Run** — FAIL (module missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test src/oauth-discovery.test.ts` — PASS; `npm run quality` — PASS.
- [ ] **Step 5: Commit** `feat: sd issuer lookup and protected resource metadata`

### Task 3: 401 header and metadata route

**Files:**
- Modify: `src/scopes.ts`, `src/app.ts`, `src/server.ts` (build the lookup once, pass it to `createApp`)
- Test: `src/app.test.ts`, `src/scopes.test.ts`

**Interfaces:**
- Consumes: Task 2's lookup, `scopesSupported`, `protectedResourceMetadata`, `resourceMetadataUrl`.
- Produces: `credentials(options: { required: boolean, mainSiteUrl: string, resourceMetadata?: (req: express.Request) => Promise<string | undefined> })`. On `required` 401s it sets `WWW-Authenticate`: `Bearer` + `error="invalid_token"` for a failing bearer + `resource_metadata="<url>"` when the callback gives one. A failing cookie and missing credentials get no `error`. Non-401 errors are rethrown untouched.
- `createApp(platform, dispatcher, issuerOf)`; the callback in `app.ts` returns undefined when `reqSitePathSafe(req)` is non-empty, else `resourceMetadataUrl(siteOrigin)` if `issuerOf(siteOrigin)` resolves.
- Route `GET /.well-known/oauth-protected-resource/mcp`: same path-prefix and issuer rules, 404 otherwise; `Access-Control-Allow-Origin: *`; `cacheable(res)`; body from `scopesSupported(platform.platform(undefined))`.
- `cors` adds `WWW-Authenticate` to `Access-Control-Expose-Headers`.

- [ ] **Step 1: Tests (app.test.ts, fake site as SD)**
  - no credentials on `/mcp`, issuer site → 401, header `Bearer resource_metadata="https://portal.test/mcp-server/.well-known/oauth-protected-resource/mcp"`, `access-control-expose-headers` includes `WWW-Authenticate`.
  - same with `setDiscovery(undefined)` → 401, header exactly `Bearer`.
  - site-audience NHI bearer → header starts `Bearer error="invalid_token"` and has `resource_metadata`.
  - expired cookie → 401 without `error`.
  - with `x-forwarded-path` making a site path (check how `createSiteMiddleware` reads it) → header exactly `Bearer`.
  - `/datasets/mcp` with a bad bearer → 200, no `www-authenticate`.
  - metadata route on issuer site → 200, the document with `authorization_servers: [site.origin + '/simple-directory']`, CORS `*`; non-issuer → 404.
  - after `site.setDoc` removes every tool with `datasets:read` and `platform.refresh()`, `scopes_supported` lacks `datasets:read`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm run quality`** — PASS.
- [ ] **Step 5: Commit** `feat: oauth discovery for mcp clients, www-authenticate on 401`

### Task 4: Docs

**Files:** `README.md`, `AGENTS.md`, `live-test/*` if they describe `/mcp` authentication.

- [ ] **Step 1:** AGENTS.md key patterns: bearer rule (MCP audience + NHI; cookies any subject), OAuth discovery only on issuer sites without path prefix, `src/oauth-discovery.ts` in Layout. README: how to connect Claude Code (`claude mcp add --transport http datafair https://<issuer site>/mcp-server/mcp`), non-issuer sites use API keys.
- [ ] **Step 2:** `npm run quality` — PASS. Commit `docs: oauth access to the platform server`.

### Task 5: SD docs (simple-directory master) — ask the user before committing

- [ ] **Step 1:** In `/home/alban/data-fair/simple-directory` (master), edit `docs/superpowers/plans/2026-10-16-platform-authz-roadmap.md` line 39 bullet and the 6a row, and spec section 13 mcp bullets, per the spec's "SD docs" section; 6a row status: "mcp part done on mcp branch feat-openapi-mcp (not merged)".
- [ ] **Step 2:** Show the diff to the user; commit only on their go-ahead.
