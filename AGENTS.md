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
  - `tools.ts` — `search_datasets`, `describe_dataset`, `search_data`, `aggregate_data`
  - `prompts.ts` — sample prompts (French)
  - `resources.ts` — MCP resources for dataset listing/info

## Key patterns

- Tools return both `structuredContent` (typed output) and `content` (text fallback) per MCP spec
- Origin is resolved from `portalUrl` config or `X-Forwarded-*` headers
- All tools are read-only (`readOnlyHint: true`)
- Datasets API is proxied through the portal URL at `/data-fair/api/v1`

## Commands

- `npm run dev-stdio` — dev with stdio transport
- `npm run dev-http` — dev with HTTP transport
- `npm run dev-inspector` — MCP inspector UI
- `npm run quality` — lint + type-check
- `npm run lint-fix` — auto-fix lint issues
