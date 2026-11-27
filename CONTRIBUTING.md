# Contribution guidelines

## Prerequisites

- Node.js, the version of `.nvmrc`

## Setup

1. Install dependencies and build the types:
   ```bash
   npm ci
   npm run dev-setup
   ```

2. Start the MCP server in HTTP mode (`npm run dev:api`, port 5750), the MCP inspector
   (`npm run dev:inspector`, port 5752), or both (`npm run dev`). The server calls the site of
   `config/development.cjs` (`portalUrl`): override it with `PORTAL_URL` or a gitignored
   `config/local-development.cjs`. Default ports are in `dev/default.env`, a gitignored `.env` or the
   environment overrides them.

The stdio transport: `TRANSPORT=stdio PORTAL_URL=<site> node index.ts`.

To build the Docker image locally:

    npm run build-image
