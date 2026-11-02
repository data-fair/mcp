import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseSkillPackage, SKILL_LIMITS } from './registry-skills.ts'
import { writeSkillPackage } from '../test/skill-packages.ts'

const skillMd = (name = 'territorial-observatory', description = 'Build an observatory') =>
  `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  tools: "datafair_list_datasets datafair_create_dataset"\n---\n# Body\n\nText\n`

describe('registry skill package parser', () => {
  it('parses a valid package', async () => {
    const dir = await writeSkillPackage({
      'SKILL.md': skillMd(),
      'templates/page.json': '{"a":1}',
      'examples/a.csv': 'a,b\n1,2\n',
      'package.json': '{}',
      '.npmignore': 'x',
      'node_modules/x/index.js': '1',
      'logo.png': 'png'
    })
    const res = await parseSkillPackage(dir)
    assert.ok('skill' in res)
    const { skill, warnings } = res
    assert.equal(skill.name, 'territorial-observatory')
    assert.equal(skill.description, 'Build an observatory')
    assert.equal(skill.body, '# Body\n\nText\n')
    assert.match(skill.digest, /^sha256:[0-9a-f]{64}$/)
    assert.deepEqual(skill.tools, ['datafair_list_datasets', 'datafair_create_dataset'])
    assert.deepEqual(skill.resources, [
      { path: 'examples/a.csv', mimeType: 'text/csv', text: 'a,b\n1,2\n' },
      { path: 'templates/page.json', mimeType: 'application/json', text: '{"a":1}' }
    ])
    assert.ok(warnings.some(w => w.includes('logo.png')))
  })

  it('rejects invalid packages', async () => {
    const bad = async (files: Record<string, string | Buffer>) => {
      const res = await parseSkillPackage(await writeSkillPackage(files))
      assert.ok('error' in res, JSON.stringify(res))
      return res.error
    }
    await bad({ 'README.md': 'x' })
    await bad({ 'SKILL.md': skillMd('Bad_Name') })
    await bad({ 'SKILL.md': skillMd('a'.repeat(65)) })
    await bad({ 'SKILL.md': skillMd('ok', 'd'.repeat(1025)) })
    await bad({ 'SKILL.md': skillMd(), 'big.txt': 'x'.repeat(SKILL_LIMITS.fileSize + 1) })
    await bad({ 'SKILL.md': skillMd(), ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`f${i}.txt`, 'x'.repeat(SKILL_LIMITS.fileSize)])) })
    await bad({ 'SKILL.md': skillMd(), ...Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`f${i}.txt`, 'x'])) })
    await bad({ 'SKILL.md': skillMd(), 'bad.json': Buffer.from([0xff, 0xfe, 0x00]) })
    await bad({ 'SKILL.md': '# no frontmatter' })
  })

  it('accepts exactly the file limit and the per-file limit', async () => {
    const res = await parseSkillPackage(await writeSkillPackage({ 'SKILL.md': skillMd(), 'a.txt': 'x'.repeat(SKILL_LIMITS.fileSize) }))
    assert.ok('skill' in res)
  })

  it('ignores a symlink pointing outside the package, with a warning', async () => {
    const dir = await writeSkillPackage({ 'SKILL.md': skillMd() })
    const outside = await writeSkillPackage({ 'secret.txt': 'secret' })
    await symlink(join(outside, 'secret.txt'), join(dir, 'link.txt'))
    await mkdir(join(dir, 'd'))
    await symlink(outside, join(dir, 'd', 'dirlink'))
    await writeFile(join(dir, 'ok.md'), 'ok')
    const res = await parseSkillPackage(dir)
    assert.ok('skill' in res)
    assert.deepEqual(res.skill.resources?.map(r => r.path), ['ok.md'])
    assert.ok(res.warnings.some(w => w.includes('link.txt')))
    assert.ok(res.warnings.some(w => w.includes('dirlink')))
  })
})
