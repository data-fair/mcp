# Catalog Profile (Agent Profiles Rollout Step 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the MCP server from the `explore` profile to the profile vocabulary data-fair now declares: `catalog` by default and in public mode, `catalog` for the `/datasets/mcp` compatibility route, the grid umbrellas in the internal registry, on `@data-fair/openapi-mcp` 0.4.0.

**Architecture:** The server keeps its shape (one composer, a public gate, the alias route, the registry). What changes is configuration defaults, the profile the alias composes, which profiles the registry advertises per mode, and the test site, whose fixtures are regenerated from data-fair's own generators by a script so they follow data-fair instead of drifting.

**Tech Stack:** TypeScript on Node 24, Express 5, `node:test`, `@data-fair/openapi-mcp` 0.4.0.

**Spec:** `~/data-fair/data-fair_chore-structure-openapi-cp/docs/architecture/agent-profiles.md`, section 8 "The `mcp` server" and section 10 (release order).

## Global Constraints

- "Public mode exposes `catalog` only (`PUBLIC_PROFILES` defaults to `["catalog"]`), and `/v0/servers` lists it alone." For one release the public default also accepts the deprecated `explore` (the index declares it as an alias including `catalog`), so clients configured with `?profiles=explore` keep working; the registry never advertises `explore`.
- "Internal mode … accepts any combination of declared profiles; `/v0/servers` lists `catalog` and the umbrellas" (`read`, `write`, `manage`).
- "The compatibility route `/datasets/mcp` composes `catalog` from data-fair with no prefix: the historical names."
- `@data-fair/openapi-mcp` `^0.4.0` (data-fair's document uses views and linked skills, which 0.2.x refuses — spec §10).
- Defaults move from `explore` to `catalog`: `PROFILES` (stdio), the `/mcp` handler's default set, `extraTools.geocodeAddress.profiles`.
- Work on branch `feat-catalog-profile` (from `feat-openapi-mcp`). Gate: `npm run lint && npm run check-types && npm test`.

## Review Focus

1. A client still configured with `/mcp?profiles=explore` in public mode → served the catalog tools, not a 403. (Task 2)
2. The catalog `list_datasets` tool → calls `/data-fair/api/v1/catalog/datasets` on the requesting site, with the caller's identity and the forwarded host. (Task 1)
3. A data-fair document change after the fixtures are regenerated → `scripts/refresh-fixtures.ts` reproduces the fixtures byte for byte from a data-fair checkout. (Task 1)
4. The registry in public mode → `fr.data-fair/catalog` only, never `explore`; in internal mode → `catalog`, `read`, `write`, `manage`, in that order, each only if the index declares it. (Task 3)
5. The linked `workflow` skill → resolved from the site (no warning on the data-fair service status). (Task 1)

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `package.json`, `package-lock.json` | dependencies | `@data-fair/openapi-mcp` `^0.4.0` |
| `scripts/refresh-fixtures.ts` | regenerate test fixtures from a data-fair checkout | create |
| `test/fixtures/data-fair-api-docs.json`, `test/fixtures/data-fair-agents-index.json`, `test/fixtures/data-fair-skills/*.md` | fixtures | regenerate / create |
| `test/fake-site.ts` | test site | serve the index fixture, skill files, `/catalog/datasets` |
| `config/default.cjs`, `config/type/schema.json` | defaults | `catalog` |
| `index.ts` | stdio entry | `PROFILES` default |
| `src/app.ts` | HTTP routes | default set |
| `src/composition.ts` | composer | alias on `catalog` |
| `src/registry.ts` | `/v0/servers` | per-mode profile lists |
| tests in `src/` | | per task |
| `README.md`, `AGENTS.md` | docs | profiles |

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

### Task 2: `catalog` by default, `explore` kept as a deprecated alias

**Files:**
- Modify: `config/default.cjs`, `config/type/schema.json`, `index.ts`, `src/app.ts`, `src/composition.ts`
- Test: `src/app.test.ts`, `src/composition.test.ts`, `src/config.test.ts`

**Interfaces:**
- Produces: `config.publicProfiles` default `['catalog', 'explore']`; `config.extraTools.geocodeAddress.profiles` default `['catalog', 'explore']`; `/mcp` default set `['catalog']`; `alias()` composes `catalog`.

- [ ] **Step 1: Write the failing tests**

In `src/config.test.ts`, replace the default assertions:

```ts
    assert.deepEqual(config.publicProfiles, ['catalog', 'explore'])
```

and

```ts
    assert.deepEqual(config.extraTools, { geocodeAddress: { active: true, profiles: ['catalog', 'explore'] } })
```

In `src/composition.test.ts`, in the `before` and in the "leaves geocode_address out" test, replace `profiles: ['explore']` with `profiles: ['catalog', 'explore']`, and add:

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

In `src/app.test.ts`:
- in the boot `Object.assign(config, { … publicProfiles: ['explore'] … })`, use `publicProfiles: ['catalog', 'explore']`;
- add inside `describe('public mode', …)`:

```ts
    it('serves catalog by default, and explore to clients still configured with it', async () => {
      for (const path of ['/mcp-server/mcp', '/mcp-server/mcp?profiles=catalog', '/mcp-server/mcp?profiles=explore']) {
        const client = await connect(path, PROXY)
        assert.equal((await client.listTools()).tools[0].name, 'datafair_list_datasets', path)
        await client.close()
      }
    })
    it('refuses the grid in public mode', async () => {
      const res = await fetch(`${base}/mcp-server/mcp?profiles=read`, { method: 'POST', headers: { ...PROXY, 'content-type': 'application/json' }, body: '{}' })
      assert.equal(res.status, 403)
    })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL in `src/config.test.ts` (defaults still `['explore']`) and nowhere else. The new composition and app tests pass already — the regenerated index declares `catalog`, `manage` and the `explore` alias, and the server's default set reaches catalog through it. They pin behaviour this task must keep while the defaults move; only the config test is red. Record that in the ledger.

- [ ] **Step 3: Implement**

`config/default.cjs`: `publicProfiles: ['catalog', 'explore'],` and `geocodeAddress: { active: true, profiles: ['catalog', 'explore'] }`.

`config/type/schema.json`: set the `default` of `publicProfiles` to `["catalog", "explore"]` and of `extraTools.geocodeAddress.profiles` to `["catalog", "explore"]`; in the `publicProfiles` description, add: `explore is a deprecated alias of catalog, kept for one release.`

`index.ts`: replace `(process.env.PROFILES ?? 'explore')` with `(process.env.PROFILES ?? 'catalog')`.

`src/app.ts`:
- in `profilesOf`, replace `return list.length ? list : ['explore']` with `return list.length ? list : ['catalog']`, and in its doc comment replace "default `explore` set" with "default `catalog` set";
- in the `main` handler, replace `: ['explore']` with `: ['catalog']`.

`src/composition.ts`: in `alias()`, replace `composer.compose(['explore'], …)` with `composer.compose(['catalog'], …)`, and its doc comment with `/** data-fair's catalog operations under their pre-v2 names, plus geocode_address */`.

- [ ] **Step 4: Run the tests**

Run: `npm run lint && npm run check-types && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add config index.ts src/app.ts src/composition.ts src/app.test.ts src/composition.test.ts src/config.test.ts
git commit -m "feat: catalog is the default and public profile, explore kept as a deprecated alias"
```

---

### Task 3: The registry per mode

**Files:**
- Modify: `src/registry.ts`, `src/app.ts` (the `/v0/servers` route)
- Test: `src/app.test.ts`

**Interfaces:**
- Produces: `registryDocument({ composer, siteOrigin, version, locale, profiles })` where `profiles` is now always given: public mode `config.publicProfiles` minus `DEPRECATED_PROFILES`, internal mode `REGISTRY_PROFILES` (`['catalog', 'read', 'write', 'manage']`); listed in that order, only the ones the composer declares.

- [ ] **Step 1: Write the failing tests**

In `src/app.test.ts`, public mode, replace the two registry assertions of "lists only public profiles in the registry …" with:

```ts
      assert.deepEqual(reg.servers.map((s: any) => s.server.name), ['fr.data-fair/catalog'], 'explore is accepted, never advertised')
      assert.equal(reg.servers[0].server.remotes[0].url, 'https://portal.test/mcp-server/mcp?profiles=catalog')
```

Internal mode, in "serves any declared profile …", replace `assert.ok(reg.servers.length >= 1)` with:

```ts
      assert.deepEqual(reg.servers.map((s: any) => s.server.name), ['fr.data-fair/catalog', 'fr.data-fair/read', 'fr.data-fair/write', 'fr.data-fair/manage'])
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — public mode lists `catalog` and `explore`; internal mode lists all 30 profiles.

- [ ] **Step 3: Implement**

`src/registry.ts`, add before `registryDocument`:

```ts
/** Accepted for a release, never advertised: clients pick from the registry. */
export const DEPRECATED_PROFILES = ['explore']
/** What an internal registry offers: the catalog and the grid umbrellas — the cells stay selectable by name. */
export const REGISTRY_PROFILES = ['catalog', 'read', 'write', 'manage']
```

and replace the `.filter(p => !profiles || profiles.includes(p.name))` chain start with an ordering by the given list:

```ts
  const declared = new Map(composer.profiles().map(p => [p.name, p]))
  const servers = profiles
    .map(name => declared.get(name))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map(p => ({
```

(keep the existing `.map(p => ({ server: …, _meta: … }))` body), and make `profiles: string[]` required in the options type.

`src/app.ts`, in the `/v0/servers` route, replace `profiles: config.mode === 'public' ? config.publicProfiles : undefined` with:

```ts
profiles: config.mode === 'public' ? config.publicProfiles.filter(p => !DEPRECATED_PROFILES.includes(p)) : REGISTRY_PROFILES
```

and import `DEPRECATED_PROFILES, REGISTRY_PROFILES` from `./registry.ts`.

- [ ] **Step 4: Run the tests**

Run: `npm run lint && npm run check-types && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/registry.ts src/app.ts src/app.test.ts
git commit -m "feat(registry): catalog in public mode, catalog and the grid umbrellas internally"
```

---

### Task 4: Documentation

**Files:**
- Modify: `README.md`, `AGENTS.md`

- [ ] **Step 1: Replace the profile vocabulary in the docs**

In `README.md` and `AGENTS.md`, replace every description of `explore` as the profile to compose with the new vocabulary:
- the server composes the profiles of the deployment's index: `catalog` (what a portal publishes, the default and the only public profile), and internally the `read`/`write`/`manage` grid per resource family (see data-fair `docs/architecture/agent-profiles.md`);
- `explore` is a deprecated alias of `catalog`, accepted for one release, never advertised in `/v0/servers`;
- `/datasets/mcp` serves data-fair's catalog tools under their pre-v2 names;
- the env table: `PUBLIC_PROFILES` default `["catalog","explore"]`, `EXTRA_TOOLS_GEOCODE_ADDRESS_PROFILES` default `["catalog","explore"]`, `PROFILES` default `catalog`; examples use `catalog`;
- `/v0/servers`: public mode lists `catalog`; internal mode lists `catalog`, `read`, `write`, `manage`.
- the fixtures: `node scripts/refresh-fixtures.ts <data-fair checkout>` regenerates them when data-fair's document changes.

Run: `grep -n "explore" README.md AGENTS.md`
Expected: every remaining occurrence describes the deprecated alias.

- [ ] **Step 2: Gate and commit**

Run: `npm run lint && npm run check-types && npm test`
Expected: PASS.

```bash
git add README.md AGENTS.md
git commit -m "docs: the catalog profile and the profile vocabulary"
```
