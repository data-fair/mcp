import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Skill, Tool, ToolSet } from '@data-fair/openapi-mcp'
import { composeSkills } from './compose-skills.ts'

const skill = (name: string, tools?: string[]): Skill => ({ name, description: name, body: name, digest: 'sha256:' + name, ...(tools && { tools }) })
const base = (...names: string[]): ToolSet => ({ tools: [{ name: 'datafair_a' }, { name: 'datafair_b' }] as Tool[], skills: names.map(n => skill(n)), guides: [] })

describe('composeSkills', () => {
  it('keeps a skill with no tools', () => {
    assert.deepEqual(composeSkills(base(), [skill('free')]).skills.map(s => s.name), ['free'])
  })
  it('drops a skill whose tools are all out of the set', () => {
    assert.deepEqual(composeSkills(base(), [skill('gone', ['datafair_x'])]).skills, [])
  })
  it('cuts the unknown tools of a kept skill', () => {
    const { skills } = composeSkills(base(), [skill('mixed', ['datafair_a', 'datafair_x'])])
    assert.deepEqual(skills[0].tools, ['datafair_a'])
  })
  it('keeps the API-doc skill on a name collision', () => {
    const set = base('same')
    const { skills } = composeSkills(set, [skill('same'), skill('other')])
    assert.deepEqual(skills.map(s => s.name), ['same', 'other'])
    assert.equal(skills[0], set.skills[0])
  })
  it('puts API-doc skills first', () => {
    assert.deepEqual(composeSkills(base('doc1', 'doc2'), [skill('reg')]).skills.map(s => s.name), ['doc1', 'doc2', 'reg'])
  })
})
