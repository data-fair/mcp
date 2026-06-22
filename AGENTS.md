# AGENTS.md

## Project overview

MCP (Model Context Protocol) server for the Data Fair ecosystem. Exposes Data Fair datasets to LLM agents via the MCP standard. Two usage modes:

- **Standalone mode**: run via Docker with stdio transport, connects remotely to a Data Fair instance. Requires `PORTAL_URL`. Supports `DATA_FAIR_API_KEY` for authentication and `IGNORE_RATE_LIMITING` to bypass rate limits.
- **Data Fair stack mode**: deployed as a web service alongside Data Fair (available on `/mcp-server` on the same domain). Uses HTTP transport. Portal URL is inferred from reverse-proxy headers.

## Tech stack

- Node.js v24, TypeScript (ESM, no build step — runs `.ts` directly)
- `@modelcontextprotocol/sdk` for the MCP server
- Express 5 for HTTP transport
- Zod for schema validation
- `@data-fair/lib-*` shared libraries (axios, express helpers, types builder)

## Layout

- `index.ts` — entrypoint, picks transport (stdio vs HTTP)
- `src/config.ts` — config loader (uses `config` package + generated types in `config/type/`)
- `src/server.ts` — HTTP server setup
- `src/app.ts` — Express app
- `src/mcp-router-factory.ts` — MCP-to-Express bridge
- `src/mcp-servers/datasets/` — dataset MCP server:
  - `index.ts` — server creation
  - `tools.ts` — `list_datasets`, `describe_dataset`, `search_data`, `aggregate_data`
  - `prompts.ts` — sample prompts (French)
  - `resources.ts` — MCP resources for dataset listing/info

## Key patterns

- Tools return both `structuredContent` (typed output) and `content` (text fallback) per MCP spec
- Origin is resolved from `portalUrl` config or `X-Forwarded-*` headers
- All tools are read-only (`readOnlyHint: true`)
- Datasets API is proxied through the portal URL at `/data-fair/api/v1`
- Tool schemas come from `@data-fair/agent-tools-data-fair`, but each tool file
  (`src/mcp-servers/datasets/tools/*.ts`) re-declares the `inputSchema`/`outputSchema` as Zod —
  see drift warning below

## Schema drift with @data-fair/agent-tools-data-fair

Each tool's Zod `outputSchema` duplicates the shape of the `structuredContent` the shared
module's `formatResult` emits, and is advertised with `additionalProperties: false` — so MCP
hosts reject the whole result on any mismatch (extra or missing key). When the shared dep
changes (caret range, so `npm update` can pull it silently), re-sync the local `outputSchema`s.
`npm test` catches this: `tools.test.ts` calls `listTools()` so the client validates output like
a real host — keep that call, and have fixtures emit the optional fields you want guarded.

## Commands

- `npm run dev-stdio` — dev with stdio transport
- `npm run dev-http` — dev with HTTP transport
- `npm run dev-inspector` — MCP inspector UI
- `npm run quality` — lint + type-check
- `npm run lint-fix` — auto-fix lint issues
