# Contribution guidelines

## Development environment

Switch to the appropriate nodejs version:

    nvm use

Install dependencies:

    npm install

Run in development mode and stdio transport:

    npx @modelcontextprotocol/inspector -e DATA_FAIR_URL=https://koumoul.com/data-fair npm run dev dataset base-sirene-des-entreprises

## Docker image

Test building and running the docker image:

    docker build -t mcp-dev .
    npx @modelcontextprotocol/inspector docker run -i --rm -e "DATA_FAIR_URL=https://koumoul.com/data-fair" mcp-dev dataset base-sirene-des-entreprises
