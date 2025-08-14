# Contribution guidelines

## Setup

Switch to the appropriate Node.js version:

    nvm use

Install dependencies:

    npm install

## Development

Available scripts in `package.json`:

- `npm run dev-stdio`: run the MCP server in stdio transport (requires building the Docker image)
- `npm run dev-http`: run the MCP server in HTTP transport
- `npm run dev-inspector`: launch the Inspector (uses `dev/resources/inspector.json`)
- `npm run dev-zellij`: launch both Inspector and MCP in HTTP mode using Zellij

To build the Docker image locally:

    npm run build-image
