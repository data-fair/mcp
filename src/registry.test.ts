import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFakeRegistry } from '../test/fake-registry.ts'
import { createRegistrySkills } from './registry.ts'
import type { CallerAccount } from './scopes.ts'

const skillMd = (name: string, body = 'Body') => `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}\n`
const names = (skills: { name: string }[]) => skills.map(s => s.name).sort()

const A: CallerAccount = { type: 'organization', id: 'a' }
const B: CallerAccount = { type: 'user', id: 'b' }

describe('registry skills', () => {
  let registry: Awaited<ReturnType<typeof createFakeRegistry>>
  before(async () => { registry = await createFakeRegistry() })
  after(() => registry.close())
  beforeEach(async () => {
    registry.fail(undefined)
    registry.hits.listing = 0
    registry.hits.download = 0
    await registry.publish('pub', { 'SKILL.md': skillMd('pub-skill') }, { public: true })
    await registry.publish('priv', { 'SKILL.md': skillMd('priv-skill') }, { privateAccess: [A] })
  })

  const create = async (extra: { listingTtl?: number, timeoutMs?: number } = {}) => createRegistrySkills({
    url: registry.url, secretKey: registry.secretKey, listingTtl: 60, cacheDir: await mkdtemp(join(tmpdir(), 'registry-cache-')), ...extra
  })

  it('public and private visibility', async () => {
    const skills = await create()
    assert.deepEqual(names(await skills.skillsFor(A)), ['priv-skill', 'pub-skill'])
    assert.deepEqual(names(await skills.skillsFor(B)), ['pub-skill'])
    assert.deepEqual(names(await skills.skillsFor(undefined)), ['pub-skill'])
  })

  it('no cross-account leak under concurrency', async () => {
    const skills = await create()
    const [forA, forB, forNobody] = await Promise.all([skills.skillsFor(A), skills.skillsFor(B), skills.skillsFor(undefined)])
    assert.deepEqual(names(forA), ['priv-skill', 'pub-skill'])
    assert.deepEqual(names(forB), ['pub-skill'])
    assert.deepEqual(names(forNobody), ['pub-skill'])
  })

  it('listing reused within listingTtl', async () => {
    const skills = await create()
    await skills.skillsFor(A)
    await skills.skillsFor(A)
    assert.equal(registry.hits.listing, 1)
  })

  it('republished skill served after the listing expires', async () => {
    const skills = await create({ listingTtl: 0 })
    assert.equal((await skills.skillsFor(undefined))[0].body, 'Body\n')
    await registry.publish('pub', { 'SKILL.md': skillMd('pub-skill', 'Body v2') }, { public: true })
    assert.equal((await skills.skillsFor(undefined))[0].body, 'Body v2\n')
  })

  it('registry down', async () => {
    const skills = await create({ listingTtl: 0 })
    assert.deepEqual(await skills.skillsFor(A).then(names), ['priv-skill', 'pub-skill'])
    assert.equal(skills.status().error, undefined)
    registry.fail(500)
    assert.deepEqual(await skills.skillsFor(A).then(names), ['priv-skill', 'pub-skill'])
    assert.match(skills.status().error!, /500/)
    // no prior listing for this account: nothing, never the other account's skills
    assert.deepEqual(await skills.skillsFor(B), [])
    registry.fail(undefined)
    await skills.skillsFor(A)
    assert.equal(skills.status().error, undefined)
  })

  it('registry hanging', async () => {
    const skills = await create({ timeoutMs: 100 })
    registry.fail('hang')
    const start = Date.now()
    assert.deepEqual(await skills.skillsFor(A), [])
    assert.ok(Date.now() - start < 1000)
    assert.ok(skills.status().error)
  })

  it('invalid package skipped', async () => {
    await registry.publish('broken', { 'SKILL.md': 'no front matter' }, { public: true })
    const skills = await create()
    assert.deepEqual(names(await skills.skillsFor(undefined)), ['pub-skill'])
    const { invalid } = skills.status()
    assert.deepEqual(invalid.map(i => i.id), ['broken'])
  })
})
