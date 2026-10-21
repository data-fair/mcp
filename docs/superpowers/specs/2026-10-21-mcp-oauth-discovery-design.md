# MCP OAuth discovery and bearer rules (phase 6a, mcp side)

Roadmap: simple-directory `docs/superpowers/plans/2026-10-16-platform-authz-roadmap.md`, phase 6a.
SD side: simple-directory `docs/superpowers/specs/2026-10-19-oauth-authorization-server-design.md`
(branch `feat-oauth-server`, M2 done), section 6 (resources and audiences) and section 13 (what
the mcp needs).

## Intent

External agents (Claude Code, claude.ai connectors, ChatGPT, opencode) must be able to connect to
the platform server (`/mcp`) by the standard MCP authorization flow: hit `/mcp`, get a 401 that
points at protected-resource metadata, find SD's authorization server there, run auth code +
PKCE, come back with an NHI `at+jwt`. SD already issues those tokens. The mcp is missing the
discovery half and the rule that a bearer token on the MCP is an MCP-audience NHI token.

At the same time, an assistant running inside a portal must keep being able to act as the human
by relaying the human's cookie session. That path is not an OAuth token and is not affected.

## Decisions (the user's)

- **Cookie sessions stay accepted on `/mcp`**, human or NHI, as today. The "NHI only" rule
  applies to bearer tokens only. The SD roadmap and spec, which say "the MCP refuses every token
  whose subject is not an NHI", are reworded to say so (see "SD docs").
- **OAuth only on issuer sites.** SD runs an authorization server only on the global main site
  and on account main sites (`issuerOfSite` in SD). A portal on any other site does not offer
  OAuth access to its `/mcp`: no redirection or issuer lookup across sites. Clients there keep
  API keys or cookies.

## What `/mcp` accepts

| Credential | Rule |
| --- | --- |
| cookie session (`id_token` + signature) | verified by lib-express as today, any subject; scopes filter the tools |
| API key (`x-apikey`, `x-api-key`) | passed through unchecked as today; data-fair checks it |
| bearer `at+jwt` | lib-express verifies signature and `aud` contains `<siteUrl>/mcp-server`; the mcp also requires `nhi: 1` in the session state (the user record of an NHI session) |
| nothing | 401 |

- The audience comes from lib-express's existing `audiences` option:
  `session.init(..., { scopeAware: true, audiences: siteUrl => [siteUrl + '/mcp-server'] })`.
  The site URL is the lib's (`reqOrigin + reqSitePathSafe`). The in-cluster stand-in request
  (main site forwarded host and proto) keeps working: its audience is `<mainSite>/mcp-server`.
- A dashboard token (user subject, API audience only) fails the audience check. A token with
  the MCP audience but no `nhi` flag cannot be issued by SD (consent refuses it); the check is
  defence in depth.
- `/datasets/mcp` uses the same session, so the same audience applies there. On that route any
  bearer failure keeps today's behaviour: credentials dropped, caller served anonymously. It
  never answers 401 and never sends `WWW-Authenticate`.

- *My call:* `/mcp-server` is a constant here, as in `ai-catalog.ts`; it must match SD's
  `mcpPath` (`MCP_PATH`), which deployments do not override.
- *My call:* a request with both a bearer and a cookie is judged on the bearer (lib-express
  reads the bearer first and never falls back). A failing bearer is a 401 even with a valid
  cookie: an explicit credential that fails should not be silently replaced. An assistant
  relaying cookies does not add a bearer.
- The agents service relays cookies today (roadmap, "Two tokens per NHI exchange"), so this
  change does not break it.

Consequence to record for phase 4a: the agents service's NHI tokens must be requested with an
MCP `resource` (SD's jwt-bearer grant accepts `resource`); a plain `/nhi-token` token (site
audience only) is refused as a bearer on the MCP. Its cookie path is unaffected.

## The 401 on `/mcp`

RFC 6750 / RFC 9728 shape:

- No credentials: `WWW-Authenticate: Bearer resource_metadata="<url>"`.
- A bearer that does not verify (bad signature, expired, wrong audience, not an NHI):
  `WWW-Authenticate: Bearer error="invalid_token", resource_metadata="<url>"`.
- A cookie that does not verify: 401 as today, with the same header without `error` (the
  client may start OAuth instead).
- `resource_metadata` is present only when the request's site is an issuer site (see below);
  otherwise the header is just `Bearer` (plus `error` when relevant).
- The body stays a short text. Errors that are not credential failures (5xx when the
  directory's keys cannot be read) keep their status and get no header.

## Protected-resource metadata (RFC 9728)

Served by the mcp app at `/.well-known/oauth-protected-resource/mcp`, so publicly at
`<siteUrl>/mcp-server/.well-known/oauth-protected-resource/mcp`. That URL is what
`resource_metadata` names. The host-root path-insertion URL
(`/.well-known/oauth-protected-resource/mcp-server/mcp`) is not owned by the mcp; serving it is
an optional deployment rule, out of scope.

```json
{
  "resource": "<siteUrl>/mcp-server/mcp",
  "authorization_servers": ["<issuer>"],
  "scopes_supported": ["<every scope the platform document's tools declare>"],
  "bearer_methods_supported": ["header"],
  "resource_name": "Data Fair (<site host>)"
}
```

- `resource` is the exact URL clients put in the RFC 8707 `resource` parameter; SD resolves
  any URI under `<siteUrl>/mcp-server/` to the MCP audience.
- `scopes_supported` is the union of the scopes in the live document's tools (the set
  `toolsForScopes` filters on), recomputed when the document changes. `offline_access` is not
  added: SD's discovery lists it and clients append it themselves.
- 404 when the site is not an issuer site.
- No metadata document for `/datasets/mcp` in this iteration: it never sends 401, so no
  client is pointed at OAuth for it.

## Knowing whether a site is an issuer site

The mcp asks SD: `GET <siteUrl>/simple-directory/.well-known/oauth-authorization-server`
through the site dispatcher. 200 with an `issuer` field: the site is an issuer site, and that
`issuer` value goes into `authorization_servers` (it must match exactly what SD's discovery
says, clients compare them). 404 or anything else: not an issuer site.

- *My call:* a 200 counts only if the discovery document can finish an MCP client's flow: it
  has an `authorization_endpoint`, and a `registration_endpoint` or
  `client_id_metadata_document_supported: true`. SD serves discovery as soon as its OAuth
  server is on, even with the code flow or dynamic clients off; advertising such a site would
  send clients into a flow that cannot complete.
- *My call:* site URLs are origins, like everywhere else in the mcp (`siteOriginOf`). A request
  that lib-express sees on a site with a path prefix gets no OAuth discovery (no
  `resource_metadata`, metadata 404): probing the origin would name another site's issuer.
  Path-prefixed issuer sites are unsupported for now.

- Cached per site URL: positive answers 10 minutes, negative ones 1 minute; a fetch error is a
  negative answer and is logged (*builder's call on exact values*).
- SD answers 404 to internal requests (`reqIsInternal`). The probe must reach SD the way a
  public request does (forwarded host and proto of the site), like the other calls the mcp
  makes through `siteFetch`. The builder verifies this against SD's `reqIsInternal`.
- The 401 path awaits the cached lookup; a cold lookup costs one request per site per TTL.

## stdio

Unchanged. stdio has no HTTP 401 and reads its session once at startup.

## SD docs (simple-directory master)

Reword, without changing SD behaviour:

- roadmap, "The MCP refuses every token whose subject is not an NHI": a bearer token on the
  MCP must have the MCP audience and an NHI subject; the MCP still accepts cookie sessions of
  any subject so an in-portal assistant can relay the user's session.
- roadmap phase 6a row: "MCP accepts NHI tokens only" → "MCP accepts NHI bearer tokens only
  (cookie sessions unchanged)"; status of the mcp part once this lands.
- spec section 13, mcp bullets: same precision, plus "OAuth discovery only on issuer sites".

These edits go on SD master as a docs commit (or on `feat-oauth-server` if the user prefers);
the user is asked before committing in that repo.

## Goals, non-goals

- Goal: Claude Code pointed at `https://<issuer site>/mcp-server/mcp` discovers SD, runs the
  flow, and lists the tools its NHI's scopes cover.
- Non-goal: OAuth on non-issuer sites; root `.well-known` rules; `/datasets/mcp` OAuth; step-up
  (`insufficient_scope`) — tools are filtered, so a missing scope means a missing tool.
- Anti-goal: breaking cookie relay by the agents service or an in-portal assistant.

## Tests

- fake site gains an SD discovery route (switchable 200 / 404) and signs tokens with chosen
  `aud` and `nhi` claims (`test/tokens.ts`).
- `/mcp`: no credentials → 401 with `resource_metadata` on an issuer site, without it on a
  non-issuer site; NHI bearer with MCP audience → tools; NHI bearer with site audience only →
  401 `invalid_token`; user bearer with MCP audience → 401 `invalid_token`; user cookie → tools
  (unchanged); API key → unchanged.
- `/datasets/mcp`: dashboard bearer → served anonymously, no header.
- metadata route: issuer site → document with SD's `issuer` and the scope union; non-issuer
  → 404; cache honoured.

## Left to the builder

- File layout (e.g. `src/oauth-discovery.ts`), cache implementation, exact TTLs.
- `resource_name` wording.
