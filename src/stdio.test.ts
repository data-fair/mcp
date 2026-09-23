import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { startFakeSite, type FakeSite } from '../test/fake-site.ts'

describe('stdio', () => {
  let site: FakeSite
  before(async () => { site = await startFakeSite() })
  after(async () => { await site.close() })

  it('serves the composed set for PORTAL_URL with the API key on every call, and never sends the rate-limit bypass secret (spec §4: stdio sends none)', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['index.ts'],
      // IGNORE_RATE_LIMITING set on purpose: a deployment sharing config/env with a stack
      // sibling must still not leak it into the composition's document/tool fetches here
      env: { ...process.env, NODE_ENV: 'development', TRANSPORT: 'stdio', PORTAL_URL: site.origin, DATA_FAIR_API_KEY: 'k', REFRESH_INTERVAL: '0', IGNORE_RATE_LIMITING: 'leaked-secret' }
    })
    const client = new Client({ name: 't', version: '0' })
    await client.connect(transport)
    const { tools } = await client.listTools()
    assert.equal(tools[0].name, 'datafair_list_datasets')
    const res: any = await client.callTool({ name: 'datafair_list_datasets', arguments: {} })
    assert.match(res.content[0].text, /apikey=k/)
    assert.ok(site.hits.every(h => h.headers['x-ignore-rate-limiting'] === undefined))
    await client.close()
  })
})
