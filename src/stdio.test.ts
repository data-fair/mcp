import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { startFakeSite, type FakeSite } from '../test/fake-site.ts'
import { USER } from '../test/tokens.ts'

describe('stdio', () => {
  let site: FakeSite
  before(async () => { site = await startFakeSite() })
  after(async () => { await site.close() })

  const env = (extra: Record<string, string>) => ({ ...process.env, NODE_ENV: 'development', TRANSPORT: 'stdio', PORTAL_URL: site.origin, REFRESH_INTERVAL: '0', ...extra })

  it('serves the datasets server by default, the API key on every call, no forwarder secret', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['index.ts'],
      // TRUSTED_FORWARDER set on purpose: a deployment sharing config/env with a stack
      // sibling must still not leak it into the document/tool fetches here
      env: env({ DATA_FAIR_API_KEY: 'k', TRUSTED_FORWARDER: 'leaked-secret' })
    })
    const client = new Client({ name: 't', version: '0' })
    await client.connect(transport)
    const { tools } = await client.listTools()
    assert.deepEqual(tools.map(t => t.name).sort(), ['aggregate_data', 'calculate_metric', 'describe_dataset', 'geocode_address', 'get_field_values', 'list_datasets', 'search_data'])
    const res: any = await client.callTool({ name: 'list_datasets', arguments: {} })
    assert.match(res.content[0].text, /apikey=k/)
    assert.ok(site.hits.every(h => h.headers['x-trusted-forwarder'] === undefined))
    await client.close()
  })

  it('serves the seven datasets names with PORTAL_URL only, even when my-session fails', async () => {
    const expected = ['aggregate_data', 'calculate_metric', 'describe_dataset', 'geocode_address', 'get_field_values', 'list_datasets', 'search_data']
    for (const mode of [undefined, 'text', 'null', 503] as const) {
      site.failSession(mode)
      const client = new Client({ name: 't', version: '0' })
      await client.connect(new StdioClientTransport({ command: process.execPath, args: ['index.ts'], env: env({}) }))
      assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), expected, String(mode))
      await client.close()
    }
    site.failSession(undefined)
  })

  it('serves the platform server cut by the session my-session reports', async () => {
    site.setSession({ user: USER, scopes: ['datasets:read'] })
    const transport = new StdioClientTransport({ command: process.execPath, args: ['index.ts'], env: env({ MCP_SERVER: 'platform' }) })
    const client = new Client({ name: 't', version: '0' })
    await client.connect(transport)
    const names = (await client.listTools()).tools.map(t => t.name)
    assert.ok(names.includes('datafair_list_account_datasets'))
    assert.ok(!names.includes('datafair_update_dataset'))
    await client.close()
    site.setSession({})
  })

  it('refuses to start the platform server without credentials', async () => {
    site.setSession({})
    const transport = new StdioClientTransport({ command: process.execPath, args: ['index.ts'], env: env({ MCP_SERVER: 'platform' }), stderr: 'pipe' })
    let stderr = ''
    transport.stderr?.on('data', (d: Buffer) => { stderr += d })
    const closed = new Promise<void>(resolve => { transport.onclose = () => resolve() })
    const client = new Client({ name: 't', version: '0' })
    await assert.rejects(client.connect(transport))
    await closed
    assert.match(stderr, /needs credentials/)
  })
})
