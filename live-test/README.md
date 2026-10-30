# Live test through nhi-proxy

A ready-made directory for checking the published MCP server image against a real platform, with
the identity of a non-human identity (NHI) injected by `@data-fair/nhi-proxy`. Start an agent
(Claude Code or opencode) in this directory: it gets the MCP server configured and, from
`AGENTS.md`, the test protocol to run.

What is tested is the deliverable — the `ghcr.io/data-fair/mcp` image — not the code of this
checkout.

## 1. Run nhi-proxy

In a terminal of its own:

```sh
npx @data-fair/nhi-proxy serve
```

## 2. Fill `.env`

```sh
cp .env.example .env
```

Paste nhi-proxy's `Other tools: HTTPS_PROXY=… NODE_EXTRA_CA_CERTS=…` line in place of the two
lines of the same names (as is, `~` included), and set the platform nhi-proxy logs into, the
server (`DF_MCP_SERVER`) and the image tag. Then, so the first start is not a download:

```sh
docker pull ghcr.io/data-fair/mcp:feat-openapi-mcp
```

Both clients start the server with `run-mcp.sh`, which reads `.env` and runs the image with
`--network host` (nhi-proxy only listens on the host's loopback) and the CA mounted.

## 3. Start an agent here

```sh
claude      # approve the project's `datafair` MCP server if asked
# or
opencode
```

Then ask: "run the live test". The agent follows `AGENTS.md` and writes its report to `reports/`.

The live test runs the platform server (`DF_MCP_SERVER=platform`, passed to the image as `MCP_SERVER`), whose tools are those the NHI's
scopes allow; to test another NHI, log nhi-proxy into it and restart the agent. For the datasets
server, set `DF_MCP_SERVER=datasets` in `.env`. The protocol never calls a write tool without asking you first.

## Troubleshooting

- **Server fails to start:** run `./run-mcp.sh` by hand, its stderr says what is missing or which
  services failed to load.
- **`unable to verify the first certificate`:** `NODE_EXTRA_CA_CERTS` is not the CA of the running
  nhi-proxy.
- **Account tools return 401 or nothing:** the requests do not go through nhi-proxy, or its session
  is not for `DF_PORTAL_URL`; nhi-proxy's own log shows whether it saw them.
