import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Tool, ToolSet } from '@data-fair/openapi-mcp'
import { linksOnSite } from './site-links.ts'

const MAIN = 'https://main.test'
const linkTool = (uri: string): Tool => ({
  name: 'download',
  description: 'd',
  inputSchema: { type: 'object' },
  annotations: {},
  async execute () {
    return { text: `File ds1-raw, not downloaded by this tool: ${uri}`, resourceLink: { uri, name: 'ds1-raw' } }
  }
})
const set = (tool: Tool): ToolSet => ({ profiles: ['read'], instructions: '', tools: [tool], skills: [] })

describe('linksOnSite', () => {
  it('moves a main-site link, and its mention in the text, onto the requesting site', async () => {
    const [tool] = linksOnSite(set(linkTool(`${MAIN}/data-fair/api/v1/datasets/ds1/raw?draft=true`)), 'https://portal.test', MAIN).tools
    const res = await tool.execute({})
    assert.equal(res.resourceLink!.uri, 'https://portal.test/data-fair/api/v1/datasets/ds1/raw?draft=true')
    assert.equal(res.text, 'File ds1-raw, not downloaded by this tool: https://portal.test/data-fair/api/v1/datasets/ds1/raw?draft=true')
  })
  it('keeps a fragment and rewrites from the parsed URL', async () => {
    const [tool] = linksOnSite(set(linkTool(`${MAIN}/a%20b/f.csv?x=1#top`)), 'https://portal.test', MAIN).tools
    assert.equal((await tool.execute({})).resourceLink!.uri, 'https://portal.test/a%20b/f.csv?x=1#top')
  })
  it('leaves a link on another origin alone', async () => {
    const [tool] = linksOnSite(set(linkTool('https://elsewhere.test/f.csv')), 'https://portal.test', MAIN).tools
    assert.equal((await tool.execute({})).resourceLink!.uri, 'https://elsewhere.test/f.csv')
  })
  it('returns the same set on the main site', () => {
    const toolSet = set(linkTool(`${MAIN}/x`))
    assert.equal(linksOnSite(toolSet, MAIN, MAIN), toolSet)
  })
})
