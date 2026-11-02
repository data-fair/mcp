import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, symlink, writeFile } from 'node:fs/promises'
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
    const bad = async (reason: RegExp, files: Record<string, string | Buffer>) => {
      const res = await parseSkillPackage(await writeSkillPackage(files))
      assert.ok('error' in res, JSON.stringify(res))
      assert.match(res.error, reason)
      return res.error
    }
    await bad(/SKILL.md not found/, { 'README.md': 'x' })
    await bad(/invalid skill name/, { 'SKILL.md': skillMd('Bad_Name') })
    await bad(/invalid skill name/, { 'SKILL.md': skillMd('a'.repeat(65)) })
    await bad(/invalid skill description/, { 'SKILL.md': skillMd('ok', 'd'.repeat(1025)) })
    await bad(/big.txt is larger/, { 'SKILL.md': skillMd(), 'big.txt': 'x'.repeat(SKILL_LIMITS.fileSize + 1) })
    await bad(/package is larger/, { 'SKILL.md': skillMd(), ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`f${i}.txt`, 'x'.repeat(SKILL_LIMITS.fileSize)])) })
    await bad(/too many files/, { 'SKILL.md': skillMd(), ...Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`f${i}.txt`, 'x'])) })
    await bad(/bad.json is not valid UTF-8/, { 'SKILL.md': skillMd(), 'bad.json': Buffer.from([0xff, 0xfe, 0x00]) })
    await bad(/no valid frontmatter/, { 'SKILL.md': '# no frontmatter' })
  })

  it('accepts exactly the file limit and the per-file limit', async () => {
    const res = await parseSkillPackage(await writeSkillPackage({ 'SKILL.md': skillMd(), 'a.txt': 'x'.repeat(SKILL_LIMITS.fileSize) }))
    assert.ok('skill' in res)
  })

  it('ignores, with a warning, file names outside [A-Za-z0-9._-] and a nested SKILL.md', async () => {
    const res = await parseSkillPackage(await writeSkillPackage({
      'SKILL.md': skillMd(),
      'ok/page-1_a.json': '{}',
      'my page.json': '{}',
      'dir é/a.json': '{}',
      'docs/SKILL.md': 'nested'
    }))
    assert.ok('skill' in res)
    assert.deepEqual(res.skill.resources!.map(r => r.path), ['ok/page-1_a.json'])
    assert.ok(res.warnings.some(w => w.startsWith('my page.json:')), JSON.stringify(res.warnings))
    assert.ok(res.warnings.some(w => w.startsWith('dir é/a.json:')), JSON.stringify(res.warnings))
    assert.ok(res.warnings.some(w => w.startsWith('docs/SKILL.md:')), JSON.stringify(res.warnings))
  })

  it('warns when metadata.tools is not a string', async () => {
    const res = await parseSkillPackage(await writeSkillPackage({
      'SKILL.md': '---\nname: listy\ndescription: d\nmetadata:\n  tools: [datafair_a, datafair_b]\n---\nBody\n'
    }))
    assert.ok('skill' in res)
    assert.equal(res.skill.tools, undefined)
    assert.ok(res.warnings.some(w => /metadata\.tools/.test(w)), JSON.stringify(res.warnings))
  })

  it('ignores an oversized unsupported file with a warning instead of failing', async () => {
    const res = await parseSkillPackage(await writeSkillPackage({ 'SKILL.md': skillMd(), 'logo.png': 'x'.repeat(300 * 1024) }))
    assert.ok('skill' in res)
    assert.deepEqual(res.skill.resources, [])
    assert.ok(res.warnings.some(w => w.includes('logo.png')))
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

  it('throws on an unreadable file instead of calling the package invalid', async (t) => {
    if (process.getuid?.() === 0) return t.skip('root reads everything')
    const dir = await writeSkillPackage({ 'SKILL.md': skillMd(), 'a.json': '{}' })
    await chmod(join(dir, 'a.json'), 0)
    await assert.rejects(parseSkillPackage(dir), /EACCES/)
  })
})
