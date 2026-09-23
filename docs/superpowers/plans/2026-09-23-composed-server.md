# The composed server (v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-written dataset tools with the composed tool set of the deployment's index, served over stdio and HTTP with each caller's site and identity, in two deployment modes, keeping the `/datasets/mcp` route and its seven tool names.

**Architecture:** One `Composer` from `@data-fair/openapi-mcp` over the main site's public index; a per-request `siteFetch` that swaps the origin of every upstream call to the requesting site (optionally dispatched to the in-cluster L2 nginx); a context hook forwarding cookies/API key; Express routes `/mcp`, `/datasets/mcp`, `/v0/servers`, `/status`; `mode: public | internal` decides the profile gate, rate limiting and `/status` exposure. Two small library additions in `openapi-mcp` 0.2.1 come first.

**Tech Stack:** Node 24, TypeScript run directly, Express 5, `@data-fair/openapi-mcp` ^0.2.1, `@modelcontextprotocol/server` + `/node` 2.0 (runtime) and `/client` 2.0 (tests), `undici` ^7, `@data-fair/lib-express`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-23-composed-server-design.md`

## Global Constraints

- Two repositories: Tasks 1–2 in `~/data-fair/openapi-mcp` on `main` (then `0.2.1` published by the user); Tasks 3–8 in `~/data-fair/mcp` on `feat-openapi-mcp`. Conventional commits in both.
- `mode` is the boundary: `public` gates profiles by `publicProfiles`, rate-limits per IP and keeps `/status` internal; `internal` opens all three. **No header is ever trusted to unlock a profile.**
- `reqOrigin`, `reqHost`, `reqIp` from lib-express throw without `X-Forwarded-*` headers: never call them in `internal` mode, and derive the site from the web `Request`'s headers in the context hook.
- The library never holds a credential: `x-ignore-rate-limiting`, `Referer`, `User-Agent` are set by `siteFetch`; the caller's `cookie`/`x-apikey` come through `CallContext.headers`.
- Tool names: composed set `datafair_*` + `geocode_address`; alias: `list_datasets`, `describe_dataset`, `search_data`, `get_field_values`, `aggregate_data`, `calculate_metric`, `geocode_address`.
- Server info: `/mcp` → `datafair-mcp-server`; `/datasets/mcp` → `datafair-datasets-mcp-server`; version from `package.json`.
- Dependencies at the end: `+ @data-fair/openapi-mcp ^0.2.1`, `+ @modelcontextprotocol/server ^2.0.0`, `+ @modelcontextprotocol/node ^2.0.0`, `+ undici ^7.14.0`; `- @modelcontextprotocol/sdk`, `- @data-fair/agent-tools-data-fair`, `- zod`, `- csv-stringify`; dev `+ @modelcontextprotocol/client ^2.0.0`, `- nock`.
- Tests: `npm test` (`node --test 'src/**/*.test.ts'`), no network beyond `127.0.0.1`; config is mutated in tests by assignment on the imported object, as `tools.test.ts` does today.
- `npm run quality` (lint, build-types, tsc, test) green before every commit in `mcp`; `npm run quality` in `openapi-mcp`.

---

## File Structure

**`openapi-mcp` (Tasks 1–2):**
- Modify: `src/compose.ts` (`compose(profiles, options)`), `src/adapters/mcp.ts` (function source), `src/snapshot.ts` (strip `undefined`), `README.md`, `package.json` (0.2.1)
- Test: `test/compose.test.ts`, `test/adapters-mcp.test.ts`, `test/snapshot.test.ts`

**`mcp` (Tasks 3–8):**
- Create: `src/site-fetch.ts` — dispatcher, origin swap, server headers, optional local proxy. No config import: takes options.
- Create: `src/context.ts` — web `Request` → `CallContext`; forwarded-header origin parsing.
- Create: `src/tools/geocode-address.ts` — the IGN tool as an openapi-mcp `Tool`.
- Create: `src/composition.ts` — composer, refresh loop, extra tools, `main(profiles)` / `alias()`.
- Create: `src/registry.ts` — the `/v0/servers` document.
- Create: `test/fixtures/data-fair-api-docs.json`, `test/fake-site.ts` — the fake site used by every server test.
- Create: `src/site-fetch.test.ts`, `src/context.test.ts`, `src/tools/geocode-address.test.ts`, `src/composition.test.ts`, `src/app.test.ts`, `src/stdio.test.ts`
- Rewrite: `src/app.ts`, `index.ts`, `README.md`, `AGENTS.md`, `dev/resources/inspector.json`
- Modify: `config/default.cjs`, `config/custom-environment-variables.cjs`, `config/type/schema.json`, `package.json`
- Delete: `src/mcp-servers/`, `src/mcp-router-factory.ts`

---

### Task 1 (openapi-mcp): `compose(profiles, { services, namePrefix })`

**Files:**
- Modify: `src/compose.ts` (`Composer.compose`, `build`, `setKey`)
- Test: `test/compose.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ComposeOptions { services?: string[]; namePrefix?: string }
  compose (profiles?: string[], options?: ComposeOptions): Promise<Composition>   // memoized per (set, options)
  ```

- [ ] **Step 1: Write the failing test**

Append to `describe('createComposer', …)` in `test/compose.test.ts`:

```ts
  it('restricts a composition to some services and overrides the prefix — a compatibility route', async () => {
    const s = base()
    const composer = await createComposer(INDEX, { fetch: s.fetchFn })
    const c = await composer.compose(['explore'], { services: ['pets'], namePrefix: '' })
    assert.deepEqual(c.toolSet.tools.map(t => t.name), ['list_pets', 'get_pet'])
    assert.deepEqual(c.services.map(x => x.id), ['pets'], 'only the listed services are composed')
    assert.equal(await composer.compose(['explore'], { services: ['pets'], namePrefix: '' }), c, 'memoized with its options')
    assert.notEqual(await composer.compose(['explore']), c)
    assert.deepEqual((await composer.compose(['explore'])).toolSet.tools.map(t => t.name), ['pets_list_pets', 'pets_get_pet', 'vets_list_vets'])
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/data-fair/openapi-mcp && node --test test/compose.test.ts`
Expected: the new case fails (`compose` ignores its second argument: names keep their prefix and both services are present).

- [ ] **Step 3: Implement**

In `src/compose.ts`:

```ts
/** What a compatibility route needs: a subset of the services, and the names its clients already have. */
export interface ComposeOptions {
  /** service ids to compose, in index order; absent means all */
  services?: string[]
  /** replaces every document's `x-agent.namePrefix` (`''` strips it) */
  namePrefix?: string
}
```

`Composer.compose` becomes `compose (profiles?: string[], options?: ComposeOptions): Promise<Composition>`. In `createComposer`:

- `setKey(profiles, options)` returns `` `${[...new Set(profiles)].sort().join(',')}|${(options?.services ?? []).join(',')}|${options?.namePrefix ?? '\u0000'}` `` (the NUL sentinel distinguishes "no override" from `''`).
- `build(requested, options)`: iterate `orderedDocs().filter(d => !options?.services || options.services.includes(d.id))`, and call `load(d.value, { ...loadOptions, profiles: …, namePrefix: options?.namePrefix })` where `loadOptions` is the composer's options (unchanged).
- `makeComposition(requested, options)` and `compose(requested, options)` thread the options through; the memo map is keyed by the new `setKey`.
- `compose()` (the one-shot export) gains the same optional `options` after `profiles` in its options object: `compose(index, { profiles, services, namePrefix, ...rest })`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run quality`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/compose.ts test/compose.test.ts
git commit -m "feat: compose a subset of services under an overridden prefix"
```

---

### Task 2 (openapi-mcp): request-dependent source, snapshot without undefined, 0.2.1

**Files:**
- Modify: `src/adapters/mcp.ts` (`ToolSource`, `createMcpServer`, `mcpServerFactory`, `createMcpHttpHandler`), `src/snapshot.ts`, `README.md`, `package.json`
- Test: `test/adapters-mcp.test.ts`, `test/snapshot.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ToolSourceFn = (request: Request | undefined) => ToolSource | Promise<ToolSource>
  createMcpServer (source: ToolSource | ToolSourceFn, info, options?)
  mcpServerFactory (source: ToolSource | ToolSourceFn, info, options?)
  createMcpHttpHandler (source: ToolSource | ToolSourceFn, info, options?)   // no onChange wiring for a function source: the caller uses handler.notify
  ```

- [ ] **Step 1: Write the failing tests**

In `test/adapters-mcp.test.ts`, add a third `describe`:

```ts
describe('mcp adapter with a request-dependent source', () => {
  it('picks the source per request and leaves change notifications to the caller', async () => {
    const explore = await load(petstore, { fetch: fetchFn, profiles: ['explore'] })
    const edit = await load(petstore, { fetch: fetchFn, profiles: ['edit'] })
    const handler = createMcpHttpHandler((request) => new URL(request!.url).pathname.endsWith('/edit') ? edit : explore, INFO)
    const http = createServer(toNodeHandler(handler))
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
    const port = (http.address() as any).port
    try {
      for (const [path, names] of [['/mcp', ['pets_list_pets', 'pets_get_pet']], ['/edit', ['pets_create_pet']]] as const) {
        const client = new Client({ name: 'c', version: '0' }, { versionNegotiation: { mode: 'auto' } })
        await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}${path}`)))
        assert.deepEqual((await client.listTools()).tools.map(t => t.name), names)
        await client.close()
      }
      assert.equal(typeof handler.notify.toolsChanged, 'function')
    } finally {
      http.close()
    }
  })
})
```

In `test/snapshot.test.ts`, add:

```ts
  it('never carries undefined, so a golden file round-trips', async () => {
    const doc = structuredClone(petstore)
    doc.paths['/pets'].get.parameters.push({ in: 'query', name: 'flag', schema: { type: 'string', enum: undefined } })
    const snapshot = toolSetSnapshot(await load(doc))
    assert.deepEqual(snapshot, JSON.parse(JSON.stringify(snapshot)))
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/adapters-mcp.test.ts test/snapshot.test.ts`
Expected: the adapter case fails (a function is not a `ToolSet`); the snapshot case fails on `enum: undefined`.

- [ ] **Step 3: Implement**

`src/adapters/mcp.ts`:

```ts
export type ToolSourceFn = (request: Request | undefined) => ToolSource | Promise<ToolSource>
const isSourceFn = (s: ToolSource | ToolSourceFn): s is ToolSourceFn => typeof s === 'function'

export async function createMcpServer (source: ToolSource | ToolSourceFn, info, options = {}): Promise<Server> {
  const resolved = isSourceFn(source) ? await source(options.request) : source
  const toolSet = await resolveToolSet(resolved, requestProfiles(options.request) ?? options.profiles)
  // … unchanged
}
export function mcpServerFactory (source: ToolSource | ToolSourceFn, info, options = {}): McpServerFactory { /* unchanged body */ }
export function createMcpHttpHandler (source: ToolSource | ToolSourceFn, info, options = {}): McpHttpHandler {
  const { context, profiles, refreshMs, ...handlerOptions } = options
  const handler = createMcpHandler(mcpServerFactory(source, info, { context, profiles, refreshMs }), handlerOptions)
  // A function source decides per request; whoever owns it publishes changes through handler.notify.
  if (!isSourceFn(source) && (isComposer(source) || isComposition(source))) {
    source.onChange(() => { handler.notify.toolsChanged(); handler.notify.resourcesChanged() })
  }
  return handler
}
```

`src/snapshot.ts`: return `JSON.parse(JSON.stringify({ … }))` — the snapshot is defined as what a golden file holds. Update the doc comment accordingly.

`README.md` — in "Composing a deployment", add one sentence each: `composer.compose(['explore'], { services: ['data-fair'], namePrefix: '' })` for a compatibility route; `createMcpHttpHandler((request) => …)` for a source chosen per request (then publish changes yourself with `handler.notify.toolsChanged()`).

`package.json`: `"version": "0.2.1"`.

- [ ] **Step 4: Run the gate**

Run: `npm run quality`
Expected: green.

- [ ] **Step 5: Commit, then the user publishes**

```bash
git add src/adapters/mcp.ts src/snapshot.ts README.md package.json test/adapters-mcp.test.ts test/snapshot.test.ts
git commit -m "feat: request-dependent tool source; snapshot round-trips; 0.2.1"
```

Then (the user, per CONTRIBUTING): `npm publish && git tag v0.2.1 && git push --follow-tags`. Tasks 3+ need `npm view @data-fair/openapi-mcp version` → `0.2.1`.

---

### Task 3 (mcp): dependencies and configuration

**Files:**
- Modify: `package.json`, `config/default.cjs`, `config/custom-environment-variables.cjs`, `config/type/schema.json`
- Test: `src/config.test.ts`

**Interfaces:**
- Produces the config shape every later task reads:
  ```ts
  config.mode: 'public' | 'internal'
  config.mainSiteUrl?: string          // stdio: falls back to portalUrl
  config.indexPath: string             // '/data-fair/api/v1/agents/index.json'
  config.refreshInterval: number       // seconds, 300
  config.publicProfiles: string[]      // ['explore']
  config.upstreamProxyHost?: string    // 'haproxy1-nginx' or 'host:port'
  config.extraTools: { geocodeAddress: { active: boolean, profiles: string[] } }
  ```

- [ ] **Step 1: Swap the dependencies**

```bash
cd ~/data-fair/mcp
npm uninstall @modelcontextprotocol/sdk @data-fair/agent-tools-data-fair zod csv-stringify nock
npm i @data-fair/openapi-mcp@^0.2.1 @modelcontextprotocol/server@^2.0.0 @modelcontextprotocol/node@^2.0.0 undici@^7.14.0
npm i -D @modelcontextprotocol/client@^2.0.0
```

`tsc` will now fail on the old sources; that is expected until Task 8 deletes them. Until then run the gate as `npm run lint && npm run build-types && npm test` and note it in each commit message; Task 8 restores `npm run quality`.

- [ ] **Step 2: Write the failing test**

Create `src/config.test.ts`:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

process.env.NODE_CONFIG_DIR = process.cwd() + '/config'

describe('config', () => {
  it('has the composed server defaults', async () => {
    const config = (await import('#config')).default
    assert.equal(config.mode, 'public')
    assert.equal(config.indexPath, '/data-fair/api/v1/agents/index.json')
    assert.equal(config.refreshInterval, 300)
    assert.deepEqual(config.publicProfiles, ['explore'])
    assert.equal(config.upstreamProxyHost, undefined)
    assert.deepEqual(config.extraTools, { geocodeAddress: { active: true, profiles: ['explore'] } })
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `NODE_ENV=test node --test src/config.test.ts`
Expected: fails on `config.mode` (undefined).

- [ ] **Step 4: Implement**

`config/default.cjs` — add:

```js
  mode: 'public',
  mainSiteUrl: undefined,
  indexPath: '/data-fair/api/v1/agents/index.json',
  refreshInterval: 300,
  publicProfiles: ['explore'],
  upstreamProxyHost: undefined,
  extraTools: {
    geocodeAddress: { active: true, profiles: ['explore'] }
  },
```

`config/custom-environment-variables.cjs` — add:

```js
  mode: 'MODE',
  mainSiteUrl: 'MAIN_SITE_URL',
  indexPath: 'INDEX_PATH',
  refreshInterval: 'REFRESH_INTERVAL',
  publicProfiles: { __name: 'PUBLIC_PROFILES', __format: 'json' },
  upstreamProxyHost: 'UPSTREAM_PROXY_HOST',
  extraTools: {
    geocodeAddress: {
      active: { __name: 'EXTRA_TOOLS_GEOCODE_ADDRESS_ACTIVE', __format: 'json' },
      profiles: { __name: 'EXTRA_TOOLS_GEOCODE_ADDRESS_PROFILES', __format: 'json' }
    }
  },
```

`config/type/schema.json` — add to `properties` (and `mode`, `indexPath`, `refreshInterval`, `publicProfiles`, `extraTools` to `required`):

```json
"mode": { "type": "string", "enum": ["public", "internal"], "default": "public", "description": "public: behind the ingress, profiles gated by publicProfiles, rate limited. internal: reachable only in the cluster, no gate, no rate limiting." },
"mainSiteUrl": { "type": "string", "description": "Origin of the main site (https://host). The index and every document are fetched from it; upstream calls swap it for the requesting site's origin. In stdio mode defaults to portalUrl.", "example": "https://koumoul.com" },
"indexPath": { "type": "string", "default": "/data-fair/api/v1/agents/index.json" },
"refreshInterval": { "type": "number", "default": 300, "description": "Seconds between conditional re-fetches of the index and documents; 0 disables." },
"publicProfiles": { "type": "array", "items": { "type": "string" }, "default": ["explore"], "description": "Profiles a request may ask for in public mode." },
"upstreamProxyHost": { "type": "string", "description": "Optional in-cluster reverse proxy (host or host:port) every site host resolves to; the request keeps the site's Host and gains X-Forwarded-Host/Proto." },
"extraTools": {
  "type": "object",
  "required": ["geocodeAddress"],
  "properties": {
    "geocodeAddress": {
      "type": "object",
      "required": ["active", "profiles"],
      "properties": {
        "active": { "type": "boolean", "default": true },
        "profiles": { "type": "array", "items": { "type": "string" }, "default": ["explore"], "description": "The tool joins the set when the request's profiles intersect this list." }
      }
    }
  }
}
```

Run `npm run build-types` to regenerate `config/type/.type/`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run build-types && NODE_ENV=test node --test src/config.test.ts && npm run lint`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json config src/config.test.ts
git commit -m "feat: v2 dependencies and configuration (mode, main site, refresh, extra tools)"
```

---

### Task 4 (mcp): `geocode_address` as an openapi-mcp tool

**Files:**
- Create: `src/tools/geocode-address.ts`
- Test: `src/tools/geocode-address.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function buildUrl (params: { q: string, limit?: number }, base?: string): string
  export function formatResult (data: any, params: { q: string }): { text: string, structuredContent: { count: number, results: any[] } }
  export function geocodeAddressTool (options?: { fetch?: typeof fetch, base?: string, locale?: 'en' | 'fr' }): Tool   // Tool from @data-fair/openapi-mcp
  ```

- [ ] **Step 1: Write the failing test**

Create `src/tools/geocode-address.test.ts`:

```ts
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { buildUrl, formatResult, geocodeAddressTool } from './geocode-address.ts'

const feature = (label: string, lon: number, lat: number) => ({ properties: { label, score: 0.91, type: 'municipality', name: label, postcode: '35000', city: label, citycode: '35238', context: '35, Ille-et-Vilaine' }, geometry: { coordinates: [lon, lat] } })

describe('geocode_address', () => {
  let ign: Server
  let base: string
  const seen: URL[] = []
  before(async () => {
    ign = createServer((req, res) => {
      const url = new URL(req.url!, 'http://x')
      seen.push(url)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ features: url.searchParams.get('q') === 'nowhere' ? [] : [feature('Rennes', -1.68, 48.11)] }))
    })
    await new Promise<void>(resolve => ign.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(ign.address() as any).port}/geocodage/search`
  })
  after(() => ign.close())

  it('builds the IGN URL, clamping the limit and refusing short queries', () => {
    assert.equal(buildUrl({ q: 'Rennes', limit: 50 }), 'https://data.geopf.fr/geocodage/search?q=Rennes&limit=20')
    assert.equal(new URL(buildUrl({ q: ' Rennes ' })).searchParams.get('limit'), '5')
    assert.throws(() => buildUrl({ q: 'ab' }), /at least 3 characters/)
  })
  it('formats results as text and structured content', () => {
    const r = formatResult({ features: [feature('Rennes', -1.68, 48.11)] }, { q: 'Rennes' })
    assert.match(r.text, /\*\*1\*\* result\(s\) for "Rennes"/)
    assert.match(r.text, /lon=-1.68, lat=48.11/)
    assert.deepEqual(r.structuredContent.results[0].citycode, '35238')
    assert.equal(formatResult({ features: [] }, { q: 'nowhere' }).text, 'No results found for "nowhere".')
  })
  it('is an openapi-mcp tool whose execute never throws', async () => {
    const tool = geocodeAddressTool({ base })
    assert.equal(tool.name, 'geocode_address')
    assert.equal(tool.annotations.readOnlyHint, true)
    assert.deepEqual(tool.inputSchema.required, ['q'])
    const ok = await tool.execute({ q: 'Rennes', limit: 3 })
    assert.equal(ok.isError, undefined)
    assert.match(ok.text, /Rennes/)
    assert.equal(seen.at(-1)!.searchParams.get('limit'), '3')
    const short = await tool.execute({ q: 'ab' })
    assert.equal(short.isError, true)
    const down = await geocodeAddressTool({ base: 'http://127.0.0.1:1/x' }).execute({ q: 'Rennes' })
    assert.equal(down.isError, true)
    assert.match(down.text, /Geocoding API error/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NODE_ENV=test node --test src/tools/geocode-address.test.ts`
Expected: cannot import the module.

- [ ] **Step 3: Implement**

Create `src/tools/geocode-address.ts`:

```ts
/**
 * geocode_address — the one tool no OpenAPI document generates: the IGN Géoplateforme
 * geocoder has no x-agent annotations and never will. Ported from
 * data-fair/agent-tools/geocode-address.ts; joined into the composed set by
 * config.extraTools.geocodeAddress. No data-fair identity is involved.
 */
import type { Tool, ToolResult } from '@data-fair/openapi-mcp'

const DEFAULT_BASE = 'https://data.geopf.fr/geocodage/search'
const TIMEOUT_MS = 30_000

const titles = { en: 'Geocode an address', fr: 'Géocoder une adresse' }

export interface Params { q: string, limit?: number }

export function buildUrl (params: Params, base = DEFAULT_BASE): string {
  const q = params.q?.trim()
  if (!q || q.length < 3) throw new Error('Address must be at least 3 characters.')
  const limit = Math.min(Math.max(params.limit || 5, 1), 20)
  const url = new URL(base)
  url.searchParams.set('q', q)
  url.searchParams.set('limit', String(limit))
  return url.toString()
}

export function formatResult (data: any, params: { q: string }): { text: string, structuredContent: { count: number, results: any[] } } {
  const features = data.features ?? []
  const results = features.map((f: any) => ({
    label: f.properties.label ?? '',
    score: f.properties.score ?? 0,
    type: f.properties.type ?? '',
    name: f.properties.name ?? '',
    postcode: f.properties.postcode ?? '',
    city: f.properties.city ?? '',
    citycode: f.properties.citycode ?? '',
    context: f.properties.context ?? '',
    longitude: f.geometry.coordinates[0],
    latitude: f.geometry.coordinates[1]
  }))
  let text: string
  if (features.length === 0) {
    text = `No results found for "${params.q}".`
  } else {
    const lines = results.map((r: any) =>
      `- **${r.label}** (score: ${r.score?.toFixed?.(2) ?? r.score}, type: ${r.type})\n  Coordinates: lon=${r.longitude}, lat=${r.latitude}\n  Postal code: ${r.postcode}, City: ${r.city} (${r.citycode})\n  Context: ${r.context}`
    )
    text = `**${features.length}** result(s) for "${params.q}":\n\n${lines.join('\n\n')}`
  }
  return { text, structuredContent: { count: results.length, results } }
}

export function geocodeAddressTool (options: { fetch?: typeof fetch, base?: string, locale?: 'en' | 'fr' } = {}): Tool {
  const fetchFn = options.fetch ?? globalThis.fetch
  return {
    name: 'geocode_address',
    title: titles[options.locale ?? 'en'],
    description: 'Convert a French address or place name into geographic coordinates using the IGN Geoplateforme geocoding service. Returns matching locations with coordinates, postal code, city, and relevance score.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Address or place name to search for in France. Examples: "20 avenue de Segur, Paris", "Mairie de Bordeaux", "33000"' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum number of results to return (default: 5)' }
      },
      required: ['q']
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async execute (params): Promise<ToolResult> {
      let url: string
      try {
        url = buildUrl(params as unknown as Params, options.base)
      } catch (err: any) {
        return { isError: true, text: err.message }
      }
      try {
        const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
        if (!res.ok) return { isError: true, text: `Geocoding API error: HTTP ${res.status}` }
        const { text, structuredContent } = formatResult(await res.json(), params as { q: string })
        return { text, structuredContent }
      } catch (err: any) {
        return { isError: true, text: `Geocoding API error: ${err?.message ?? err}` }
      }
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `NODE_ENV=test node --test src/tools/geocode-address.test.ts && npm run lint`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/tools/geocode-address.ts src/tools/geocode-address.test.ts
git commit -m "feat: geocode_address as an openapi-mcp tool, no agent-tools dependency"
```

---

### Task 5 (mcp): `siteFetch` — origin swap, server headers, optional local proxy

**Files:**
- Create: `src/site-fetch.ts`
- Test: `src/site-fetch.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SiteFetchOptions { mainSiteUrl: string, upstreamProxyHost?: string, ignoreRateLimiting?: string, timeoutMs?: number }
  export function createDispatcher (options: SiteFetchOptions): Dispatcher          // one per process
  export function siteFetch (siteOrigin: string, options: SiteFetchOptions & { dispatcher: Dispatcher }): typeof fetch
  ```

- [ ] **Step 1: Write the failing test**

Create `src/site-fetch.test.ts`:

```ts
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { createDispatcher, siteFetch } from './site-fetch.ts'

/** Echoes what reached it: host, path, and the headers the server is expected to set. */
const echo = () => createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ host: req.headers.host, url: req.url, headers: req.headers }))
})
const listen = async (s: Server) => { await new Promise<void>(r => s.listen(0, '127.0.0.1', r)); return (s.address() as any).port as number }

describe('siteFetch', () => {
  let upstream: Server, port: number
  before(async () => { upstream = echo(); port = await listen(upstream) })
  after(() => upstream.close())

  it('swaps the main site origin for the requesting site and sets the server headers', async () => {
    const main = `http://127.0.0.1:${port}`
    const dispatcher = createDispatcher({ mainSiteUrl: main })
    const f = siteFetch(`http://localhost:${port}`, { mainSiteUrl: main, dispatcher, ignoreRateLimiting: 'secret' })
    const body: any = await (await f(new Request(`${main}/data-fair/api/v1/datasets?size=1`, { headers: { cookie: 'id_token=abc' } }))).json()
    assert.equal(body.host, `localhost:${port}`)
    assert.equal(body.url, '/data-fair/api/v1/datasets?size=1')
    assert.equal(body.headers.cookie, 'id_token=abc')
    assert.equal(body.headers['x-ignore-rate-limiting'], 'secret')
    assert.equal(body.headers.referer, `http://localhost:${port}/mcp`)
    assert.equal(body.headers['user-agent'], '@data-fair/mcp')
  })

  it('leaves a foreign origin alone', async () => {
    const main = 'https://main.test'
    const dispatcher = createDispatcher({ mainSiteUrl: main })
    const f = siteFetch('https://site.test', { mainSiteUrl: main, dispatcher })
    const body: any = await (await f(`http://127.0.0.1:${port}/elsewhere`)).json()
    assert.equal(body.url, '/elsewhere')
    assert.equal(body.host, `127.0.0.1:${port}`)
  })

  it('dispatches every site host to the upstream proxy, keeping Host and adding X-Forwarded-*', async () => {
    const main = 'https://main.test'
    const dispatcher = createDispatcher({ mainSiteUrl: main, upstreamProxyHost: `127.0.0.1:${port}` })
    const f = siteFetch('https://portal.test', { mainSiteUrl: main, dispatcher, upstreamProxyHost: `127.0.0.1:${port}` })
    const body: any = await (await f(`${main}/data-fair/api/v1/ping`)).json()
    assert.equal(body.host, `portal.test:${port}`)
    assert.equal(body.headers['x-forwarded-host'], 'portal.test')
    assert.equal(body.headers['x-forwarded-proto'], 'https')
    assert.equal(body.url, '/data-fair/api/v1/ping')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NODE_ENV=test node --test src/site-fetch.test.ts`
Expected: cannot import the module.

- [ ] **Step 3: Implement**

Create `src/site-fetch.ts`:

```ts
/**
 * The one place upstream calls are shaped. Portals' 01-local-fetch.ts recipe: the site's
 * public origin (so the reverse proxy's metrics count the call), DNS resolved once, short
 * timeouts, the rate-limit bypass secret, and the caller's cookies forwarded — plus, when
 * upstreamProxyHost is set, a direct hop to the in-cluster L2 nginx that skips public DNS
 * and the L1 proxy while looking, to that nginx, exactly like a proxied request.
 */
import dns from 'node:dns'
import { Agent, interceptors, type Dispatcher } from 'undici'

export interface SiteFetchOptions {
  /** origin the composed tools carry in their URLs */
  mainSiteUrl: string
  /** `host` or `host:port` every site host resolves to; the URL keeps the site's host */
  upstreamProxyHost?: string
  ignoreRateLimiting?: string
  timeoutMs?: number
}

const proxyTarget = (spec: string) => {
  const [host, port] = spec.split(':')
  return { host, port: port ? Number(port) : 80 }
}

export function createDispatcher (options: SiteFetchOptions): Dispatcher {
  const timeout = options.timeoutMs ?? 30_000
  const proxy = options.upstreamProxyHost ? proxyTarget(options.upstreamProxyHost) : undefined
  return new Agent({ connections: 8, allowH2: !proxy, headersTimeout: timeout, bodyTimeout: timeout })
    .compose(interceptors.dns({
      maxTTL: Infinity,
      ...(proxy
        ? { lookup: (_hostname: string, opts: dns.LookupOptions, cb: (err: NodeJS.ErrnoException | null, addresses: any, family?: number) => void) => dns.lookup(proxy.host, opts, cb) }
        : {})
    }))
}

export function siteFetch (siteOrigin: string, options: SiteFetchOptions & { dispatcher: Dispatcher }): typeof fetch {
  const main = new URL(options.mainSiteUrl)
  const site = new URL(siteOrigin)
  const proxy = options.upstreamProxyHost ? proxyTarget(options.upstreamProxyHost) : undefined
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request && init === undefined ? input : new Request(input, init)
    const url = new URL(req.url)
    const ours = url.origin === main.origin
    if (ours) {
      url.protocol = site.protocol
      url.host = site.host
    }
    const headers = new Headers(req.headers)
    headers.set('user-agent', '@data-fair/mcp')
    if (ours) {
      headers.set('referer', `${siteOrigin}/mcp`)
      if (options.ignoreRateLimiting) headers.set('x-ignore-rate-limiting', options.ignoreRateLimiting)
      if (proxy) {
        headers.set('x-forwarded-host', url.hostname)
        headers.set('x-forwarded-proto', url.protocol.replace(':', ''))
        url.protocol = 'http:'
        url.port = String(proxy.port)
      }
    }
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body
    return fetch(url, { method: req.method, headers, body, signal: req.signal, dispatcher: options.dispatcher, duplex: body ? 'half' : undefined } as RequestInit)
  }) as typeof fetch
}
```

If `interceptors.dns` refuses the `lookup` option in the installed undici (check `node_modules/undici/types/interceptors.d.ts` — `DNSInterceptorOpts` has `lookup?`), fall back to passing `connect: { lookup }` to `Agent` for the proxy case, with the same signature.

- [ ] **Step 4: Run the test to verify it passes**

Run: `NODE_ENV=test node --test src/site-fetch.test.ts && npm run lint`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/site-fetch.ts src/site-fetch.test.ts
git commit -m "feat: siteFetch — origin swap per site, server headers, optional in-cluster proxy"
```

---

### Task 6 (mcp): context, composition and the fake site

**Files:**
- Create: `src/context.ts`, `src/composition.ts`, `test/fake-site.ts`, `test/fixtures/data-fair-api-docs.json`
- Test: `src/context.test.ts`, `src/composition.test.ts`

**Interfaces:**
- Consumes: `createDispatcher`, `siteFetch` (Task 5), `geocodeAddressTool` (Task 4), config (Task 3).
- Produces:
  ```ts
  // src/context.ts
  export function originFromForwarded (headers: Headers): string | undefined   // undefined without X-Forwarded-Host/Proto
  export function requestContext (options: { config: ApiConfig, dispatcher: Dispatcher }): (request: Request | undefined) => CallContext
  // src/composition.ts
  export interface Composition { composer: Composer, main (profiles: string[]): Promise<ToolSet>, alias (): Promise<ToolSet>, lastRefresh: () => Date | undefined, close (): void }
  export async function createComposition (options: { config: ApiConfig, dispatcher: Dispatcher, mainSiteUrl: string }): Promise<Composition>
  ```

- [ ] **Step 1: The fixture and the fake site**

With the data-fair worktree's dev API running (it is, on `DEV_API_PORT` of `~/data-fair/data-fair_feat-openapi-mcp/.env`):

```bash
curl -s http://localhost:5983/api/v1/api-docs.json > test/fixtures/data-fair-api-docs.json
node -e "const d=require('./test/fixtures/data-fair-api-docs.json'); console.log(d['x-agent'].namePrefix, Object.values(d.paths).flatMap(i=>Object.values(i)).filter(o=>o&&o['x-agent']).length)"
```

Expected: `datafair_ 6`. Create `test/fake-site.ts`:

```ts
/**
 * A site for the tests: the index, the annotated data-fair document (servers[0].url pointed
 * at this site) and canned dataset responses that echo the request's host, cookies and
 * forwarded headers — so assertions read what actually reached the API.
 */
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'

export interface FakeSite { origin: string, port: number, hits: { url: string, headers: Record<string, string | string[] | undefined> }[], setDoc (patch: (doc: any) => void): void, close (): Promise<void> }

export async function startFakeSite (): Promise<FakeSite> {
  let doc = JSON.parse(readFileSync(new URL('./fixtures/data-fair-api-docs.json', import.meta.url), 'utf8'))
  let etag = 1
  const hits: FakeSite['hits'] = []
  let origin = ''
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url!, origin)
    hits.push({ url: req.url!, headers: req.headers as any })
    const json = (body: unknown, headers: Record<string, string> = {}) => { res.writeHead(200, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)) }
    if (url.pathname === '/data-fair/api/v1/agents/index.json') return json({ version: 1, services: [{ id: 'data-fair', openapi: `${origin}/data-fair/api/v1/api-docs.json` }], profiles: { explore: { title: { en: 'Explore', fr: 'Explorer' }, description: { en: 'Read-only tools', fr: 'Outils en lecture seule' } } } }, { etag: '"index"' })
    if (url.pathname === '/data-fair/api/v1/api-docs.json') {
      if (req.headers['if-none-match'] === `"${etag}"`) { res.writeHead(304); return res.end() }
      return json({ ...doc, servers: [{ url: `${origin}/data-fair/api/v1` }] }, { etag: `"${etag}"` })
    }
    if (url.pathname === '/data-fair/api/v1/datasets') {
      return json({ count: 1, results: [{ id: 'ds1', slug: 'ds1', title: `Seen by ${req.headers['x-forwarded-host'] ?? req.headers.host}`, summary: `cookie=${req.headers.cookie ?? ''} apikey=${req.headers['x-apikey'] ?? ''}`, count: 1, status: 'finalized', updatedAt: '2026-01-01T00:00:00Z', page: `${origin}/datasets/ds1` }] })
    }
    res.writeHead(404); res.end('not found ' + url.pathname)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as any).port
  origin = `http://127.0.0.1:${port}`
  return {
    origin,
    port,
    hits,
    setDoc (patch) { doc = structuredClone(doc); patch(doc); etag++ },
    close: () => new Promise<void>(resolve => server.close(() => resolve()))
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/context.test.ts`:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { originFromForwarded, requestContext } from './context.ts'
import { createDispatcher } from './site-fetch.ts'

const config: any = { mode: 'public', mainSiteUrl: 'https://main.test', ignoreRateLimiting: 's' }
const dispatcher = createDispatcher({ mainSiteUrl: config.mainSiteUrl })
const ctxOf = (headers: Record<string, string>) => requestContext({ config, dispatcher })(new Request('http://x/mcp', { headers }))

describe('context', () => {
  it('reads the site origin from the forwarded headers, port included when non-default', () => {
    assert.equal(originFromForwarded(new Headers({ 'x-forwarded-host': 'portal.test', 'x-forwarded-proto': 'https' })), 'https://portal.test')
    assert.equal(originFromForwarded(new Headers({ 'x-forwarded-host': 'portal.test', 'x-forwarded-proto': 'http', 'x-forwarded-port': '8080' })), 'http://portal.test:8080')
    assert.equal(originFromForwarded(new Headers({ 'x-forwarded-host': 'portal.test', 'x-forwarded-proto': 'https', 'x-forwarded-port': '443' })), 'https://portal.test')
    assert.equal(originFromForwarded(new Headers({})), undefined)
  })
  it('forwards the cookie and API key, hashes them into an identity, and nothing else', () => {
    const ctx = ctxOf({ cookie: 'id_token=abc', 'x-api-key': 'k', authorization: 'Bearer nope', 'x-forwarded-host': 'portal.test', 'x-forwarded-proto': 'https' })
    assert.deepEqual(ctx.headers, { cookie: 'id_token=abc', 'x-apikey': 'k' })
    assert.equal(ctx.identity, createHash('sha256').update('id_token=abc').digest('hex'))
    assert.equal(typeof ctx.fetch, 'function')
  })
  it('has no headers and no identity for an anonymous caller, and keeps the main site without forwarded headers', () => {
    const ctx = ctxOf({})
    assert.equal(ctx.headers, undefined)
    assert.equal(ctx.identity, undefined)
  })
  it('accepts x-apiKey in either spelling', () => {
    assert.equal(ctxOf({ 'x-apikey': 'k2' }).headers!['x-apikey'], 'k2')
  })
})
```

Create `src/composition.test.ts`:

```ts
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startFakeSite, type FakeSite } from '../test/fake-site.ts'
import { createDispatcher } from './site-fetch.ts'
import { createComposition, type Composition } from './composition.ts'

describe('composition', () => {
  let site: FakeSite
  let composition: Composition
  before(async () => {
    site = await startFakeSite()
    const config: any = { locale: 'en', indexPath: '/data-fair/api/v1/agents/index.json', refreshInterval: 0, extraTools: { geocodeAddress: { active: true, profiles: ['explore'] } } }
    composition = await createComposition({ config, dispatcher: createDispatcher({ mainSiteUrl: site.origin }), mainSiteUrl: site.origin })
  })
  after(async () => { composition.close(); await site.close() })

  it('composes the explore set with prefixes plus geocode_address', async () => {
    const ts = await composition.main(['explore'])
    assert.deepEqual(ts.tools.map(t => t.name), ['datafair_list_datasets', 'datafair_describe_dataset', 'datafair_search_data', 'datafair_get_field_values', 'datafair_aggregate_data', 'datafair_calculate_metric', 'geocode_address'])
    assert.deepEqual(ts.skills.map(s => s.id), ['data-fair/workflow'])
  })
  it('serves the alias with the seven names clients have', async () => {
    const ts = await composition.alias()
    assert.deepEqual(ts.tools.map(t => t.name), ['list_datasets', 'describe_dataset', 'search_data', 'get_field_values', 'aggregate_data', 'calculate_metric', 'geocode_address'])
  })
  it('refuses a profile no service declares instead of serving an empty set', async () => {
    await assert.rejects(composition.main(['nope']), /unknown profile "nope"/)
  })
  it('leaves geocode_address out when the profiles do not intersect its list, or it is inactive', async () => {
    const config: any = { locale: 'en', indexPath: '/data-fair/api/v1/agents/index.json', refreshInterval: 0, extraTools: { geocodeAddress: { active: false, profiles: ['explore'] } } }
    const other = await createComposition({ config, dispatcher: createDispatcher({ mainSiteUrl: site.origin }), mainSiteUrl: site.origin })
    try {
      assert.ok(!(await other.main(['explore'])).tools.some(t => t.name === 'geocode_address'))
    } finally { other.close() }
  })
  it('executes through the caller context: the site origin and identity reach the API', async () => {
    const ts = await composition.main(['explore'])
    const tool = ts.tools.find(t => t.name === 'datafair_list_datasets')!
    const { siteFetch } = await import('./site-fetch.ts')
    const dispatcher = createDispatcher({ mainSiteUrl: site.origin })
    const res = await tool.execute({ q: 'x' }, { fetch: siteFetch(`http://localhost:${site.port}`, { mainSiteUrl: site.origin, dispatcher }), headers: { cookie: 'id_token=abc' } })
    assert.equal(res.isError, undefined)
    assert.match(res.text, /Seen by localhost:\d+/)
    assert.match(res.text, /cookie=id_token=abc/)
  })
  it('refreshes: a changed document is picked up and reported', async () => {
    site.setDoc(doc => { doc.paths['/datasets'].get['x-agent'].name = 'find_datasets' })
    assert.equal(await composition.composer.refresh(), true)
    assert.ok((await composition.main(['explore'])).tools.some(t => t.name === 'datafair_find_datasets'))
    assert.ok(composition.lastRefresh() instanceof Date)
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `NODE_ENV=test node --test src/context.test.ts src/composition.test.ts`
Expected: both cannot import their module.

- [ ] **Step 4: Implement**

Create `src/context.ts`:

```ts
/**
 * From the incoming MCP request to the context every tool call carries: which site the
 * caller came through, and who the caller is. Nothing here is trusted for authorization —
 * the mode decides what a request may ask for (app.ts); this only says where the upstream
 * call goes and which identity data-fair will see.
 */
import { createHash } from 'node:crypto'
import type { Dispatcher } from 'undici'
import type { CallContext } from '@data-fair/openapi-mcp'
import type { ApiConfig } from '#config'
import { siteFetch } from './site-fetch.ts'

/** The de-facto standard the reverse proxy sets; the same rule as lib-express's reqOrigin, without throwing. */
export function originFromForwarded (headers: Headers): string | undefined {
  const host = headers.get('x-forwarded-host')
  const proto = headers.get('x-forwarded-proto')
  if (!host || !proto) return undefined
  const port = headers.get('x-forwarded-port')
  const explicit = port && !(port === '443' && proto === 'https') && !(port === '80' && proto === 'http')
  return `${proto}://${host}${explicit ? ':' + port : ''}`
}

export function requestContext (options: { config: Pick<ApiConfig, 'mainSiteUrl' | 'ignoreRateLimiting' | 'upstreamProxyHost'>, dispatcher: Dispatcher }): (request: Request | undefined) => CallContext {
  const { config, dispatcher } = options
  return (request) => {
    const headers = request?.headers ?? new Headers()
    const siteOrigin = originFromForwarded(headers) ?? config.mainSiteUrl!
    const forwarded: Record<string, string> = {}
    const cookie = headers.get('cookie')
    const apiKey = headers.get('x-apikey') ?? headers.get('x-api-key')
    if (cookie) forwarded.cookie = cookie
    if (apiKey) forwarded['x-apikey'] = apiKey
    const secret = cookie ?? apiKey
    return {
      fetch: siteFetch(siteOrigin, { mainSiteUrl: config.mainSiteUrl!, dispatcher, ignoreRateLimiting: config.ignoreRateLimiting, upstreamProxyHost: config.upstreamProxyHost }),
      headers: Object.keys(forwarded).length ? forwarded : undefined,
      identity: secret ? createHash('sha256').update(secret).digest('hex') : undefined
    }
  }
}
```

Create `src/composition.ts`:

```ts
/**
 * One composer for the process, over the main site's index; the composed set for a profile
 * set, the compatibility alias, the extra tools, and the refresh loop.
 */
import { createComposer, type Composer, type ToolSet } from '@data-fair/openapi-mcp'
import type { Dispatcher } from 'undici'
import type { ApiConfig } from '#config'
import { siteFetch } from './site-fetch.ts'
import { geocodeAddressTool } from './tools/geocode-address.ts'

export interface Composition {
  composer: Composer
  /** the composed set for a request's profiles, extra tools joined */
  main (profiles: string[]): Promise<ToolSet>
  /** data-fair's explore operations under their pre-v2 names, plus geocode_address */
  alias (): Promise<ToolSet>
  lastRefresh (): Date | undefined
  close (): void
}

export async function createComposition (options: { config: Pick<ApiConfig, 'locale' | 'indexPath' | 'refreshInterval' | 'extraTools' | 'ignoreRateLimiting' | 'upstreamProxyHost'>, dispatcher: Dispatcher, mainSiteUrl: string }): Promise<Composition> {
  const { config, dispatcher, mainSiteUrl } = options
  const fetchFn = siteFetch(mainSiteUrl, { mainSiteUrl, dispatcher, ignoreRateLimiting: config.ignoreRateLimiting, upstreamProxyHost: config.upstreamProxyHost })
  const composer = await createComposer(`${mainSiteUrl}${config.indexPath}`, { fetch: fetchFn, locale: config.locale, lint: 'warn' })
  for (const s of composer.services) if (s.status !== 'ok') console.warn(`service ${s.id}: ${s.status}${s.reason ? ` — ${s.reason}` : ''}`)

  const geocode = config.extraTools.geocodeAddress.active ? geocodeAddressTool({ locale: config.locale as 'en' | 'fr' }) : undefined
  const withExtras = (toolSet: ToolSet): ToolSet => {
    if (!geocode || !toolSet.profiles.some(p => config.extraTools.geocodeAddress.profiles.includes(p))) return toolSet
    return { ...toolSet, tools: [...toolSet.tools, geocode] }
  }

  let lastRefresh: Date | undefined
  const timer = config.refreshInterval > 0
    ? setInterval(() => composer.refresh().then(() => { lastRefresh = new Date() }, (err: unknown) => console.error('refresh failed:', err)), config.refreshInterval * 1000).unref()
    : undefined
  composer.onChange(() => { lastRefresh = new Date() })

  return {
    composer,
    async main (profiles) {
      const known = new Set(composer.profiles().map(p => p.name))
      const unknown = profiles.find(p => !known.has(p))
      if (unknown) throw new Error(`unknown profile "${unknown}" (declared: ${[...known].join(', ')})`)
      return withExtras((await composer.compose(profiles)).toolSet)
    },
    async alias () {
      return withExtras((await composer.compose(['explore'], { services: ['data-fair'], namePrefix: '' })).toolSet)
    },
    lastRefresh: () => lastRefresh,
    close () { if (timer) clearInterval(timer) }
  }
}
```

(The refresh test calls `composer.refresh()` directly and then checks `lastRefresh` through `onChange`.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `NODE_ENV=test node --test src/context.test.ts src/composition.test.ts && npm run lint`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/context.ts src/composition.ts test/fake-site.ts test/fixtures/data-fair-api-docs.json src/context.test.ts src/composition.test.ts
git commit -m "feat: composition over the deployment index, and the per-request context"
```

---

### Task 7 (mcp): the app, the registry listing, stdio

**Files:**
- Rewrite: `src/app.ts`, `index.ts`
- Create: `src/registry.ts`
- Test: `src/app.test.ts`, `src/stdio.test.ts`

**Interfaces:**
- Consumes: `createComposition`, `requestContext`, `createDispatcher`.
- Produces: `createApp (composition, dispatcher): express.Application` (exported from `app.ts`, used by `server.ts` and the tests) and `registryDocument (options): { servers: […] }`.

- [ ] **Step 1: Write the failing tests**

Create `src/app.test.ts`:

```ts
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { startFakeSite, type FakeSite } from '../test/fake-site.ts'
import config from '#config'

const PROXY = { 'x-forwarded-host': 'portal.test', 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.7' }

describe('app', () => {
  let site: FakeSite, http: Server, base: string
  const boot = async (mode: 'public' | 'internal') => {
    Object.assign(config, { mode, mainSiteUrl: site.origin, refreshInterval: 0, ignoreRateLimiting: 'secret', publicProfiles: ['explore'] })
    const { createDispatcher } = await import('./site-fetch.ts')
    const { createComposition } = await import('./composition.ts')
    const { createApp } = await import('./app.ts')
    const dispatcher = createDispatcher({ mainSiteUrl: site.origin })
    const composition = await createComposition({ config, dispatcher, mainSiteUrl: site.origin })
    http = createServer(createApp(composition, dispatcher))
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(http.address() as any).port}`
  }
  const connect = async (path: string, headers: Record<string, string> = {}) => {
    const client = new Client({ name: 'c', version: '0' }, { versionNegotiation: { mode: 'auto' } })
    await client.connect(new StreamableHTTPClientTransport(new URL(base + path), { requestInit: { headers } }))
    return client
  }
  before(async () => { site = await startFakeSite() })
  after(async () => { await site.close() })

  describe('public mode', () => {
    before(() => boot('public'))
    after(() => http.close())

    it('serves the composed set at /mcp-server/mcp and calls the requesting site with the caller identity', async () => {
      const client = await connect('/mcp-server/mcp', { ...PROXY, cookie: 'id_token=abc' })
      const { tools } = await client.listTools()
      assert.equal(tools[0].name, 'datafair_list_datasets')
      assert.ok(tools.some(t => t.name === 'geocode_address'))
      const res: any = await client.callTool({ name: 'datafair_list_datasets', arguments: {} })
      assert.match(res.content[0].text, /cookie=id_token=abc/)
      const hit = site.hits.at(-1)!
      assert.equal(hit.headers.referer, 'https://portal.test/mcp')
      assert.equal(hit.headers['x-ignore-rate-limiting'], 'secret')
      await client.close()
    })
    it('serves the alias at /mcp-server/datasets/mcp with the seven names', async () => {
      const client = await connect('/mcp-server/datasets/mcp', PROXY)
      assert.deepEqual((await client.listTools()).tools.map(t => t.name), ['list_datasets', 'describe_dataset', 'search_data', 'get_field_values', 'aggregate_data', 'calculate_metric', 'geocode_address'])
      await client.close()
    })
    it('refuses a non-public profile with 403, whatever the headers', async () => {
      for (const headers of [PROXY, {}]) {
        const res = await fetch(`${base}/mcp-server/mcp?profiles=edit`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' })
        assert.equal(res.status, 403)
      }
    })
    it('lists only public profiles in the registry and keeps /status internal', async () => {
      const reg: any = await (await fetch(`${base}/mcp-server/v0/servers`, { headers: PROXY })).json()
      assert.deepEqual(reg.servers.map((s: any) => s.server.name), ['fr.data-fair/explore'])
      assert.equal(reg.servers[0].server.remotes[0].url, 'https://portal.test/mcp-server/mcp?profiles=explore')
      assert.equal((await fetch(`${base}/mcp-server/status`, { headers: PROXY })).status, 421)
    })
    it('rate-limits per IP', async () => {
      const before = config.defaultLimits.apiRate.nb
      config.defaultLimits.apiRate.nb = 1
      try {
        const h = { ...PROXY, 'x-forwarded-for': '198.51.100.9' }
        await fetch(`${base}/mcp-server/v0/servers`, { headers: h })
        assert.equal((await fetch(`${base}/mcp-server/v0/servers`, { headers: h })).status, 429)
      } finally { config.defaultLimits.apiRate.nb = before }
    })
  })

  describe('internal mode', () => {
    before(() => boot('internal'))
    after(() => http.close())

    it('serves any declared profile without forwarded headers, keeps the main site, and opens /status', async () => {
      const client = await connect('/mcp?profiles=explore')
      const res: any = await client.callTool({ name: 'datafair_list_datasets', arguments: {} })
      assert.match(res.content[0].text, /Seen by 127\.0\.0\.1:\d+/)
      await client.close()
      const status: any = await (await fetch(`${base}/status`)).json()
      assert.deepEqual(status.services.map((s: any) => s.id), ['data-fair'])
      const reg: any = await (await fetch(`${base}/v0/servers`)).json()
      assert.ok(reg.servers.length >= 1)
    })
    it('still refuses an undeclared profile', async () => {
      await assert.rejects(async () => { const c = await connect('/mcp?profiles=nope'); await c.listTools() })
    })
  })
})
```

Create `src/stdio.test.ts`:

```ts
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { startFakeSite, type FakeSite } from '../test/fake-site.ts'

describe('stdio', () => {
  let site: FakeSite
  before(async () => { site = await startFakeSite() })
  after(async () => { await site.close() })

  it('serves the composed set for PORTAL_URL with the API key on every call', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['index.ts'],
      env: { ...process.env, NODE_ENV: 'test', TRANSPORT: 'stdio', PORTAL_URL: site.origin, DATA_FAIR_API_KEY: 'k', REFRESH_INTERVAL: '0' }
    })
    const client = new Client({ name: 't', version: '0' })
    await client.connect(transport)
    const { tools } = await client.listTools()
    assert.equal(tools[0].name, 'datafair_list_datasets')
    const res: any = await client.callTool({ name: 'datafair_list_datasets', arguments: {} })
    assert.match(res.content[0].text, /apikey=k/)
    await client.close()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `NODE_ENV=test node --test src/app.test.ts src/stdio.test.ts`
Expected: `createApp` is not exported; stdio serves the old server (or fails to import the removed SDK).

- [ ] **Step 3: Implement**

Create `src/registry.ts`:

```ts
/** The MCP Registry API listing (GET /v0/servers): one server per profile, for hosts with pickers. */
import type { Composer } from '@data-fair/openapi-mcp'

export function registryDocument (options: { composer: Composer, siteOrigin: string, version: string, profiles?: string[], locale: string }) {
  const { composer, siteOrigin, version, profiles, locale } = options
  const servers = composer.profiles()
    .filter(p => !profiles || profiles.includes(p.name))
    .map(p => ({
      server: {
        name: `fr.data-fair/${p.name}`,
        description: p.description ?? p.title ?? p.name,
        version,
        remotes: [{ type: 'streamable-http', url: `${siteOrigin}/mcp-server/mcp?profiles=${encodeURIComponent(p.name)}` }]
      },
      _meta: { 'fr.data-fair/profile': { name: p.name, title: p.title, services: p.services, locale } }
    }))
  return { servers }
}
```

Rewrite `src/app.ts`:

```ts
import express, { type Request, type Response, type NextFunction } from 'express'
import { readFileSync } from 'node:fs'
import { createSiteMiddleware, errorHandler, assertReqInternal } from '@data-fair/lib-express'
import { createMcpHttpHandler, requestProfiles } from '@data-fair/openapi-mcp/adapters/mcp'
import { toNodeHandler } from '@modelcontextprotocol/node'
import type { Dispatcher } from 'undici'
import config from '#config'
import { rateLimitingMiddleware } from './rate-limiting.ts'
import { requestContext, originFromForwarded } from './context.ts'
import { registryDocument } from './registry.ts'
import type { Composition } from './composition.ts'

const version: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const cacheable = (res: Response) => res.set('Cache-Control', 'public, max-age=300')
const headersOf = (req: Request) => new Headers(Object.entries(req.headers).flatMap(([k, v]) => v === undefined ? [] : [[k, Array.isArray(v) ? v.join(', ') : v] as [string, string]]))
const siteOf = (req: Request) => originFromForwarded(headersOf(req)) ?? config.mainSiteUrl!

export function createApp (composition: Composition, dispatcher: Dispatcher) {
  const app = express()
  app.set('query parser', 'simple')
  app.set('json spaces', 2)

  app.use(createSiteMiddleware('mcp-server'))
  // Public mode: the caller is whoever the reverse proxy says; per-IP limiting applies.
  // Internal mode: only the cluster can reach this deployment; reqIp would throw without X-Forwarded-For.
  if (config.mode === 'public') app.use(rateLimitingMiddleware)

  // CORS for browser-based MCP clients, on the MCP routes only.
  const cors = (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Protocol-Version, Mcp-Method, Mcp-Name')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') { res.status(204).end(); return }
    next()
  }

  // The gate: in public mode a request may only ask for public profiles. No header opens more.
  const profileGate = (req: Request, res: Response, next: NextFunction) => {
    if (config.mode !== 'public') return next()
    const asked = (req.query.profiles as string | undefined)?.split(',').map(s => s.trim()).filter(Boolean) ?? ['explore']
    const refused = asked.filter(p => !config.publicProfiles.includes(p))
    if (refused.length) { res.status(403).type('text/plain').send(`profile not available here: ${refused.join(', ')}`); return }
    next()
  }

  const context = requestContext({ config, dispatcher })
  const options = { context, refreshMs: config.refreshInterval > 0 ? config.refreshInterval * 1000 : undefined }
  const main = createMcpHttpHandler((request) => composition.main(requestProfiles(request) ?? ['explore']), { name: 'datafair-mcp-server', version }, options)
  const alias = createMcpHttpHandler(() => composition.alias(), { name: 'datafair-datasets-mcp-server', version }, options)
  composition.composer.onChange(() => { for (const h of [main, alias]) { h.notify.toolsChanged(); h.notify.resourcesChanged() } })

  app.all('/mcp', cors, profileGate, toNodeHandler(main))
  app.all('/datasets/mcp', cors, toNodeHandler(alias))

  app.get('/v0/servers', (req, res) => {
    cacheable(res)
    res.json(registryDocument({ composer: composition.composer, siteOrigin: siteOf(req), version, locale: config.locale, profiles: config.mode === 'public' ? config.publicProfiles : undefined }))
  })
  app.get('/status', (req, res) => {
    if (config.mode === 'public') assertReqInternal(req)
    res.json({ mode: config.mode, mainSiteUrl: config.mainSiteUrl, services: composition.composer.services, profiles: composition.composer.profiles().map(p => p.name), lastRefresh: composition.lastRefresh(), extraTools: config.extraTools })
  })

  app.use(errorHandler)
  return app
}
```

`src/server.ts`: build the app at start — replace `import app from './app.ts'` and `createServer(app)` with a `start` that resolves `mainSiteUrl` (`config.mainSiteUrl ?? config.portalUrl`, throwing if neither), creates the dispatcher and the composition, then `server = createServer(createApp(composition, dispatcher))`; keep the terminator, observer and timeouts. `stop()` also calls `composition.close()`.

Rewrite `index.ts`:

```ts
import config from '#config'

if (config.transport === 'http') {
  const { start, stop } = await import('./src/server.ts')
  start().then(() => { }, err => { console.error('Failure while starting service', err); process.exit(1) })
  process.on('SIGTERM', function onSigterm () {
    console.info('Received SIGTERM signal, shutdown gracefully...')
    stop().then(() => { console.log('shutting down now'); process.exit() }, err => { console.error('Failure while stopping service', err); process.exit(1) })
  })
} else {
  // Standalone: one process, one site (PORTAL_URL), one caller; the API key is the identity.
  const { serveStdio } = await import('@modelcontextprotocol/server/stdio')
  const { mcpServerFactory } = await import('@data-fair/openapi-mcp/adapters/mcp')
  const { createDispatcher } = await import('./src/site-fetch.ts')
  const { createComposition } = await import('./src/composition.ts')
  const mainSiteUrl = config.mainSiteUrl ?? config.portalUrl
  if (!mainSiteUrl) { console.error('PORTAL_URL (or MAIN_SITE_URL) is required in stdio mode'); process.exit(1) }
  const dispatcher = createDispatcher({ mainSiteUrl, timeoutMs: 30_000 })
  const composition = await createComposition({ config, dispatcher, mainSiteUrl })
  const profiles = (process.env.PROFILES ?? 'explore').split(',').map(s => s.trim()).filter(Boolean)
  const { siteFetch } = await import('./src/site-fetch.ts')
  const headers = config.dataFairAPIKey ? { 'x-apikey': config.dataFairAPIKey } : undefined
  const context = () => ({ fetch: siteFetch(mainSiteUrl, { mainSiteUrl, dispatcher }), headers })
  const version: string = (await import('./package.json', { with: { type: 'json' } })).default.version
  let pinned: import('@modelcontextprotocol/server').Server | undefined
  const factory = mcpServerFactory(() => composition.main(profiles), { name: 'datafair-mcp-server', version }, { context })
  serveStdio(async (ctx) => { pinned = await factory(ctx) as import('@modelcontextprotocol/server').Server; return pinned })
  composition.composer.onChange(() => pinned?.sendToolListChanged().catch(() => {}))
  console.error(`datafair-mcp-server ready on stdio (${mainSiteUrl}, profiles ${profiles.join(',')})`)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `NODE_ENV=test node --test src/app.test.ts src/stdio.test.ts && npm run lint`
Expected: green. If the stdio test's child cannot resolve `#config` with `NODE_ENV=test`, set `NODE_CONFIG_DIR` explicitly in its env as the other tests do.

- [ ] **Step 5: Commit**

```bash
git add src/app.ts src/server.ts src/registry.ts index.ts src/app.test.ts src/stdio.test.ts
git commit -m "feat: the composed server — /mcp, the datasets alias, the registry listing, stdio"
```

---

### Task 8 (mcp): remove the old server, documentation, version

**Files:**
- Delete: `src/mcp-servers/`, `src/mcp-router-factory.ts`
- Rewrite: `README.md`, `AGENTS.md`, `dev/resources/inspector.json`
- Modify: `package.json` (`1.0.0`, scripts), `CONTRIBUTING.md` if it names the deleted files

- [ ] **Step 1: Delete and restore the full gate**

```bash
git rm -r src/mcp-servers src/mcp-router-factory.ts
npm run quality
```

Expected: green — `tsc` now compiles only the new sources. Fix any type error the old tests were masking.

- [ ] **Step 2: README**

Rewrite `README.md` with these sections, keeping the logo line and license: **What it serves** (the composed `explore` tools of the deployment's index, `geocode_address`, the compatibility route with its seven names; tools come from `x-agent` annotations in each service's OpenAPI document via `@data-fair/openapi-mcp`); **Standalone (Docker, stdio)** — the existing JSON example unchanged, `PORTAL_URL` required, `DATA_FAIR_API_KEY` optional, `PROFILES` optional, and the sentence "tool names carry the `datafair_` prefix since 1.0"; **Stack deployment (HTTP)** — the two deployments table from the spec's §3 (`MODE=public` behind `/mcp-server/`, `MODE=internal` on a ClusterIP for the agents service), the routes (`/mcp?profiles=`, `/datasets/mcp`, `/v0/servers`, `/status`); **Environment variables** — the existing table plus `MODE`, `MAIN_SITE_URL`, `INDEX_PATH`, `REFRESH_INTERVAL`, `PUBLIC_PROFILES` (JSON array), `UPSTREAM_PROXY_HOST`, `EXTRA_TOOLS_GEOCODE_ADDRESS_ACTIVE`, `EXTRA_TOOLS_GEOCODE_ADDRESS_PROFILES`, `PROFILES` (stdio); **Compatibility** — `/mcp-server/datasets/mcp` keeps its URL and tool names; input schemas are generated and may differ from 0.x (they are read per session); HTTP+SSE removed; **Development** (pointer to CONTRIBUTING).

- [ ] **Step 3: AGENTS.md and dev resources**

Rewrite `AGENTS.md`'s overview, tech stack (`@data-fair/openapi-mcp`, `@modelcontextprotocol/server` 2, `undici`; no Zod), layout (`src/composition.ts`, `src/site-fetch.ts`, `src/context.ts`, `src/registry.ts`, `src/tools/geocode-address.ts`, `src/app.ts`, `test/fake-site.ts`), key patterns (one composer; origin swap per request; mode is the boundary; tools are generated — annotate in the service's document, never here; `geocode_address` is the one hand-written tool), and delete the "Schema drift" section. Commands unchanged.

`dev/resources/inspector.json`: `dev-streamable` → `http://localhost:5600/mcp-server/mcp`; add `dev-datasets` → `http://localhost:5600/mcp-server/datasets/mcp`; delete `dev-sse`.

- [ ] **Step 4: Version and commit**

`package.json`: `"version": "1.0.0"` — a breaking release: tool names in stdio, HTTP+SSE removed, generated schemas. `npm run quality`, then:

```bash
git add -A
git commit -m "feat!: v2 — the composed server replaces the hand-written tools

BREAKING CHANGE: stdio tool names carry the datafair_ prefix; the HTTP+SSE
endpoints are gone; tool input schemas are generated from the services'
documents. /mcp-server/datasets/mcp keeps its URL and its seven tool names."
```

---

## Self-Review

**Spec coverage.** §1 composition → Task 6 (`createComposition`, `lint: 'warn'`, refresh loop, extra tools, alias via `compose(profiles, { services, namePrefix })` from Task 1). §2 site and identity → Task 5 (`siteFetch`, dispatcher, DNS cache, `upstreamProxyHost` with `X-Forwarded-*`) and Task 6 (`requestContext`: origin from forwarded headers, cookie/API key, identity hash). Mode as the boundary → Task 3 (config) and Task 7 (gate, limiter, `/status`, registry filtering; the internal-mode test asserts no forwarded headers are needed and the public-mode test asserts 403 "whatever the headers"). §3 surfaces → Task 7 (`/mcp`, `/datasets/mcp`, `/v0/servers`, `/status`; SSE gone in Task 8). §4 stdio → Task 7 (`index.ts`, `PORTAL_URL`, `DATA_FAIR_API_KEY`, `PROFILES`). §5 config and dependencies → Task 3. §6 tests → the fake site (Task 6) and every task's spec. §7 rollout → manifests are their own step, as the spec says. The request-dependent source and `compose` options → Tasks 1–2 in `openapi-mcp`.

**Placeholder scan.** None. Two verify-at-implementation notes carry their fallback (`interceptors.dns` `lookup` → `Agent` `connect.lookup`; stdio child config dir).

**Type consistency.** `createDispatcher(options: SiteFetchOptions)` / `siteFetch(siteOrigin, options & { dispatcher })` used identically in Tasks 5, 6 and 7. `createComposition({ config, dispatcher, mainSiteUrl })` and `Composition.{main, alias, lastRefresh, close, composer}` match between Task 6 and Task 7. `requestContext({ config, dispatcher })(request)` matches its test and `app.ts`. `registryDocument` options match `app.ts`. `createMcpHttpHandler` with a function source and `requestProfiles` come from Task 2 (0.2.1).
