import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { load } from '@data-fair/openapi-mcp'
import { DATASETS_TOOLS, datasetsToolSet } from './datasets-server.ts'

const doc = JSON.parse(await readFile(new URL('../test/fixtures/platform-api-docs.json', import.meta.url), 'utf8'))
const platformSet = await load(doc, { lint: 'warn' })

describe('datasets server', () => {
  it('renames the six catalog tools in order', () => {
    const { toolSet, missing } = datasetsToolSet(platformSet)
    assert.deepEqual(toolSet.tools.map(t => t.name), ['list_datasets', 'describe_dataset', 'search_data', 'get_field_values', 'aggregate_data', 'calculate_metric'])
    assert.deepEqual(missing, [])
  })
  it('reports a mapped tool the document no longer has, never invents it', () => {
    const { toolSet, missing } = datasetsToolSet({ ...platformSet, tools: platformSet.tools.filter(t => t.name !== 'datafair_calculate_metric') })
    assert.equal(toolSet.tools.length, 5)
    assert.deepEqual(missing, ['calculate_metric'])
  })
  it('keeps unbound skills and drops those naming tools outside the set', () => {
    const { toolSet } = datasetsToolSet(platformSet)
    assert.ok(toolSet.skills.some(s => s.name === 'datafair-workflow'))
    assert.ok(toolSet.skills.every(s => !s.tools?.length || s.tools.every(t => t in DATASETS_TOOLS)))
  })
  it('renames the tool lists of skills and guides whose tools are all mapped', () => {
    const skill = { name: 's', description: 'd', body: '', digest: '', tools: ['datafair_search_data', 'datafair_list_datasets'] }
    const outside = { ...skill, name: 'o', tools: ['datafair_search_data', 'datafair_update_dataset'] }
    const guides = [{ name: 'g', text: 't', tools: ['datafair_aggregate_data'] }, { name: 'h', text: 't', tools: ['datafair_aggregate_data', 'datafair_export_data'] }]
    const { toolSet } = datasetsToolSet({ ...platformSet, skills: [skill, outside], guides })
    assert.deepEqual(toolSet.skills.map(s => [s.name, s.tools]), [['s', ['search_data', 'list_datasets']]])
    assert.deepEqual(toolSet.guides.map(g => [g.name, g.tools]), [['g', ['aggregate_data']]])
  })
})
