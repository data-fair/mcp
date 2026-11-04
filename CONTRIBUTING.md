# Contribution guidelines

## Prerequisites

- Node.js, the version of `.nvmrc` (start zellij from a shell on it: the panes inherit its PATH)
- zellij >= 0.44

## Setup

The dev environment is the shared one of the data-fair services (`@data-fair/lib-dev`): a zellij
session per checkout, described by `.zellij.kdl` and `dev/dev.json`.

1. Install dependencies, then write `.env` (free ports drawn for this checkout) and build the types:
   ```bash
   npm ci
   npx --no df-dev setup
   ```

2. Start the session (the MCP server in HTTP mode and the MCP inspector):
   ```bash
   npm run dev-zellij
   ```
   The footer pane prints the servers' URLs, the inspector pane its own. `npx --no df-dev status` shows
   what runs, `npx --no df-dev logs <pane>` prints a pane's output. The server calls the site of
   `config/development.cjs` (`portalUrl`), override it in a gitignored `config/local-development.cjs`.

3. A new branch in its own worktree, from the main checkout:
   ```bash
   npx --no df-worktree <branch>          # creates ../mcp_<branch>, npm ci + setup
   npx --no df-worktree-delete <branch>   # removes it with its zellij session
   ```
   Branch names: letters, digits, `.`, `_`, `-`, no `/`, and `mcp_<branch>` at most 60 characters.

The stdio transport, outside the session: `TRANSPORT=stdio PORTAL_URL=<site> node index.ts`.

To build the Docker image locally:

    npm run build-image
