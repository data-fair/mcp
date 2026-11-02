# Registry Skills Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve business-level skills published in the registry (`skill` category, `SKILL.md` plus attached text files) on the platform MCP server, filtered by the caller's active account, and let the agents service read their attached files.

**Architecture:** Four repos change.
- **Registry:** gains a `skill` npm category.
- **openapi-mcp:** gains pure plumbing: a `Skill` may carry `resources`, which its adapter lists and serves.
- **This server:**
  - parses downloaded skill packages;
  - lists the registry per account, with caches and fallbacks;
  - appends the visible skills to the platform tool set for each request.
- **Agents:** `read_skill` reads a skill's attached files, by absolute or relative URI.

**Tech Stack:** Node 24 TypeScript (ESM, no build), `node:test` (mcp, openapi-mcp), Playwright projects (registry, agents), `@data-fair/lib-node-registry`, `yaml`.

**Spec:** `docs/superpowers/specs/2026-11-02-registry-skills-delivery-design.md`

## Global Constraints

- Skill name: `^[a-z0-9]+(-[a-z0-9]+)*$`, at most 64 characters. Description: at most 1024 characters.
- Attached files are text only. The extension decides the MIME type:

  | Extension | MIME type |
  |---|---|
  | `.md` | `text/markdown` |
  | `.json` | `application/json` |
  | `.yaml`, `.yml` | `application/yaml` |
  | `.csv` | `text/csv` |
  | `.txt` | `text/plain` |

  Any other extension is ignored with a warning.
- Limits: 256 KiB per file, 2 MiB per skill, 100 files.
- Never served: `package.json`, `node_modules/`, dotfiles.
- File URIs are `skill://<name>/<path>`. `SKILL.md` comes first in the `skills/list` entry's `resources`.
- `resources/list` lists only each skill's `SKILL.md`.
- The session's **active account** decides visibility, as `type:id`; `department` is ignored. API-key callers get public skills only. Stdio gets no registry skills. The datasets server gets no registry skills.
- An API-doc skill wins a name collision: the registry one is dropped with a warning. API-doc skills are ordered before registry skills. Log a warning when the composed list exceeds 50 skills.
- A registry failure never fails a request: serve the last good listing for that account, else no registry skills, and report it in `/status`.
- openapi-mcp stays pure transformations: no file reading, no registry knowledge.
- A registry skill never changes a tool definition.

## Review Focus

1. **A credential that is the same but has switched account.** A user switches their active account and keeps the same cookie. They should see the new account's skills at once: the cache is keyed by account, never by credential. Task 3 tests this.
2. **A spoofed internal header.** A caller sends `x-mcp-account` itself. It must be stripped, exactly as `x-mcp-scopes` is. Task 3 tests this.
3. **A path that escapes the skill.** A file URI or package entry such as `skill://a/../b/SKILL.md` or `../x.json` must never resolve. openapi-mcp matches URIs exactly (Task 2). The parser rejects `..` segments and absolute paths (Task 4).
4. **A slow or hanging registry.** It must not stall MCP requests. The listing has a 5 s timeout and then falls back (Task 5).
5. **A republished skill.** When `dataUpdatedAt` changes, the next listing serves the new content. Stale content stays only while the listing is cached (Task 5).

---

### Task 1: Registry `skill` category

Repo: `/home/alban/data-fair/registry`.

**Files:**
- Modify:
  - `api/types/artefact/schema.js` (`category.enum`)
  - `api/types/api-key/schema.js` (`allowedCategory.enum`)
  - `api/src/artefacts/router.ts:41-43` (`npmCategories`)
  - `ui/src/utils/categories.ts` (value, labels fr "Compétence d'agent" / en "Agent skill", a colour)
  - `docs/ci-integration.md`
  - `.github/actions/publish-plugin/action.yml` (the `category` input description)
- Test: `tests/artefacts.api.spec.ts`

**Interfaces:**
- Produces: artefacts with `category: 'skill'`, `format: 'npm'`, listable with `?category=skill`.

- [ ] **Step 1: Write the failing test** `uploads and lists an npm artefact in the skill category` in `tests/artefacts.api.spec.ts`, modelled on the existing npm upload test:
  - upload with `category=skill` → 201;
  - make it public;
  - `GET /api/v1/artefacts?category=skill` → the result includes its `_id` with `category === 'skill'`.

  Also assert that a `file` upload with `category=skill` is rejected (400).
- [ ] **Step 2: Run it.** `npm run test-api -- tests/artefacts.api.spec.ts` (needs the dev env, `npm run dev-deps`). Expected: FAIL (category rejected).
- [ ] **Step 3: Add `'skill'`** to the two schema enums and to `npmCategories` only, then run `npm run build-types`. Update the UI categories, the docs and the action description.
- [ ] **Step 4: Run** `npm run test-api -- tests/artefacts.api.spec.ts`, then `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: skill artefact category`.

### Task 2: openapi-mcp — skills carry attached resources

Repo: `/home/alban/data-fair/openapi-mcp`.

**Files:**
- Modify:
  - `src/types.ts:210-221` (`Skill`)
  - `src/skills.ts` (`SkillFile` gains its resources)
  - `src/adapters/server.ts:45-104` (`skillEntry`, `resources/read`)
  - `src/index.ts` (export `SkillResource`)
  - `docs/x-agent.md`, a short note that a caller may append skills with `resources`
- Test: `test/adapters-mcp.test.ts`

**Interfaces:**
- Produces:
  - `interface SkillResource { path: string, mimeType: string, text: string }`
  - `Skill.resources?: SkillResource[]`

  The adapter serves each resource at `skill://<name>/<path>`, with `digest` (`sha256:` over the UTF-8 bytes) and `size` (bytes).

- [ ] **Step 1: Write the failing test** `serves a skill's attached resources` in `test/adapters-mcp.test.ts`. Use a tool set with one skill `{name: 'obs', …, resources: [{path: 'templates/page.json', mimeType: 'application/json', text: '{"a":1}'}]}`. Assert:
  - `skills/list` entry `resources.map(r => r.uri)` deep-equals `['skill://obs/SKILL.md', 'skill://obs/templates/page.json']`;
  - the second has `size === 7` and a digest equal to sha256 of `'{"a":1}'`;
  - `skills/get` returns the same entry;
  - `resources/read` of `skill://obs/templates/page.json` returns `{uri, mimeType: 'application/json', text: '{"a":1}'}`;
  - `resources/list` lists only `skill://obs/SKILL.md`;
  - `resources/read` of `skill://obs/../obs/SKILL.md` and of `skill://obs/templates/missing.json` fails with INVALID_PARAMS.
- [ ] **Step 2: Run** `node --test test/adapters-mcp.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `renderSkillFile` also renders the resources (uri, mimeType, text, digest, size).
  - `skillEntry` appends them after `SKILL.md`.
  - `resources/read` looks URIs up in an exact-match map of every skill's resources.
  - A skill with `error` keeps its current behaviour.
- [ ] **Step 4: Run** `npm test && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: skills may carry attached resources`, then bump the minor version (0.9.0) and release, following the repo's usual release flow. Tasks 4–6 need the released version. Until it is published, use `npm link` locally.

### Task 3: This server — the caller's active account

Repo: this one.

**Files:**
- Modify: `src/scopes.ts`
- Test: `src/scopes.test.ts`

**Interfaces:**
- Produces:
  - `export const ACCOUNT_HEADER = 'x-mcp-account'`
  - `export interface CallerAccount { type: 'user' | 'organization', id: string }`
  - `export function accountOf (request: Request | undefined): CallerAccount | undefined`

- [ ] **Step 1: Write failing tests** in `src/scopes.test.ts`, reusing that file's session fixtures:
  - `credentials sets the active account`: a cookie session whose active account is `{type: 'organization', id: 'commune-x', department: 'd1'}`, then `accountOf` returns exactly `{type: 'organization', id: 'commune-x'}`;
  - `the same cookie switched to another account reads the new account`;
  - `a caller-sent x-mcp-account header is stripped`: no credentials plus the header gives `accountOf` → `undefined`;
  - `an API key caller has no account`.
- [ ] **Step 2: Run** `NODE_ENV=test node --test src/scopes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `credentials`:
  - delete `ACCOUNT_HEADER` next to `SCOPES_HEADER` at the start;
  - after a verified session, set it to `JSON.stringify({type, id})` from `state.account`.

  `accountOf` parses it.
- [ ] **Step 4: Run** the file again. Expected: PASS.
- [ ] **Step 5: Commit** `feat: carry the caller's active account to the handler`.

### Task 4: This server — skill package parser

**Files:**
- Create: `src/registry-skills.ts`
- Create: `test/skill-packages.ts` (helper writing a package dir into a temp folder)
- Test: `src/registry-skills.test.ts`
- Modify: `package.json` (add `yaml`)

**Interfaces:**
- Consumes: `Skill`, `SkillResource` from `@data-fair/openapi-mcp` (Task 2).
- Produces:
  - `export const SKILL_LIMITS = { fileSize: 256 * 1024, total: 2 * 1024 * 1024, files: 100 }`
  - `export function parseSkillPackage (dir: string): Promise<{ skill: Skill, warnings: string[] } | { error: string }>`

  The `Skill` it returns has:
  - `name` and `description` from the `SKILL.md` frontmatter;
  - `body` = `SKILL.md` without its frontmatter;
  - `digest` = `sha256:` over the body;
  - `tools` from `metadata.tools` split on whitespace;
  - `resources` = every other accepted file, as a path relative to `dir` with `/` separators, sorted.
- Also produces, in `test/skill-packages.ts`: `writeSkillPackage(files: Record<string, string>): Promise<string>`, which returns the dir.

- [ ] **Step 1: Write failing tests** in `src/registry-skills.test.ts`:
  - a valid package (`SKILL.md` with `name: territorial-observatory`, a description, `metadata: {tools: "datafair_list_datasets datafair_create_dataset"}`; plus `templates/page.json`, `examples/a.csv`, `package.json`, `.npmignore`, `node_modules/x/index.js`, `logo.png`). It yields:
    - `tools` with the two names;
    - resource paths `['examples/a.csv', 'templates/page.json']` with MIME types `text/csv` and `application/json`;
    - a warning naming `logo.png`.
  - Each of these yields `{error}`:
    - no `SKILL.md`;
    - name `Bad_Name`;
    - a name of 65 characters;
    - a description of 1025 characters;
    - a 256 KiB + 1 byte file;
    - files totalling more than 2 MiB;
    - 101 files;
    - a `.json` file that isn't valid UTF-8.
  - A symlink pointing outside `dir` is ignored with a warning.
- [ ] **Step 2: Run** `NODE_ENV=test node --test src/registry-skills.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `parseSkillPackage`.**
  - Walk `dir` recursively without following symlinks.
  - Read the frontmatter with `yaml`.
  - Validate UTF-8 with `new TextDecoder('utf-8', { fatal: true })`.
- [ ] **Step 4: Run** the file again. Expected: PASS.
- [ ] **Step 5: Commit** `feat: parse registry skill packages`.

### Task 5: This server — registry listing and content caches

**Files:**
- Create: `src/registry.ts`
- Create: `test/fake-registry.ts`
- Test: `src/registry.test.ts`
- Modify: `package.json` (add `@data-fair/lib-node-registry`)

**Interfaces:**
- Consumes:
  - `CallerAccount` (Task 3);
  - `parseSkillPackage` (Task 4);
  - `ensureArtefact` from `@data-fair/lib-node-registry`. Its `path` is the extracted package root; check whether the `package/` prefix is already stripped.
- Produces:

  ```ts
  export interface RegistrySkillsOptions { url: string, secretKey: string, listingTtl: number, cacheDir: string, timeoutMs?: number /* default 5000 */ }
  export interface RegistrySkills {
    skillsFor (account: CallerAccount | undefined): Promise<Skill[]>
    status (): { error?: string, invalid: { id: string, error: string }[] }
  }
  export function createRegistrySkills (options: RegistrySkillsOptions): RegistrySkills
  ```

  In `test/fake-registry.ts`:

  ```ts
  createFakeRegistry(): Promise<{
    url, secretKey,
    publish(id, files, visibility: { public?: boolean, privateAccess?: CallerAccount[] }),
    fail(status | 'hang'),
    hits,
    close
  }>
  ```

  It serves:
  - `GET /api/v1/artefacts?category=skill`, filtered like the registry: anonymous means public only; secret plus `x-account` means public or `privateAccess` match;
  - `GET /api/v1/artefacts/:id/download` as a tarball with `If-Modified-Since` support (build tarballs with `tar`).

**Behaviour:**
- **Listing.**
  - Called with the secret and `x-account` (JSON `{type, id}`) for an account, anonymously for `undefined`.
  - Cached per key `type:id` or `public` for `listingTtl` seconds.
  - The in-flight promise is shared.
  - Failures are not cached; the last good listing for the key is served instead.
- **Content.**
  - Cached per `id@dataUpdatedAt` as a promise.
  - Downloaded with `ensureArtefact` without `account`.
  - Invalid packages are recorded in `status().invalid` and skipped.

- [ ] **Step 1: Write failing tests** in `src/registry.test.ts`:
  - **`public and private visibility`:** the account named in `privateAccess` sees both skills, another account and `undefined` see only the public one.
  - **`no cross-account leak under concurrency`:** `Promise.all` of `skillsFor(A)` and `skillsFor(B)` returns each its own set.
  - **`listing reused within listingTtl`:** two calls make one listing hit.
  - **`republished skill served after the listing expires`:** with `listingTtl` set to 0, publish v2 with a new `dataUpdatedAt`; the next call returns v2's body.
  - **`registry down`:**
    - after a good listing → the same skills, and `status().error` is set;
    - with no prior listing → `[]`.
  - **`registry hanging`:** with `timeoutMs: 100`, it resolves `[]` within 1 s.
  - **`invalid package skipped`:** the call returns the valid skills, and `status().invalid` names the bad id.
- [ ] **Step 2: Run** `NODE_ENV=test node --test src/registry.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `createRegistrySkills` in `src/registry.ts`. Use `AbortSignal.timeout(timeoutMs)` on the listing fetch.
- [ ] **Step 4: Run** the file again. Expected: PASS.
- [ ] **Step 5: Commit** `feat: per-account registry skills with caches and fallbacks`.

### Task 6: This server — composition, config, status

**Files:**
- Modify:
  - `config/default.cjs`
  - `config/type/schema.json`
  - `config/custom-environment-variables.cjs` (`REGISTRY_URL`, `REGISTRY_SECRET`, `REGISTRY_LISTING_TTL`, `REGISTRY_CACHE_DIR`)
  - `config/test.cjs`
  - `src/app.ts` (the `/mcp` handler and `/status`)
  - `src/server.ts` (create `RegistrySkills` when `config.registry.url` is set)
  - `AGENTS.md` (Layout entries for `src/registry.ts` and `src/registry-skills.ts`, one Key patterns line)
- Create: `src/compose-skills.ts`
- Test: `src/compose-skills.test.ts`, `src/app.test.ts`

**Interfaces:**
- Consumes: `RegistrySkills` (Task 5), `accountOf` (Task 3).
- Produces: `export function composeSkills (base: ToolSet, registry: Skill[]): ToolSet`. Here `base` is the already scope-filtered platform set, so "granted" means present in `base.tools`.
  - Drop the unknown names from each registry skill's `tools`.
  - If a skill had tools and none remain, drop it.
  - Drop a skill whose name collides with one in `base.skills`, with a warning.
  - Append the rest after `base.skills`.
  - Warn when the total exceeds 50.

Config:

```js
registry: { url: undefined, secretKey: undefined, listingTtl: 60, cacheDir: '/tmp/skills' }
```

- [ ] **Step 1: Write failing tests.**

  In `src/compose-skills.test.ts`:
  - a skill with no tools is kept;
  - a skill whose tools are all out of `base.tools` is dropped;
  - a skill with one granted tool and one unknown tool is kept, with `tools` cut to the granted one;
  - a name collision keeps the API-doc skill;
  - API-doc skills come first.

  In `src/app.test.ts`, using `fake-site` and `fake-registry`:
  - `/mcp` with a cookie whose active account is in `privateAccess` lists the private skill in `skills/list`, with its attached file, and `resources/read` returns the file;
  - an API-key caller sees only public skills;
  - `/datasets/mcp` lists no registry skill;
  - with the registry stopped, `/mcp` still answers with the API-doc skills;
  - `/status` includes `registry: { error?, invalid }`.
- [ ] **Step 2: Run** `NODE_ENV=test node --test src/compose-skills.test.ts src/app.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `/mcp`'s source becomes async:
    ```ts
    request => onSite(request)(composeSkills(platform.platform(scopesOf(request)), registry ? await registry.skillsFor(accountOf(request)) : []))
    ```
  - `createApp` takes an optional `registry?: RegistrySkills`.
  - Stdio passes none.
- [ ] **Step 4: Run** `npm run quality`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: serve registry skills on the platform server`.

### Task 7: Agents — `read_skill` reads attached files

Repo: `/home/alban/data-fair/agents`.

**Files:**
- Modify:
  - `api/src/mcp-servers/guides.ts` (`GuideSkill`, `skillsFromList`, `skillEnvelope` caller)
  - `api/src/mcp-servers/skills-client.ts` (`readServerSkill`)
  - `api/src/mcp-servers/read-skill.ts` (server resolution, input description)
  - `tests/support/mcp-fixture.ts` (add a skill with one attached file)
  - `docs/architecture/mcp-tools.md` ("Server instructions and skills")
- Test: `tests/features/mcp-guides/read-skill.unit.spec.ts`, `tests/features/mcp-guides/guides.unit.spec.ts`

**Interfaces:**
- Produces:
  - `GuideSkill.resources?: string[]`: the entry's resource URIs other than its `SKILL.md`.
  - `export function resolveSkillUri (skills: GuideSkill[], uri: string): string`, in `skills-client.ts`:
    - an absolute `skill://` URI is returned as is;
    - a relative path resolves to the unique `skill://<name>/<path>` among the listed resources;
    - zero or several matches throw an error naming the candidates.

**Behaviour:**
- `readServerSkill` accepts a URI that is a listed skill or a listed resource.
- For an unlisted `skill://<name>/<path>`, it calls `skills/get` on `skill://<name>/SKILL.md` and reads only if `<uri>` is among the returned `resources`.
- `read_skill`:
  - accepts relative paths (the `skill://` prefix check moves after resolution);
  - when it returns a `SKILL.md` with attached files, it appends `Attached files:` and one URI per line inside the envelope;
  - its description mentions attached files.
- The existing body bound (`GUIDE_LIMITS.skillBody`) applies to files too.

- [ ] **Step 1: Write failing tests:**
  - `skillsFromList keeps resource URIs`;
  - `resolveSkillUri`: relative unique → absolute; relative ambiguous → error listing both; relative unknown → error;
  - `read_skill reads an attached file by absolute and by relative URI`;
  - `an unlisted file URI is confirmed through skills/get`, and is refused when it is not among that skill's resources;
  - `reading a SKILL.md lists its attached files`.
- [ ] **Step 2: Run** `npx playwright test --project=unit tests/features/mcp-guides/`. Expected: FAIL.
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4: Run** `npm run test-unit`, then `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: read_skill reads a skill's attached files`.

## Order

- Tasks 1, 2 and 7 are independent.
- Tasks 4–6 need Task 2's release, or `npm link` during development. Task 3 does not.
- End-to-end, once everything is deployed: publish a sample skill in the dev registry and check it from the agents dev stack. The validation-method project takes it from there.
