# Catalog Profile, One Published Server (Agent Profiles Rollout Step 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the MCP server to the profile vocabulary data-fair declares, as one published server with no public/internal mode: `catalog` by default, every declared profile reachable, `catalog` for the `/datasets/mcp` compatibility route, one registry listing `catalog` and the grid umbrellas, a rate limiter always on and keyed by the caller, on `@data-fair/openapi-mcp` 0.4.0.

**Architecture:** The server keeps one composer, the alias route and the registry; the `mode` setting, `PUBLIC_PROFILES` and the profile gate go away (parity: an agent of ours reaches the server like any other client, and what a caller may do is data-fair's permissions on its identity). The limiter keys on the caller's credential identity, else its IP. The test site's fixtures are regenerated from data-fair's own generators by a script.

**Tech Stack:** TypeScript on Node 24, Express 5, `node:test`, `@data-fair/openapi-mcp` 0.4.0.

**Spec:** data-fair `docs/architecture/agent-profiles.md` §8 ("The `mcp` server") and §10, and `docs/architecture/agent-rate-limiting.md` §3 (intermediate state), both in `~/data-fair/data-fair_chore-structure-openapi-cp`.

## Global Constraints

- "One published server, no public/internal split … every declared profile is available to every caller … `catalog` is the default set."
- "`/v0/servers` lists `catalog` and the umbrellas (`read`, `write`, `manage`) … the deprecated `explore` is accepted but never listed."
- "The compatibility route `/datasets/mcp` composes `catalog` from data-fair with no prefix."
- Rate limiting, intermediate state: "Its own limiter is always on, keyed by the caller's identity (the hash of its cookie or API key …) when authenticated, by client IP otherwise. It still sends `x-ignore-rate-limiting` to data-fair."
- `@data-fair/openapi-mcp` `^0.4.0`.
- Defaults move from `explore` to `catalog`: `PROFILES` (stdio), the `/mcp` default set; `extraTools.geocodeAddress.profiles` defaults to `["catalog", "explore"]` (the alias keeps geocoding for clients still configured with it).
- Work directly on branch `feat-openapi-mcp`. Gate: `npm run lint && npm run check-types && npm test`.

## Review Focus

1. A client still configured with `/mcp?profiles=explore` → served the catalog tools. (Task 2)
2. The catalog `list_datasets` tool → calls `/data-fair/api/v1/catalog/datasets` on the requesting site, with the caller's identity and the forwarded host. (Task 1)
3. Two authenticated callers behind one IP → separate rate-limit budgets; one caller switching IPs → one budget. (Task 3)
4. The registry → `catalog`, `read`, `write`, `manage` in that order, each only if the index declares it, never `explore`. (Task 4)
5. A caller asking for an undeclared profile → refused, not served an empty set. (Task 2)

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `package.json`, `package-lock.json` | dependencies | `@data-fair/openapi-mcp` `^0.4.0` |
| `scripts/refresh-fixtures.ts` | regenerate test fixtures from a data-fair checkout | create |
| `test/fixtures/*` | fixtures | regenerate / create |
| `test/fake-site.ts` | test site | serve the index fixture, skill files, `/catalog/datasets` |
| `config/default.cjs`, `config/custom-environment-variables.cjs`, `config/type/schema.json`, `src/config.ts` | configuration | drop `mode` and `publicProfiles`; geocode defaults |
| `index.ts` | stdio entry | `PROFILES` default |
| `src/app.ts` | HTTP routes | no gate, limiter always, default set, `/status` |
| `src/composition.ts` | composer | alias on `catalog` |
| `src/context.ts`, `src/rate-limiting.ts` | caller identity, limiter | shared `credentialIdentity`, per-caller key |
| `src/registry.ts` | `/v0/servers` | one profile list |
| tests in `src/` | | per task |
| `README.md`, `AGENTS.md` | docs | one server, profiles, rate limiting |

---

### Task 1: openapi-mcp 0.4.0 and fixtures from data-fair

**Files:**
- Modify: `package.json`, `package-lock.json`, `test/fake-site.ts`, `src/composition.test.ts`
- Create: `scripts/refresh-fixtures.ts`, `test/fixtures/data-fair-agents-index.json`, `test/fixtures/data-fair-skills/workflow.md`
- Regenerate: `test/fixtures/data-fair-api-docs.json`

**Interfaces:**
- Produces: fixtures generated with the data-fair public base URL `http://fixture.test/data-fair`, which `fake-site.ts` rewrites to its own origin; the fake site serves `GET /data-fair/api/v1/agents/skills/<name>.md` and `GET /data-fair/api/v1/catalog/datasets` (same canned body as `/datasets`).

- [ ] **Step 1: Upgrade openapi-mcp**

Run: `npm install @data-fair/openapi-mcp@^0.4.0`
Expected: `package.json` shows `^0.4.0`.

- [ ] **Step 2: Write the fixture script**

`scripts/refresh-fixtures.ts`:

```ts
/**
 * Regenerates the data-fair fixtures of the test site from a data-fair checkout, so they follow
 * data-fair's generators instead of drifting: the root API document, the agents index and the
 * linked skill files. Usage: node scripts/refresh-fixtures.ts ../data-fair
 */
import { mkdirSync, readdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'

const dataFair = path.resolve(process.argv[2] ?? '../data-fair')
process.env.NODE_CONFIG_DIR ??= path.join(dataFair, 'api/config')
process.env.SUPPRESS_NO_CONFIG_WARNING = '1'
const PUBLIC_URL = 'http://fixture.test/data-fair'
const fixtures = path.resolve(import.meta.dirname, '../test/fixtures')

const apiDocs = (await import(path.join(dataFair, 'api/contract/api-docs.ts'))).default
const { agentsIndex } = await import(path.join(dataFair, 'api/contract/agents-index.ts'))

const write = (file: string, value: unknown) => writeFileSync(path.join(fixtures, file), JSON.stringify(value, null, 2) + '\n')
write('data-fair-api-docs.json', apiDocs(PUBLIC_URL))
write('data-fair-agents-index.json', agentsIndex(PUBLIC_URL, { publicUrl: PUBLIC_URL }))

const skills = path.join(fixtures, 'data-fair-skills')
rmSync(skills, { recursive: true, force: true })
mkdirSync(skills)
const source = path.join(dataFair, 'api/contract/agent-skills')
for (const file of readdirSync(source).filter(f => f.endsWith('.md'))) copyFileSync(path.join(source, file), path.join(skills, file))
console.log(`fixtures refreshed from ${dataFair}`)
process.exit(0)
```

- [ ] **Step 3: Generate the fixtures**

Run: `NODE_ENV=test node scripts/refresh-fixtures.ts ~/data-fair/data-fair_chore-structure-openapi-cp`
Expected: `fixtures refreshed from …`; `test/fixtures/data-fair-api-docs.json` declares `x-agent.profiles` `catalog`, `read_datasets` … and a `workflow` skill with `href: agents/skills/workflow.md`; `test/fixtures/data-fair-agents-index.json` has `catalog` as first profile and `explore` with `includes: ["catalog"]`; `test/fixtures/data-fair-skills/workflow.md` exists. Run the command twice and check `git status` shows no change the second time (deterministic output).

- [ ] **Step 4: Serve the fixtures from the fake site**

In `test/fake-site.ts`:

1. After the `let doc = …` line, add:

```ts
  const index = JSON.parse(readFileSync(new URL('./fixtures/data-fair-agents-index.json', import.meta.url), 'utf8'))
  const FIXTURE_ORIGIN = 'http://fixture.test'
```

2. Replace the `/data-fair/api/v1/agents/index.json` line with:

```ts
    if (url.pathname === '/data-fair/api/v1/agents/index.json') {
      // generated against a placeholder origin: the services point at this site
      return json({ ...index, services: index.services.map((s: any) => ({ ...s, openapi: s.openapi.replace(FIXTURE_ORIGIN, origin) })) }, { etag: '"index"' })
    }
    const skill = url.pathname.match(/^\/data-fair\/api\/v1\/agents\/skills\/([a-z0-9-]+)\.md$/)
    if (skill) {
      try {
        const body = readFileSync(new URL(`./fixtures/data-fair-skills/${skill[1]}.md`, import.meta.url), 'utf8')
        res.writeHead(200, { 'content-type': 'text/markdown' }); return res.end(body)
      } catch { res.writeHead(404); return res.end('unknown skill') }
    }
```

3. Replace `if (url.pathname === '/data-fair/api/v1/datasets') {` with:

```ts
    // the account listing and the catalog listing answer the same canned page
    if (url.pathname === '/data-fair/api/v1/datasets' || url.pathname === '/data-fair/api/v1/catalog/datasets') {
```

- [ ] **Step 5: Update the composition tests to the new document**

In `src/composition.test.ts`:

- `it('composes the explore set …')`: keep calling `composition.main(['explore'])` (the alias) and keep the expected tool list unchanged — the catalog tools have the same names; add after the skills assertion:

```ts
    assert.equal(ts.skills[0].error, undefined, 'the linked workflow skill is served by the site')
    assert.deepEqual(composition.composer.services.map(s => [s.id, s.status, s.warnings]), [['data-fair', 'ok', undefined]])
```

- `it('executes through the caller context …')`: add at the end:

```ts
    assert.ok(site.hits.some(h => h.url.startsWith('/data-fair/api/v1/catalog/datasets')), 'the catalog listing is the portal-scoped route')
```

- `it('refreshes: …')`: replace `doc.paths['/datasets'].get['x-agent'].name = 'find_datasets'` with `doc.paths['/catalog/datasets'].get['x-agent'].name = 'find_datasets'`.

- [ ] **Step 6: Run the tests**

Run: `npm run lint && npm run check-types && npm test`
Expected: PASS. If a test still asserts a tool list that changed because of the regenerated document, read the diff: a renamed or added tool in the data-fair document is a fixture fact to update; anything else is a defect.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json scripts/refresh-fixtures.ts test/fake-site.ts test/fixtures src/composition.test.ts
git commit -m "chore: openapi-mcp 0.4.0, test fixtures regenerated from data-fair"
```

---

### Task 2: One server — no mode, no gate, `catalog` by default

**Files:**
- Modify: `config/default.cjs`, `config/custom-environment-variables.cjs`, `config/type/schema.json`, `src/config.ts`, `index.ts`, `src/app.ts`, `src/composition.ts`, `src/context.ts` (doc comment only)
- Rewrite: `src/app.test.ts`; modify `src/config.test.ts`, `src/composition.test.ts`

**Interfaces:**
- Produces: no `config.mode`, no `config.publicProfiles`; `normalizeProfileLists` handles `extraTools.geocodeAddress.profiles` only; `/mcp` serves any declared profile, default `['catalog']`; `alias()` composes `catalog`; the limiter is mounted on `/mcp`, `/datasets/mcp` and `/v0/servers` unconditionally; `/status` refuses proxied callers (`assertReqInternal`) unconditionally.

- [ ] **Step 1: Write the failing tests**

`src/config.test.ts`: in "has the composed server defaults", delete the `mode` and `publicProfiles` assertions and add:

```ts
    assert.equal((config as any).mode, undefined, 'one published server: no mode')
    assert.equal((config as any).publicProfiles, undefined)
```

and change the extraTools assertion to `assert.deepEqual(config.extraTools, { geocodeAddress: { active: true, profiles: ['catalog', 'explore'] } })`. In the three `normalizeProfileLists` tests, drop the `publicProfiles` input and assertions, keeping the geocode ones (e.g. `normalizeProfileLists({ extraTools: { geocodeAddress: { profiles: '["catalog"]' } } })` → `['catalog']`).

`src/composition.test.ts`: replace `profiles: ['explore']` with `profiles: ['catalog', 'explore']` in both configs, and add:

```ts
  it('composes the catalog set, which explore reaches through the index alias', async () => {
    const catalog = await composition.main(['catalog'])
    assert.deepEqual(catalog.tools.map(t => t.name), ['datafair_list_datasets', 'datafair_describe_dataset', 'datafair_search_data', 'datafair_get_field_values', 'datafair_aggregate_data', 'datafair_calculate_metric', 'geocode_address'])
    assert.deepEqual((await composition.main(['explore'])).tools.map(t => t.name), catalog.tools.map(t => t.name))
  })
  it('composes the grid umbrellas with the account tools', async () => {
    const names = (await composition.main(['manage'])).tools.map(t => t.name)
    assert.ok(names.includes('datafair_list_account_datasets'))
    assert.ok(names.includes('datafair_publish_dataset'))
    assert.ok(!names.includes('geocode_address'), 'geocode_address joins catalog sets only')
  })
```

Replace the whole content of `src/app.test.ts` with:

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
  const connect = async (path: string, headers: Record<string, string> = {}) => {
    const client = new Client({ name: 'c', version: '0' }, { versionNegotiation: { mode: 'auto' } })
    await client.connect(new StreamableHTTPClientTransport(new URL(base + path), { requestInit: { headers } }))
    return client
  }
  const names = async (path: string, headers: Record<string, string> = PROXY) => {
    const client = await connect(path, headers)
    try { return (await client.listTools()).tools.map(t => t.name) } finally { await client.close() }
  }
  before(async () => {
    site = await startFakeSite()
    Object.assign(config, { mainSiteUrl: site.origin, refreshInterval: 0, ignoreRateLimiting: 'secret', upstreamProxyHost: `127.0.0.1:${site.port}` })
    const { createDispatcher } = await import('./site-fetch.ts')
    const { createComposition } = await import('./composition.ts')
    const { createApp } = await import('./app.ts')
    const dispatcher = createDispatcher({ mainSiteUrl: site.origin, upstreamProxyHost: config.upstreamProxyHost })
    const composition = await createComposition({ config, dispatcher, mainSiteUrl: site.origin })
    http = createServer(createApp(composition, dispatcher))
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(http.address() as any).port}`
  })
  after(async () => { http.close(); await site.close() })

  it('serves the catalog set by default and calls the requesting site with the caller identity', async () => {
    const client = await connect('/mcp-server/mcp', { ...PROXY, cookie: 'id_token=abc' })
    const { tools } = await client.listTools()
    assert.equal(tools[0].name, 'datafair_list_datasets')
    assert.ok(tools.some(t => t.name === 'geocode_address'))
    const res: any = await client.callTool({ name: 'datafair_list_datasets', arguments: {} })
    assert.match(res.content[0].text, /cookie=id_token=abc/)
    const hit = site.hits.at(-1)!
    assert.equal(hit.headers.referer, 'https://portal.test/mcp')
    assert.equal(hit.headers['x-ignore-rate-limiting'], 'secret')
    assert.equal(hit.headers['x-forwarded-host'], 'portal.test')
    await client.close()
  })
  it('serves explore to clients still configured with it', async () => {
    assert.deepEqual(await names('/mcp-server/mcp?profiles=explore'), await names('/mcp-server/mcp?profiles=catalog'))
  })
  it('serves the grid to any caller: what it may do is data-fair permissions on its identity', async () => {
    const tools = await names('/mcp-server/mcp?profiles=read')
    assert.ok(tools.includes('datafair_list_account_datasets'))
    const both = await names('/mcp-server/mcp?profiles=catalog,read')
    assert.ok(both.includes('datafair_list_datasets') && both.includes('datafair_list_account_datasets'), 'catalog and the grid combine')
  })
  it('refuses an undeclared profile, including when repeated or blank-padded', async () => {
    for (const q of ['profiles=nope', 'profiles=catalog&profiles=nope', 'profiles=%20nope%20']) {
      await assert.rejects(async () => { await names(`/mcp-server/mcp?${q}`) }, q)
    }
  })
  it('serves an in-cluster caller (no forwarded headers) on the main site', async () => {
    const client = await connect('/mcp?profiles=catalog')
    const res: any = await client.callTool({ name: 'datafair_list_datasets', arguments: {} })
    assert.match(res.content[0].text, /Seen by 127\.0\.0\.1:\d+/)
    await client.close()
  })
  it('serves the alias at /mcp-server/datasets/mcp with the seven names, whatever the profiles', async () => {
    for (const path of ['/mcp-server/datasets/mcp', '/mcp-server/datasets/mcp?profiles=manage']) {
      assert.deepEqual(await names(path), ['list_datasets', 'describe_dataset', 'search_data', 'get_field_values', 'aggregate_data', 'calculate_metric', 'geocode_address'], path)
    }
  })
  it('keeps /status for in-cluster callers', async () => {
    assert.equal((await fetch(`${base}/mcp-server/status`, { headers: PROXY })).status, 421)
    const status: any = await (await fetch(`${base}/status`)).json()
    assert.deepEqual(status.services.map((s: any) => s.id), ['data-fair'])
    assert.equal(status.mode, undefined)
  })
  it('answers /v0/servers to proxied and in-cluster callers', async () => {
    const res = await fetch(`${base}/mcp-server/v0/servers`, { headers: PROXY })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('vary'), 'X-Forwarded-Host')
    assert.equal((await fetch(`${base}/mcp-server/v0/servers`)).status, 200)
  })
  it('sets the CORS allow-headers clients need for the session id and the API key', async () => {
    const res = await fetch(`${base}/mcp-server/mcp`, { method: 'OPTIONS' })
    const allow = res.headers.get('access-control-allow-headers') ?? ''
    assert.match(allow, /x-apiKey/)
    assert.match(allow, /Mcp-Session-Id/)
  })
  it('rate-limits anonymous callers per IP', async () => {
    const before = config.defaultLimits.apiRate!.nb
    config.defaultLimits.apiRate!.nb = 1
    try {
      const h = { ...PROXY, 'x-forwarded-for': '198.51.100.9' }
      await fetch(`${base}/mcp-server/v0/servers`, { headers: h })
      assert.equal((await fetch(`${base}/mcp-server/v0/servers`, { headers: h })).status, 429)
    } finally { config.defaultLimits.apiRate!.nb = before }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — the config still has `mode`/`publicProfiles`; "serves the grid" gets 403 (the gate, `mode` defaults to `public`); "keeps /status" reports `mode`. The catalog/explore composition tests may pass already (the regenerated index declares them) — note which in the ledger.

- [ ] **Step 3: Implement**

Configuration:
- `config/default.cjs`: delete `mode: 'public',` and `publicProfiles: ['explore'],`; set `geocodeAddress: { active: true, profiles: ['catalog', 'explore'] }`.
- `config/custom-environment-variables.cjs`: delete the `mode` and `publicProfiles` lines.
- `config/type/schema.json`: remove `"mode"` and `"publicProfiles"` from `required` and from `properties`; set the `default` of `extraTools.geocodeAddress.profiles` to `["catalog", "explore"]`.
- `src/config.ts`: remove the `publicProfiles` handling from `normalizeProfileLists` (type parameter and body) and from its doc comment.
- Run `npm run build-types` (the config type is generated from the schema).

`index.ts`: replace `(process.env.PROFILES ?? 'explore')` with `(process.env.PROFILES ?? 'catalog')`.

`src/composition.ts`: in `alias()`, compose `['catalog']` instead of `['explore']`; doc comment `/** data-fair's catalog operations under their pre-v2 names, plus geocode_address */`.

`src/app.ts`:
- in `profilesOf`, default `['catalog']`, doc comment "the default `catalog` set";
- replace the limiter comment and line with:

```ts
  // One published server (parity: our agents reach it like any other client), limited per
  // caller on every route; see data-fair docs/architecture/agent-rate-limiting.md.
  const limiter = [rateLimitingMiddleware]
```

- delete the `profileGate` middleware and its comment, and remove `profileGate` from the `/mcp` route;
- in the `main` handler, default `['catalog']`;
- in `/v0/servers`, pass `profiles: undefined` for now (Task 4 sets the list);
- in `/status`: `assertReqInternal(req)` unconditionally, and drop `mode` from the JSON.

`src/context.ts`: in the header comment, replace "the mode decides what a request may ask for (app.ts)" with "data-fair's permissions decide what a caller may do".

- [ ] **Step 4: Run the tests**

Run: `npm run lint && npm run check-types && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add config index.ts src
git commit -m "feat!: one published server — no mode, every declared profile, catalog by default"
```

---

### Task 3: The limiter keys on the caller

**Files:**
- Modify: `src/context.ts`, `src/rate-limiting.ts`
- Test: `src/app.test.ts`

**Interfaces:**
- Produces: `credentialIdentity(headers: { cookie?: string | null, apiKey?: string | null }): string | undefined` exported from `src/context.ts` (sha256 hex of the cookie, else of the API key), used by `requestContext` for `identity` and by the limiter; limiter key `identity:<hash>` or `ip:<reqIp>`.

- [ ] **Step 1: Write the failing test**

Append inside `describe('app', …)` in `src/app.test.ts`:

```ts
  it('rate-limits authenticated callers per identity, not per IP', async () => {
    const before = config.defaultLimits.apiRate!.nb
    config.defaultLimits.apiRate!.nb = 1
    try {
      const get = (ip: string, cookie: string) => fetch(`${base}/mcp-server/v0/servers`, { headers: { ...PROXY, 'x-forwarded-for': ip, cookie } })
      assert.equal((await get('198.51.100.20', 'id_token=alice')).status, 200)
      assert.equal((await get('198.51.100.20', 'id_token=bob')).status, 200, 'another caller behind the same IP has its own budget')
      assert.equal((await get('198.51.100.21', 'id_token=alice')).status, 429, 'the same caller from another IP shares its budget')
    } finally { config.defaultLimits.apiRate!.nb = before }
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NODE_ENV=test node --test --test-force-exit --test-name-pattern="per identity" src/app.test.ts`
Expected: FAIL — bob gets 429 (same IP bucket as alice).

- [ ] **Step 3: Implement**

`src/context.ts`, add before `requestContext`:

```ts
/** Who a caller is, as far as its credentials say: a hash of its cookie, else of its API key. */
export function credentialIdentity (credentials: { cookie?: string | null, apiKey?: string | null }): string | undefined {
  const secret = credentials.cookie || credentials.apiKey
  return secret ? createHash('sha256').update(secret).digest('hex') : undefined
}
```

and in `requestContext`, replace `const secret = cookie ?? apiKey` and the `identity:` line with `identity: credentialIdentity({ cookie, apiKey })`.

`src/rate-limiting.ts`:
- import `credentialIdentity` from `./context.ts`;
- add:

```ts
/**
 * The caller a request is counted against: its credential identity when it has one — so callers
 * behind one IP keep their own budgets and a caller moving between IPs keeps one — its IP otherwise.
 */
const callerKey = (req: Request): string => {
  const apiKey = req.headers['x-apikey'] ?? req.headers['x-api-key']
  const identity = credentialIdentity({ cookie: req.headers.cookie, apiKey: Array.isArray(apiKey) ? apiKey[0] : apiKey })
  return identity ? `identity:${identity}` : `ip:${reqIp(req)}`
}
```

- in `consume`, replace `const ip = reqIp(req)` and every `rateLimiters[ip]` with `const key = callerKey(req)` and `rateLimiters[key]`;
- in the middleware's debug line, log `callerKey(req)`;
- update the top comment: load balancing has to hash on a stable caller attribute (the ingress hashes on the client address, which keeps an authenticated caller on one pod as long as its IP is stable).

- [ ] **Step 4: Run the tests**

Run: `npm run lint && npm run check-types && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/context.ts src/rate-limiting.ts src/app.test.ts
git commit -m "feat(rate-limiting): count authenticated callers per identity, anonymous ones per IP"
```

---

### Task 4: One registry

**Files:**
- Modify: `src/registry.ts`, `src/app.ts`
- Test: `src/app.test.ts`

**Interfaces:**
- Produces: `REGISTRY_PROFILES = ['catalog', 'read', 'write', 'manage']` exported from `src/registry.ts`; `registryDocument` lists them in that order, only those the composer declares.

- [ ] **Step 1: Write the failing test**

Append inside `describe('app', …)`:

```ts
  it('lists catalog and the grid umbrellas in the registry, never explore', async () => {
    const reg: any = await (await fetch(`${base}/mcp-server/v0/servers`, { headers: PROXY })).json()
    assert.deepEqual(reg.servers.map((s: any) => s.server.name), ['fr.data-fair/catalog', 'fr.data-fair/read', 'fr.data-fair/write', 'fr.data-fair/manage'])
    assert.equal(reg.servers[0].server.remotes[0].url, 'https://portal.test/mcp-server/mcp?profiles=catalog')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NODE_ENV=test node --test --test-force-exit --test-name-pattern="registry" src/app.test.ts`
Expected: FAIL — every declared profile is listed (index order, `explore` included).

- [ ] **Step 3: Implement**

`src/registry.ts`, add:

```ts
/**
 * What the registry offers: the catalog and the grid umbrellas. The cells stay selectable by name,
 * and the deprecated explore is accepted but not advertised.
 */
export const REGISTRY_PROFILES = ['catalog', 'read', 'write', 'manage']
```

and replace the `.filter(p => !profiles || profiles.includes(p.name))` start of the chain with:

```ts
  const declared = new Map(composer.profiles().map(p => [p.name, p]))
  const servers = REGISTRY_PROFILES
    .map(name => declared.get(name))
    .filter((p): p is NonNullable<typeof p> => !!p)
```

keeping the existing `.map(p => ({ server: …, _meta: … }))`; remove the `profiles` option from `registryDocument`'s parameters and its call in `src/app.ts`.

- [ ] **Step 4: Run the tests**

Run: `npm run lint && npm run check-types && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/registry.ts src/app.ts src/app.test.ts
git commit -m "feat(registry): catalog and the grid umbrellas, one list for every caller"
```

---

### Task 5: Documentation

**Files:**
- Modify: `README.md`, `AGENTS.md`

- [ ] **Step 1: Update the docs**

In `README.md` and `AGENTS.md`:
- one published server: remove every mention of `MODE`, public/internal deployments, `PUBLIC_PROFILES` and the profile gate (env table rows included); every declared profile is available, what a caller may do is data-fair's permissions; the agents service reaches the server like any other client;
- profiles: `catalog` (what a portal publishes, the default) and the `read`/`write`/`manage` grid (data-fair `docs/architecture/agent-profiles.md`); `explore` is a deprecated alias of `catalog` for one release, never listed in `/v0/servers`;
- `/datasets/mcp` serves data-fair's catalog tools under their pre-v2 names;
- `/v0/servers` lists `catalog`, `read`, `write`, `manage`; `/status` is for in-cluster callers;
- env defaults: `PROFILES` `catalog`, `EXTRA_TOOLS_GEOCODE_ADDRESS_PROFILES` `["catalog","explore"]`;
- rate limiting: per caller identity (cookie or API key), per IP for anonymous callers, on every route; `IGNORE_RATE_LIMITING` is temporary — the plan to replace it is data-fair `docs/architecture/agent-rate-limiting.md`;
- fixtures: `node scripts/refresh-fixtures.ts <data-fair checkout>` regenerates them when data-fair's document changes.

Run: `grep -n -i "explore\|MODE\|PUBLIC_PROFILES\|internal mode\|public mode" README.md AGENTS.md`
Expected: every remaining occurrence describes the deprecated alias.

- [ ] **Step 2: Gate and commit**

Run: `npm run lint && npm run check-types && npm test`
Expected: PASS.

```bash
git add README.md AGENTS.md
git commit -m "docs: one published server, the profile vocabulary, per-caller rate limiting"
```
