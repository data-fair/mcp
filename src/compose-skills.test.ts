import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { Skill, Tool, ToolSet } from '@data-fair/openapi-mcp'
import { composeSkills } from './compose-skills.ts'

const skill = (name: string, tools?: string[], body = name): Skill => ({ name, description: name, body, digest: 'sha256:' + body, ...(tools && { tools }) })
const listed = (name: string, tools?: string[], id = name, body = name) => ({ id, skill: skill(name, tools, body) })
const base = (...names: string[]): ToolSet => ({ tools: [{ name: 'datafair_a' }, { name: 'datafair_b' }] as Tool[], skills: names.map(n => skill(n)), guides: [] })

describe('composeSkills', () => {
  let warn: ReturnType<typeof mock.method>
  beforeEach(() => { warn = mock.method(console, 'warn', () => {}) })
  afterEach(() => mock.restoreAll())
  const warnings = () => warn.mock.calls.map(c => String(c.arguments[0]))

  it('keeps a skill with no tools', () => {
    assert.deepEqual(composeSkills(base(), [listed('free')]).skills.map(s => s.name), ['free'])
  })
  it('drops a skill whose tools are all out of the set', () => {
    assert.deepEqual(composeSkills(base(), [listed('gone', ['datafair_x'])]).skills, [])
  })
  it('cuts the unknown tools of a kept skill', () => {
    const { skills } = composeSkills(base(), [listed('mixed', ['datafair_a', 'datafair_x'])])
    assert.deepEqual(skills[0].tools, ['datafair_a'])
  })
  it('keeps the API-doc skill on a name collision', () => {
    const set = base('same')
    const { skills } = composeSkills(set, [listed('same'), listed('other')])
    assert.deepEqual(skills.map(s => s.name), ['same', 'other'])
    assert.equal(skills[0], set.skills[0])
  })
  it('puts API-doc skills first', () => {
    assert.deepEqual(composeSkills(base('doc1', 'doc2'), [listed('reg')]).skills.map(s => s.name), ['doc1', 'doc2', 'reg'])
  })
  it('two registry skills with one name: the artefact id sorting last wins, whatever the order', () => {
    const one = listed('twin', undefined, 'org-twin-1', 'one')
    const two = listed('twin', undefined, 'org-twin-2', 'two')
    for (const order of [[one, two], [two, one]]) {
      const { skills } = composeSkills(base(), order)
      assert.deepEqual(skills.map(s => [s.name, s.body]), [['twin', 'two']])
      assert.ok(!('id' in skills[0]))
    }
    assert.deepEqual(warnings(), ['registry skill "twin" of org-twin-1 dropped: org-twin-2 has the same name and sorts last'])
  })
  it('logs each distinct warning once, not on every call', () => {
    const set = base('dup-doc')
    const many = Array.from({ length: 51 }, (_, i) => listed(`many-${i}`))
    for (let i = 0; i < 3; i++) {
      composeSkills(set, [listed('dup-doc')])
      composeSkills(base(), many)
    }
    assert.deepEqual(warnings(), ['registry skill "dup-doc" of dup-doc dropped: an API-doc skill has the same name', '51 skills served, more than 50'])
  })
})
