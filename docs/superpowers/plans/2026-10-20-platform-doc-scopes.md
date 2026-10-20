# Platform document and scope filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the merged platform OpenAPI document as one authenticated MCP server filtered by the caller's token scopes (`/mcp`), keep the released `datasets` server (`/datasets/mcp`, seven names) and `ai-catalog.json`, and remove every trace of profiles and the agent index.

**Architecture:** One live document (moved from openapi-mcp) loads `/data-fair/api/v1/platform/api-docs.json` from the main site and reloads it on a timer. Two tool sets are derived from it: the platform set (all tools + `geocode_address`) and the datasets set (six renamed tools + `geocode_address`). An Express middleware verifies the caller's session with lib-express `session` and hands its scopes to the MCP handler through an internal header; `toolsForScopes` cuts each set per request.

**Tech Stack:** Node 24 (TypeScript run directly), Express 5, `@data-fair/openapi-mcp` ^0.7.0, `@data-fair/lib-express` ^1.34.0 / `@data-fair/lib-node` ^2.17.1 (bearer `at+jwt`, audience check), `@modelcontextprotocol/server` 2, `@json-layout/agents` / `@json-layout/core`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-20-platform-doc-scopes-design.md`

## Global Constraints

- No compatibility with anything of this branch; only `main` 0.7.6's contracts: `/mcp-server/datasets/mcp` with `list_datasets`, `describe_dataset`, `search_data`, `get_field_values`, `aggregate_data`, `calculate_metric`, `geocode_address`; stdio with `PORTAL_URL` / `DATA_FAIR_API_KEY` serving those names by default.
- Removed everywhere: profiles, `?profiles=`, `/profiles`, `/v0/servers`, `PROFILES`, `indexPath`, `extraTools.geocodeAddress.profiles`, the composer, the agent index fixture.
- Document path default `/data-fair/api/v1/platform/api-docs.json` (`DOC_PATH`); `privateDirectoryUrl` default `http://simple-directory:8080` (`PRIVATE_DIRECTORY_URL`); `mcpServer` enum `datasets|platform`, default `datasets` (`MCP_SERVER`); `refreshInterval` default 300 s kept.
- `load` options: `lint: 'warn'`, `structuredContent: true`, `locale`, `files`, `prepareEditorSchema`; output schemas stripped from every tool.
- Server info names: `datafair-mcp-server` (`/mcp`), `datafair-datasets-mcp-server` (`/datasets/mcp`).
- The server never decodes a JWT itself; scopes come from lib-express `session` (`scopeAware: true`) or, in stdio, from `<PORTAL_URL>/simple-directory/api/auth/my-session`.
- `geocode_address` is appended after `toolsForScopes` in both sets (it carries no security, `toolsForScopes` would drop it).
- Tasks 1–3 run only their own test files; the old composition/app/server/stdio suites are red from Task 1 until Tasks 4–7 replace them. `npm run quality` must pass at the end of Task 7 and Task 8.
- Comments and docs describe what the code does now, not this branch's history.

## Review Focus

1. An expired or forged `id_token` cookie on `/datasets/mcp` (a browser on the same domain sends it): served anonymously, and the cookie is not forwarded upstream — test in Task 5.
2. A client sending its own `x-mcp-scopes` header to widen or narrow its list: always stripped before the session read — test in Task 5.
3. A bearer from an in-cluster caller (no forwarded headers) addressed to the main site verifies; one addressed to another site is 401 — test in Task 5.
4. The platform document failing to reload (5xx, invalid JSON) after a good start: tools stay, `/status` shows the error — test in Task 4.
5. simple-directory's JWKS unreachable: `/mcp` answers an error (not 401, not every tool); `/datasets/mcp` degrades to anonymous — test in Task 5.

---

### Task 1: Dependencies, config, fixtures and the fake site

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `config/default.cjs`, `config/custom-environment-variables.cjs`, `config/test.cjs`, `config/development.cjs` (drop removed keys if present), `config/type/schema.json`, `config/type/index.ts` (regenerated)
- Modify: `src/config.ts`, `src/config.test.ts`
- Modify: `scripts/refresh-fixtures.ts`
- Create: `test/fixtures/platform-api-docs.json`; Delete: `test/fixtures/data-fair-agents-index.json`, `test/fixtures/data-fair-api-docs.json`
- Create: `test/tokens.ts`
- Modify: `test/fake-site.ts`

**Interfaces:**
- Produces: `ApiConfig` with `docPath: string`, `privateDirectoryUrl: string`, `mcpServer: 'datasets' | 'platform'`, no `indexPath`, `extraTools.geocodeAddress` = `{ active, limits }`.
- Produces (`test/tokens.ts`): `jwks(): { session: object, scoped: object }` (JWK sets with `kid` `sd-1` / `scoped-sd-1`); `cookieFor(payload: object): string` (`id_token=<h>.<p>; id_token_sign=<s>`, signed with the session key, `kid: 'sd-1'`); `bearerFor(payload: object): string` (signed with the scoped key, `kid: 'scoped-sd-1'`, header `typ: 'at+jwt'`); `nhiClaims(scope: string, aud: string): object` (single org, `nhi: 1`, `iss`, `client_id`, `jti`, `aud`, `scope`); `USER: object` (unscoped user claims).
- Produces (`test/fake-site.ts`): `FakeSite` gains `setSession(state: object | undefined): void` (what `/simple-directory/api/auth/my-session` answers, default `{}`) and `failDoc(status: number | undefined): void`; it serves `/data-fair/api/v1/platform/api-docs.json` (ETag, 304, `http://fixture.test` replaced by its origin everywhere in the document), `/simple-directory/.well-known/jwks.json`, `/simple-directory/.well-known/scoped-jwks.json`, the skill files, and the existing canned dataset routes. `setDoc(patch)` patches the platform document.

- [ ] **Step 1: Bump dependencies**

Run: `npm install @data-fair/openapi-mcp@^0.7.0 @data-fair/lib-express@^1.34.0 @data-fair/lib-node@^2.17.1 @json-layout/agents @json-layout/core && npm install -D jsonwebtoken @types/jsonwebtoken`
Expected: `package.json` lists them; `npm ls @data-fair/openapi-mcp` shows 0.7.x.

- [ ] **Step 2: Write the failing config test**

In `src/config.test.ts`, replace the profile-list cases with:

```ts
it('defaults to the platform document, the in-cluster directory and the datasets server', () => {
  assert.equal(config.docPath, '/data-fair/api/v1/platform/api-docs.json')
  assert.equal(config.privateDirectoryUrl, 'http://simple-directory:8080')
  assert.equal(config.mcpServer, 'datasets')
  assert.equal((config as any).indexPath, undefined)
  assert.equal((config.extraTools.geocodeAddress as any).profiles, undefined)
})
it('still splits FILE_URL_PREFIXES', () => {
  assert.deepEqual(normalizeLists({ files: { urlPrefixes: 'https://a/, https://b/' } }).files.urlPrefixes, ['https://a/', 'https://b/'])
})
```

- [ ] **Step 3: Run it**

Run: `NODE_ENV=test node --test src/config.test.ts`
Expected: FAIL on `docPath`.

- [ ] **Step 4: Change the config**

`default.cjs`: remove `indexPath` and `geocodeAddress.profiles`, add `docPath`, `privateDirectoryUrl`, `mcpServer` with the Global Constraints defaults. `custom-environment-variables.cjs`: `DOC_PATH`, `PRIVATE_DIRECTORY_URL`, `MCP_SERVER`; remove `INDEX_PATH` and `EXTRA_TOOLS_GEOCODE_ADDRESS_PROFILES`. `schema.json`: same keys (`mcpServer` enum), `required` updated. `src/config.ts`: `normalizeLists` keeps only `files.urlPrefixes`. Run `npm run build-types`.

- [ ] **Step 5: Run it**

Run: `NODE_ENV=test node --test src/config.test.ts`
Expected: PASS.

- [ ] **Step 6: Regenerate fixtures from data-fair's merge**

`scripts/refresh-fixtures.ts`: import `apiDocs` (`api/contract/api-docs.ts`), `prepareFragment` and `mergePlatformDoc` (`api/contract/platform-api-docs.ts`); build the datafair service `{ id: 'datafair', title: 'Data Fair', mountPath: '/data-fair/api/v1', docPath: '/data-fair/api/v1/api-docs.json' }`, prepare `apiDocs(PUBLIC_URL)`, merge with origin `http://fixture.test`, state `{ status: 'ok', fetchedAt }`, info `{ version: 'fixture', oauth2Description: 'Platform scopes' }`; write `platform-api-docs.json`; copy skill files as today. Delete the two old fixtures.

Run: `node scripts/refresh-fixtures.ts ../data-fair_feat-autonomous-agents`
Expected: `test/fixtures/platform-api-docs.json` exists; `grep -c '"datafair_list_datasets"' test/fixtures/platform-api-docs.json` ≥ 1; `grep -c profiles test/fixtures/platform-api-docs.json` = 0.

- [ ] **Step 7: Token helper and fake site**

Write `test/tokens.ts` (keys from `generateKeyPairSync('rsa', { modulusLength: 2048 })`, JWKs via `publicKey.export({ format: 'jwk' })` plus `kid`, `alg: 'RS256'`, `use: 'sig'`; signing with `jsonwebtoken`, `expiresIn: '5m'`). Update `test/fake-site.ts` per the Interfaces block; header comment updated.

Run: `NODE_ENV=test node -e "import('./test/fake-site.ts').then(async m => { const s = await m.startFakeSite(); const r = await fetch(s.origin + '/data-fair/api/v1/platform/api-docs.json'); const d = await r.json(); console.log(r.status, d.servers[0].url === s.origin); await s.close() })"`
Expected: `200 true`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json config src/config.ts src/config.test.ts scripts test
git commit -m "chore!: openapi-mcp 0.7, platform document config and fixtures"
```

---

### Task 2: The live document

**Files:**
- Create: `src/live-document.ts` (from `git -C ~/data-fair/openapi-mcp show 582ab70:src/live.ts`)
- Create: `src/live-document.test.ts` (from `582ab70:test/live.test.ts`)

**Interfaces:**
- Produces: `createLiveDocument(url: string, options: LoadOptions): Promise<LiveDocument>`; `LiveDocument` = `{ readonly toolSet: ToolSet, readonly document: Record<string, any>, readonly error?: string, refresh(): Promise<boolean>, onChange(cb: (toolSet: ToolSet) => void): () => void }`. `document` (new) is the last document that built the current tool set.

- [ ] **Step 1: Bring the test over**

Copy the test, import from `./live-document.ts`; replace the petstore/vetstore fixtures with `test/fixtures/platform-api-docs.json` (tool name assertions become `datafair_…` names; the "throws on invalid annotation" case uses a root `x-agent` openapi-mcp 0.7.0 refuses, e.g. `{ skills: 'x' }`). Add:

```ts
it('exposes the document behind the current tool set', async () => {
  const s = stack(); s.set(DOC, platformDoc)
  const live = await createLiveDocument(DOC, { fetch: s.fetchFn, lint: 'warn' })
  assert.equal(live.document['x-platform'].services[0].id, 'datafair')
})
```

- [ ] **Step 2: Run it**

Run: `NODE_ENV=test node --test src/live-document.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Move the code**

Copy `live.ts`, import `load`, `toolSetSnapshot` and types from `@data-fair/openapi-mcp`; `Debug('mcp:live-document')`. The fingerprint becomes `JSON.stringify(toolSetSnapshot(toolSet))` (0.7.0's snapshot covers tools, skills and guides; `instructions` no longer exists). Add the `document` getter.

- [ ] **Step 4: Run it**

Run: `NODE_ENV=test node --test src/live-document.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/live-document.ts src/live-document.test.ts
git commit -m "feat: the live platform document, moved from openapi-mcp"
```

---

### Task 3: Editor form-schema preparation

**Files:**
- Create: `src/editor-schema.ts` (from `git -C ~/data-fair/openapi-mcp show a20b7d6^:src/editor/prepare-schema.ts`)
- Create: `src/editor-schema.test.ts`

**Interfaces:**
- Produces: `prepareEditorSchema(schema: JsonSchema): Promise<JsonSchema>` (the `LoadOptions.prepareEditorSchema` hook; input not mutated).

- [ ] **Step 1: Write the failing test**

```ts
it('prepares a dataset line schema the way data-fair\'s form does', async () => {
  const input = { type: 'object', properties: {
    title: { type: 'string', layout: 'textarea' },
    file: { type: 'string', 'x-refersTo': 'http://schema.org/DigitalDocument' },
    link: { type: 'string', 'x-refersTo': 'http://schema.org/DigitalDocument', layout: 'text-field' },
    geo: { type: 'string', 'x-extension': 'geocoder' }
  } }
  const out = await prepareEditorSchema(input)
  assert.deepEqual(out.properties.title.layout, { comp: 'textarea' })
  assert.equal(out.properties.file.layout.comp, 'none')
  assert.equal(out.properties.link.layout.comp, 'text-field')
  assert.equal(out.properties.geo.layout.comp, 'none')
  assert.equal(input.properties.title.layout, 'textarea', 'input untouched')
})
```

- [ ] **Step 2: Run it** — `NODE_ENV=test node --test src/editor-schema.test.ts`, expected FAIL (module not found).

- [ ] **Step 3: Move the code** — rename the export to `prepareEditorSchema`, `JsonSchema` from `@data-fair/openapi-mcp`; `@json-layout/core/compat/v2` stays a lazy import.

- [ ] **Step 4: Run it** — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add src/editor-schema.ts src/editor-schema.test.ts
git commit -m "feat: data-fair's form-schema preparation for editor groups, moved from openapi-mcp"
```

---

### Task 4: The two tool sets

**Files:**
- Create: `src/datasets-server.ts`, `src/datasets-server.test.ts`
- Create: `src/platform.ts`, `src/platform.test.ts`
- Delete: `src/composition.ts`, `src/composition.test.ts`

**Interfaces:**
- Consumes: `createLiveDocument` (Task 2), `prepareEditorSchema` (Task 3), `siteFetch`/`SiteDispatcher` (`src/site-fetch.ts`), `geocodeAddressTool` (`src/tools/geocode-address.ts`).
- Produces (`src/datasets-server.ts`): `DATASETS_TOOLS: Record<string, string>` (the six `name → datafair_name` pairs); `datasetsToolSet(platform: ToolSet): { toolSet: ToolSet, missing: string[] }` — renamed tools in map order, skills whose `tools` are all mapped (unbound kept) with renamed `tools`, guides whose tools are all mapped, renamed.
- Produces (`src/platform.ts`): `fileOptions(files)` (moved unchanged from composition.ts) and

```ts
export interface Platform {
  /** the platform set for these scopes (undefined: unscoped), geocode_address appended */
  platform (scopes: string[] | undefined): ToolSet
  /** the datasets set for these scopes, geocode_address appended */
  datasets (scopes: string[] | undefined): ToolSet
  status (): { services: unknown, error?: string, lastRefresh?: Date, missingDatasetsTools: string[] }
  onChange (cb: () => void): () => void
  refresh (): Promise<boolean>
  close (): void
}
export function createPlatform (options: { config: Pick<ApiConfig, 'locale' | 'docPath' | 'refreshInterval' | 'extraTools' | 'files' | 'trustedForwarder'>, dispatcher: SiteDispatcher, mainSiteUrl: string }): Promise<Platform>
```

`status().services` is `document['x-platform'].services`. Missing mapped tools are logged with `console.warn` once per change.

- [ ] **Step 1: Write the failing tests**

`src/datasets-server.test.ts` (loads the fixture with `load(doc, { lint: 'warn' })`):

```ts
it('renames the six catalog tools in order', () => {
  const { toolSet, missing } = datasetsToolSet(platformSet)
  assert.deepEqual(toolSet.tools.map(t => t.name), ['list_datasets', 'describe_dataset', 'search_data', 'get_field_values', 'aggregate_data', 'calculate_metric'])
  assert.deepEqual(missing, [])
})
it('reports a mapped tool the document no longer has, never invents it', () => {
  const { toolSet, missing } = datasetsToolSet({ ...platformSet, tools: platformSet.tools.filter(t => t.name !== 'datafair_calculate_metric') })
  assert.equal(toolSet.tools.length, 5)
  assert.deepEqual(missing, ['calculate_metric'])
})
it('keeps unbound skills and drops those naming tools outside the set', () => {
  const { toolSet } = datasetsToolSet(platformSet)
  assert.ok(toolSet.skills.some(s => s.name === 'datafair-workflow'))
  assert.ok(toolSet.skills.every(s => !s.tools?.length || s.tools.every(t => t in DATASETS_TOOLS)))
})
```

`src/platform.test.ts` (fake site, `refreshInterval: 0`, geocoder active):

```ts
it('serves every tool and geocode_address to an unscoped caller', ...)          // platform(undefined) has datafair_publish_dataset and geocode_address
it('cuts the platform set by scopes', ...)                                       // ['datasets:read']: datafair_list_account_datasets yes, datafair_update_dataset no, geocode_address yes
it('separates update and publish by tier', ...)                                  // ['datasets:write']: update yes, publish no; ['datasets:admin']: both
it('gives a token without datasets scopes only geocode_address on datasets', ...) // datasets(['applications:read']).tools names = ['geocode_address']
it('strips output schemas', ...)                                                  // every tool.outputSchema undefined
it('rebuilds and notifies after a document change', ...)                          // site.setDoc(remove x-agent of calculate_metric); refresh() → true; onChange called; datasets(undefined) lacks calculate_metric; status().missingDatasetsTools = ['calculate_metric']
it('keeps the tools when a reload fails', ...)                                    // site.failDoc(500); refresh() → false; tools unchanged; status().error matches /HTTP 500/
it('fails to start when the first load fails', ...)                               // failDoc(500) before createPlatform → rejects
```

- [ ] **Step 2: Run them** — `NODE_ENV=test node --test src/datasets-server.test.ts src/platform.test.ts`, expected FAIL (modules not found).

- [ ] **Step 3: Implement `src/datasets-server.ts` and `src/platform.ts`**

`createPlatform`: validates file options at boot (`createFileFetcher(fileOptions(...))`, as composition did), `createLiveDocument(mainSiteUrl + docPath, { fetch: siteFetch(mainSiteUrl, …), locale, lint: 'warn', structuredContent: true, files, prepareEditorSchema })`, derives both base sets (output schemas stripped) on start and on each change, runs `setInterval(refresh, refreshInterval * 1000).unref()` when `refreshInterval > 0`, records `lastRefresh`. `platform(scopes)` / `datasets(scopes)` = `toolsForScopes(base, scopes)` then `geocode` appended when active. Delete composition files.

- [ ] **Step 4: Run them** — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/datasets-server.ts src/datasets-server.test.ts src/platform.ts src/platform.test.ts src/composition.ts src/composition.test.ts
git commit -m "feat!: the platform and datasets tool sets over the live platform document"
```

---

### Task 5: Credentials and scopes per request

**Files:**
- Create: `src/scopes.ts`, `src/scopes.test.ts`
- Modify: `src/context.ts`, `src/context.test.ts`

**Interfaces:**
- Consumes: `session`, `markScopeChecked` from `@data-fair/lib-express` (session initialized by the caller, Task 6).
- Produces (`src/scopes.ts`):
  - `SCOPES_HEADER = 'x-mcp-scopes'`
  - `credentials(options: { required: boolean, mainSiteUrl: string }): express.RequestHandler` — always deletes `SCOPES_HEADER` first. No credential (no `id_token` cookie, no `x-apikey`/`x-api-key`, no `Bearer` authorization): `required` → 401 text `credentials required`; else next. API key alone: next (unscoped). Cookie or bearer: reads `session.req` on the request, or on `{ headers: { ...req.headers, 'x-forwarded-host': main.host, 'x-forwarded-proto': main.protocol without ':' } }` when it has no `x-forwarded-host`, after `markScopeChecked`; `state.scopes` → `req.headers[SCOPES_HEADER] = JSON.stringify(scopes)`. Read failure: `required` → the error as is (401 stays 401, others keep their status); not `required` → delete `cookie` and `authorization` from `req.headers`, next (anonymous).
  - `scopesOf(request: Request | undefined): string[] | undefined` — parses `SCOPES_HEADER`.
- Produces (`src/context.ts`): `requestContext` also forwards `authorization`; `credentialIdentity` takes `authorization` too (cookie, else bearer, else API key).

- [ ] **Step 1: Write the failing tests**

`src/scopes.test.ts` runs a tiny Express app (`credentials(...)` then a handler echoing `scopesOf`, cookie and authorization) with `session.init(site.origin + '/simple-directory', undefined, undefined, { scopeAware: true })` against the fake site's JWKS, and forwarded headers `x-forwarded-host: portal.test`, `x-forwarded-proto: https`, `x-forwarded-for: 203.0.113.7`:

```ts
it('refuses a caller without credentials when required', ...)                      // 401
it('lets an anonymous caller through when not required', ...)                      // 200, scopes undefined
it('passes an API key as unscoped without reading a session', ...)                  // 200, scopes undefined
it('reads an unscoped cookie session as unscoped', ...)                             // cookieFor(USER) → undefined
it('reads the scopes of a scoped cookie session', ...)                              // cookieFor({ ...USER, organizations: [one], scope: 'datasets:read' }) → ['datasets:read']
it('reads the scopes of a bearer addressed to the site', ...)                       // bearerFor(nhiClaims('datasets:read', 'https://portal.test')) → ['datasets:read']
it('reads an in-cluster bearer against the main site', ...)                         // no forwarded headers, aud = site.origin → ['datasets:read']
it('refuses a bearer addressed to another site', ...)                               // aud 'https://other.test', required → 401
it('strips a client-sent x-mcp-scopes', ...)                                        // API key + header '["x"]' → undefined; anonymous not required + header → undefined
it('serves a bad cookie anonymously when not required, without forwarding it', ...) // expired cookie (expiresIn -1), not required → 200, scopes undefined, echoed cookie absent
it('fails, not 401, on /mcp when the JWKS cannot be read; anonymous on datasets', ...) // session.init on an unreachable URL: required → status >= 500; not required → 200 anonymous
```

`src/context.test.ts`: add `it('forwards a bearer authorization', ...)` (ctx.headers.authorization === 'Bearer t') and identity of a bearer-only caller defined and different from an API-key caller's.

- [ ] **Step 2: Run them** — `NODE_ENV=test node --test src/scopes.test.ts src/context.test.ts`, expected FAIL.

- [ ] **Step 3: Implement `src/scopes.ts` and the `context.ts` changes**

- [ ] **Step 4: Run them** — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scopes.ts src/scopes.test.ts src/context.ts src/context.test.ts
git commit -m "feat: verified session scopes per request, bearer credentials forwarded"
```

---

### Task 6: HTTP routes, discovery and runtime

**Files:**
- Modify: `src/app.ts`, `src/app.test.ts`
- Create: `src/ai-catalog.ts`; Delete: `src/registry.ts`
- Modify: `src/server.ts`, `src/server.test.ts`
- Modify: `src/site-links.test.ts` (fixtures/names only, if it referenced profiles)

**Interfaces:**
- Consumes: `Platform` (Task 4), `credentials`, `scopesOf` (Task 5), `requestContext`, `linksOnSite`.
- Produces: `createApp(platform: Platform, dispatcher: SiteDispatcher)`; `aiCatalogDocument(options: { siteOrigin: string, version: string }): object` (one entry, identifier `urn:air:<host>:mcp:datasets`, card name `fr.data-fair/datasets`, remote `${siteOrigin}/mcp-server/datasets/mcp`, description from the datasets server's purpose: exploring the portal's published data catalog); `Runtime` = `{ app, platform, dispatcher, mainSiteUrl }`; `createRuntime(config)` calls `session.init(config.privateDirectoryUrl, undefined, undefined, { scopeAware: true })` before building the app.

Routes: `app.all('/mcp', cors, credentials({ required: true, mainSiteUrl }), toNodeHandler(main))`, `app.all('/datasets/mcp', cors, credentials({ required: false, mainSiteUrl }), toNodeHandler(datasets))`, `GET /ai-catalog.json`, `GET /status` (internal: `mainSiteUrl`, `platform.status()`, `extraTools`). CORS allowed headers gain `Authorization`. `main` source: `request => onSite(request)(platform.platform(scopesOf(request)))`; `datasets` likewise with `platform.datasets`. `platform.onChange` → both handlers' `notify.toolsChanged()` and `notify.resourcesChanged()`. No `/profiles`, `/v0/servers`, profile parsing.

- [ ] **Step 1: Rewrite the failing app tests**

Replace the profile cases in `src/app.test.ts` with (fake site, `createRuntime`-equivalent wiring, `session.init` on the fake site):

```ts
it('refuses /mcp without credentials', ...)                                         // POST /mcp-server/mcp → 401
it('serves /mcp to an unscoped session and calls the requesting site with its identity', ...) // cookieFor(USER): first tool datafair_…, geocode_address present; call datafair_list_datasets → text has the cookie; hit has referer https://portal.test/mcp, x-trusted-forwarder, x-forwarded-host portal.test
it('cuts /mcp by the bearer\'s scopes and forwards the bearer', ...)               // bearerFor(nhiClaims('datasets:read','https://portal.test')): no datafair_update_dataset; call reaches site with authorization header
it('serves the datasets server anonymously with its seven names', ...)              // exact list of the seven
it('cuts the datasets server by scopes too', ...)                                   // bearer with 'applications:read' → ['geocode_address']
it('serves an in-cluster caller on the main site', ...)                             // API key, no forwarded headers → "Seen by 127.0.0.1:<port>"
it('hands out file links on the site the call came through', ...)                   // kept, with a cookie session instead of ?profiles=read
it('notifies tools/list_changed after a document change', ...)                      // setDoc + platform.refresh() → client receives the notification
it('publishes the datasets server card in the AI catalog', ...)                     // GET /mcp-server/ai-catalog.json: one entry, remotes[0].url https://portal.test/mcp-server/datasets/mcp
it('no longer serves /profiles nor /v0/servers', ...)                               // both 404
```

`src/server.test.ts`: the proxy-wiring case calls `/mcp-server/datasets/mcp` (anonymous) instead of `/mcp`; config without `profiles`.

- [ ] **Step 2: Run them** — `NODE_ENV=test node --test src/app.test.ts src/server.test.ts`, expected FAIL.

- [ ] **Step 3: Implement** `src/app.ts`, `src/ai-catalog.ts`, `src/server.ts`; delete `src/registry.ts`.

- [ ] **Step 4: Run them** — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/app.ts src/app.test.ts src/ai-catalog.ts src/registry.ts src/server.ts src/server.test.ts src/site-links.test.ts
git commit -m "feat!: /mcp filtered by scopes and always authenticated, /datasets/mcp, ai-catalog lists the datasets server"
```

---

### Task 7: stdio

**Files:**
- Modify: `index.ts`
- Modify: `src/scopes.ts` (add `stdioSession`), `src/scopes.test.ts`
- Modify: `src/stdio.test.ts`

**Interfaces:**
- Consumes: `createPlatform` (Task 4), `siteFetch`, `createDispatcher`.
- Produces: `stdioSession(options: { mainSiteUrl: string, dispatcher: SiteDispatcher, apiKey?: string }): Promise<{ authenticated: boolean, scopes?: string[] }>` — API key: `{ authenticated: true }` without a request; else `GET <mainSiteUrl>/simple-directory/api/auth/my-session` through `siteFetch` (no forwarder secret): `user` present → `{ authenticated: true, scopes: body.scopes }`, else `{ authenticated: false }`.

`index.ts` stdio branch: `config.mcpServer` picks `platform.platform(scopes)` or `platform.datasets(scopes)` as the source (server info names per Global Constraints); `mcpServer === 'platform' && !authenticated` → `console.error('MCP_SERVER=platform needs credentials: DATA_FAIR_API_KEY or a proxy injecting a session')`, exit 1; `platform.onChange` → `sendToolListChanged`; ready line names the server.

- [ ] **Step 1: Write the failing tests**

`src/scopes.test.ts`: `stdioSession` with an API key makes no request; with `site.setSession({ user: USER, scopes: ['datasets:read'] })` returns those scopes; with `setSession({})` returns `{ authenticated: false }`.

`src/stdio.test.ts`:

```ts
it('serves the datasets server by default, the API key on every call, no forwarder secret', ...) // tools = the seven names; call list_datasets → apikey=k; no x-trusted-forwarder
it('serves the platform server cut by the session my-session reports', ...)                     // MCP_SERVER=platform, no key, setSession({ user, scopes: ['datasets:read'] }): datafair_list_account_datasets yes, datafair_update_dataset no
it('refuses to start the platform server without credentials', ...)                             // MCP_SERVER=platform, setSession({}): process exits 1, stderr matches /needs credentials/
```

- [ ] **Step 2: Run them** — `NODE_ENV=test node --test src/scopes.test.ts src/stdio.test.ts`, expected FAIL.

- [ ] **Step 3: Implement** `stdioSession` and the stdio branch of `index.ts`.

- [ ] **Step 4: Run the whole suite**

Run: `npm run quality`
Expected: lint, types and every test pass; `grep -rn "profiles\|composer\|indexPath" src index.ts config` returns nothing.

- [ ] **Step 5: Commit**

```bash
git add index.ts src/scopes.ts src/scopes.test.ts src/stdio.test.ts
git commit -m "feat!: stdio serves the datasets server by default, the platform server with MCP_SERVER=platform"
```

---

### Task 8: Documentation and live test

**Files:**
- Modify: `README.md`, `AGENTS.md`, `live-test/README.md`, `live-test/AGENTS.md`, `live-test/run-mcp.sh`, `live-test/.env.example`

- [ ] **Step 1: Rewrite the docs**

`AGENTS.md`: overview (platform server over the merged document, scopes, datasets server, ai-catalog, stdio `MCP_SERVER`), layout (`live-document.ts`, `platform.ts`, `datasets-server.ts`, `scopes.ts`, `editor-schema.ts`, `ai-catalog.ts`; no `composition.ts`/`registry.ts`), key patterns (one live document; tools filtered by verified scopes; datasets server as a fixed map; `geocode_address` the one hand-written tool; fixtures via `node scripts/refresh-fixtures.ts <data-fair checkout>`). `README.md`: routes, environment variables (`DOC_PATH`, `PRIVATE_DIRECTORY_URL`, `MCP_SERVER`; `INDEX_PATH`, `PROFILES` gone), the Compatibility section restated as the datasets server's contract. `live-test`: `PROFILES`/`DF_PROFILES` → `MCP_SERVER=platform`.

- [ ] **Step 2: Check**

Run: `grep -rn -i "profile\|index.json\|v0/servers" README.md AGENTS.md live-test && npm run quality`
Expected: no grep match (except unrelated words, checked by eye); quality passes.

- [ ] **Step 3: Commit**

```bash
git add README.md AGENTS.md live-test
git commit -m "docs: the platform server, the datasets server and scopes"
```
