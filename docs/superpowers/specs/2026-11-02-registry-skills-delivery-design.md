# Registry skills delivery — design

Date: 2026-11-02. Status: draft for review.

## Intent

Data Fair wants to give its agents business-level skills: playbooks for whole tasks such as
"create a territorial observatory for my commune's new open data portal". A skill like that
carries know-how the agent cannot get from the API alone:
- which reference datasets to look for;
- which indicators matter;
- what to ask the user;
- example page and dashboard configurations.

So a skill is a `SKILL.md` plus attached files (JSON templates, examples, reference lists).

Skills are developed, tested, vetted and released one by one, like processings and catalogs
plugins. Access is per account, and paid plans are handled by curating visibility. Two kinds of
agents consume them, both through this MCP server:
- our own agents (the `~/data-fair/agents` service);
- external MCP clients.

This document covers **delivery only**: packaging, the registry, composition in this server, and
reading the files. How skills are written and validated (simulation, judging, release gates) is a
separate project. It is research-first and is not decided here.

## Goals

- A skill is a registry artefact in a new `skill` category, published by CI like other plugins.
- Visibility uses the registry's existing settings (`public`, `privateAccess` per user or
  organization), curated by a superadmin. That is the whole entitlement model, plans included.
- The platform server (`/mcp`, stdio `platform`) serves, per request:
  - the API-doc skills, as today;
  - the registry skills visible to the caller's account.
- A skill's attached files are listed in its `skills/list` entry and readable with
  `resources/read`.
- The agents service can read those files through `read_skill`.

## Non-goals

- How skills are authored, evaluated and gated for release (the follow-up project).
- Deciding which skills stay in the API doc. The data-exploration `workflow` skill stays where it
  is for now.
- Version history or semver resolution. A skill follows the registry's model: one mutable
  tarball per artefact id, with the major version in the id.
- Localized variants of a registry skill. A package is in one language.
- Executable code in a skill. Packages are read as text, never imported.
- Registry skills on the datasets server (`/datasets/mcp`).

## Anti-goals

These would be failures even if everything else worked:

- An account seeing a skill it isn't entitled to, for example through a cache keyed wrongly
  or shared between accounts.
- A registry outage or one broken package taking the MCP server down, or emptying the API-doc
  skills.
- A registry skill changing tool definitions. Tools stay generated from the platform document
  only.

## Current state (as read on 2026-11-02)

- **openapi-mcp.** A `Skill` is `{name, description, body, digest, error?, tools?}`.
  - `toMcpServer` serves each skill as `skill://<name>/SKILL.md`.
  - The `skills/list` entry's `resources` lists only that file.
  - `resources/read` serves only `SKILL.md` URIs (`src/adapters/server.ts`).
  - `toolsForScopes` keeps a skill that names no tools, or names at least one granted tool.
  - `createMcpHttpHandler` accepts an async `(request) => ToolSet`.
- **This server.** `platform.platform(scopes)` builds the tool set for each request from the live
  document (`src/platform.ts`, `src/app.ts`).
  - Cookie and bearer callers are verified by lib-express's session, which carries their account.
  - API-key callers have no session here: data-fair checks each call.
- **Registry.** Categories are a hard-coded enum in five places:
  - `api/types/artefact/schema.js`;
  - `api/types/api-key/schema.js`;
  - the `npmCategories`/`fileCategories` lists in `api/src/artefacts/router.ts`;
  - `ui/src/utils/categories.ts`;
  - the publish action plus `docs/ci-integration.md`.

  Access:
  - The internal secret with `x-account` acts as that account: listings are filtered by
    `public`/`privateAccess`, and no access grant is needed.
  - The internal secret without `x-account` bypasses everything.
  - `@data-fair/lib-node-registry`'s `ensureArtefact` downloads and extracts into a cache dir
    with a conditional GET.
- **Agents.** `read_skill` reads any `skill://` URI through `readServerSkill`
  (`api/src/mcp-servers/skills-client.ts`).
  - A URI not in the listing is first confirmed with `skills/get`. That fails for anything other
    than a `SKILL.md` URI, so attached files are unreachable today.
  - Only text content is accepted.

## Design

### 1. The skill package

A skill package is an npm package published with the registry's existing publish action, in
category `skill`:

```
package.json        name (e.g. @data-fair/skill-territorial-observatory), version
SKILL.md            frontmatter: name, description, optional metadata.tools; markdown body
templates/…json     any attached files, referenced from SKILL.md by relative path
examples/…
```

- **Name.** `name` follows the Agent Skills pattern (`^[a-z0-9]+(-[a-z0-9]+)*$`, at most 64
  characters).
- **Description.** At most 1024 characters. It is what agents read to decide whether the skill
  applies.
- **Tools.** `metadata.tools` is a space-separated list of **platform server tool names**
  (`datafair_…`), with the same meaning as for API-doc skills: the skill is hidden when the
  caller's scopes grant none of them.
- **File types** (my call). Text only: `.md`, `.json`, `.yaml`/`.yml`, `.csv`, `.txt`. Anything
  else is ignored with a warning.
- **Size limits** (my call): 256 KiB per file, 2 MiB per skill, 100 files.
- **Ignored entries.** `package.json`, `node_modules/`, and dotfiles are not served.
- **Pointing to other skills.** A skill refers to lower-level skills by name in its body (e.g.
  "for page layout, read the `datafair-…` skill") instead of copying their content.

### 2. Registry: a `skill` category

- Add `skill` to the five enum locations above, as an npm-format category, with fr/en labels.
- No registry-side validation of the package's contents in this iteration (my call). Validation
  happens in the skill repo's CI and when this server loads the package (§4).
- Publishing works as for other plugins:
  - CI on a `v*` tag, behind a reviewed `production` environment;
  - a new artefact starts hidden;
  - a superadmin exposes it with `public` or `privateAccess`.

### 3. openapi-mcp: skills with files

Extend `Skill` with optional files:

```ts
interface SkillFileEntry { path: string, mimeType: string, text: string, digest: string, size: number }
interface Skill { /* … */ files?: SkillFileEntry[] }
```

- **`skills/list` / `skills/get`.** The entry's `resources` lists `SKILL.md` first, then each
  file as `skill://<name>/<path>`, each with its digest and size.
- **`resources/read`.** Serves those file URIs too, with their MIME type.
- **`resources/list`.** Keeps listing only the `SKILL.md` of each skill (my call), so the
  listing isn't flooded.
- **Shared parser.** Add a helper `skillFromFiles(files: {path, text}[]): Skill` that:
  - parses `SKILL.md`'s frontmatter;
  - applies the name and description rules;
  - keeps the attached files.

  It lives in openapi-mcp (my call) so a skill repo's lint can reuse the exact rules the server
  applies.
- **Unchanged.** `toolsForScopes` and API-doc skill loading do not change.

### 4. This server: per-account composition

New config `registry` (off when `url` is unset):

```js
registry: {
  url: undefined,           // in-cluster, e.g. http://registry:8080
  secretKey: undefined,     // the registry's internal secret
  listingTtl: 60,           // seconds a per-account listing is reused
  cacheDir: '/tmp/skills'
}
```

**Per request (platform server only):**

1. **Account.**
   - The session's **active account** decides (`type`, `id`), not the organization owning the
     portal being served (decided on 2026-11-02). It is usually the same: users switch to the
     account whose resources they work on. External contributors working on someone else's
     portal are rare, and they see their own account's skills.
   - `department` is ignored: the registry's `privateAccess` matches `type` and `id` only, so
     the listing cache is keyed `type:id` (or `public`).
   - API-key callers: **public registry skills only** (my call). It is safe and simple.
     Resolving an API key's owner can follow later.
   - **Stdio gets no registry skills** in this iteration (my call). Standalone stdio runs outside
     the cluster, so it can reach neither the in-cluster registry URL nor its internal secret, and
     the secret must never ship to end users.
2. **Listing.** `GET <url>/api/v1/artefacts?category=skill&size=100`, with `x-secret-key` and
   `x-account`.
   - The registry filters it by visibility.
   - The listing is cached per account key for `listingTtl`.
   - The in-flight promise is shared, so concurrent requests make one call.
   - **Public-only listing:** the account-less internal secret bypasses every check, so this case
     cannot simply leave out `x-account`. It is listed anonymously instead (no secret), which the
     registry already answers with public artefacts only.
3. **Content.**
   - Each listed artefact is fetched with `ensureArtefact` without `account`. The listing already
     did the gating.
   - Its files are parsed with `skillFromFiles`.
   - The parsed skill is cached in memory under `(id, dataUpdatedAt)`. The content cache is
     shared across accounts; only the listing is per account.
4. **Composition.**
   - Start from `platform.platform(scopes)` (API-doc skills already scope-filtered).
   - Add the registry skills.
   - Apply the same tools rule to the registry skills.
   - **Name collision:** the API-doc skill wins, and the registry one is dropped with a warning
     (my call).

**Failures:**
- **Registry unreachable or erroring.** Serve the last good listing for that account if one is
  cached. Otherwise serve no registry skills. Report the error in `/status`. Never fail the
  request.
- **Invalid package** (no `SKILL.md`, bad name, over the limits): skip it, log it, list it in
  `/status`.

**Out of scope here:**
- **Datasets server:** unchanged, no registry skills.
- **Notifications:** none for registry changes. Clients see changes within the listing TTL and
  the skills cache hint.

### 5. Agents: reading attached files

In `readServerSkill`/`read_skill` (`agents/api/src/mcp-servers/`):

- Keep each listed skill's `resources` URIs in `GuideSkill`, from the `skills/list` entry.
- Accept a URI that is one of a listed skill's resources. For a URI not in the listing, confirm
  its parent skill with `skills/get` on `skill://<name>/SKILL.md`, then check that the file is
  among that skill's resources.
- Accept a relative path (`templates/page.json`), since the model is likely to pass paths the
  way `SKILL.md` writes them. It resolves only when exactly one skill listed on that server has
  a file at that path; otherwise the error names the candidate URIs (my call). This keeps
  `read_skill`'s input schema unchanged.
- The skill envelope returned for a `SKILL.md` ends with the list of its attached files' URIs,
  so the model knows what it can read next.
- Update `read_skill`'s description to mention attached files.

### 6. How many skills

The agents service keeps at most 50 skills per server (`GUIDE_LIMITS.skills` in
`agents/api/src/mcp-servers/guides.ts`), and every listed description goes into each turn's
Skills index. Registry skills are expected to stay few for the foreseeable future, so this
iteration documents that cap rather than designing around it (my call).

This server orders API-doc skills before registry skills, so a cut never drops the low-level
skills. It logs a warning when a caller's composed list exceeds 50.

## Testing

- **openapi-mcp.** Unit tests for:
  - `skillFromFiles` (frontmatter, rules, limits, ignored entries);
  - the server handlers serving file resources, digests included.
- **This server.** A fake registry `http.Server`, next to `test/fake-site.ts`. Cases:
  - per-account listings, including no cross-account leak through the cache;
  - public-only for API keys;
  - the scope rule on registry skills;
  - name collision;
  - registry down, with and without a cached listing;
  - an invalid package.
- **Agents.** Unit tests for `read_skill` reading attached files, by absolute and by relative
  URI, plus the existing fixture extended with a skill that has a file.

## Left to the builder

- Exact cache eviction for the content cache and `cacheDir`.
- The `/status` shape for registry state.
- The order of work across the four repos. Note that the openapi-mcp change must be released
  before this server can use it.
