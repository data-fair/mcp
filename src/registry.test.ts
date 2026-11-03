import { describe, it, before, after, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFakeRegistry } from '../test/fake-registry.ts'
import { createRegistrySkills } from './registry.ts'
import type { CallerAccount } from './scopes.ts'

const skillMd = (name: string, body = 'Body') => `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}\n`
const names = (skills: { skill: { name: string } }[]) => skills.map(s => s.skill.name).sort()

/** polls a condition: a refresh in the background settles after the request that started it */
const until = async (condition: () => unknown | Promise<unknown>, timeout = 3000) => {
  const start = Date.now()
  while (!(await condition())) {
    if (Date.now() - start > timeout) throw new Error('condition not met in time')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

const A: CallerAccount = { type: 'organization', id: 'a' }
const B: CallerAccount = { type: 'user', id: 'b' }

describe('registry skills', () => {
  let registry: Awaited<ReturnType<typeof createFakeRegistry>>
  before(async () => { registry = await createFakeRegistry() })
  after(() => registry.close())
  let warn: ReturnType<typeof mock.method>
  afterEach(() => mock.restoreAll())
  beforeEach(async () => {
    warn = mock.method(console, 'warn', () => {})
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
    assert.equal((await skills.skillsFor(undefined))[0].skill.body, 'Body\n')
    await registry.publish('pub', { 'SKILL.md': skillMd('pub-skill', 'Body v2') }, { public: true })
    await until(async () => (await skills.skillsFor(undefined))[0].skill.body === 'Body v2\n')
  })

  it('registry down', async () => {
    const skills = await create({ listingTtl: 0 })
    assert.deepEqual(await skills.skillsFor(A).then(names), ['priv-skill', 'pub-skill'])
    assert.equal(skills.status().error, undefined)
    registry.fail(500)
    assert.deepEqual(await skills.skillsFor(A).then(names), ['priv-skill', 'pub-skill'])
    await until(() => skills.status().error)
    assert.match(skills.status().error!, /500/)
    // no prior listing for this account: nothing, never the other account's skills
    assert.deepEqual(await skills.skillsFor(B), [])
    registry.fail(undefined)
    await skills.skillsFor(A)
    assert.match(skills.status().error!, /500/) // B's listing is still failing
    await skills.skillsFor(B)
    await until(() => skills.status().error === undefined)
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
    registry.unpublish('broken')
  })

  it('republish seen by two accounts at once: valid skills, one download per version', async () => {
    const skills = await create()
    await skills.skillsFor(A)
    assert.equal(registry.hits.download, 2)
    await registry.publish('pub', { 'SKILL.md': skillMd('pub-skill', 'Body v2') }, { public: true })
    const [forB, forA] = await Promise.all([skills.skillsFor(B), skills.skillsFor(A)])
    assert.deepEqual(names(forB), ['pub-skill'])
    assert.deepEqual(names(forA), ['priv-skill', 'pub-skill'])
    await until(async () => (await skills.skillsFor(B))[0].skill.body === 'Body v2\n')
    assert.deepEqual(skills.status().invalid, [])
    assert.equal(registry.hits.download, 3)
  })

  it('content reused across expired listings', async () => {
    const skills = await create({ listingTtl: 0 })
    await skills.skillsFor(A)
    await skills.skillsFor(A)
    await until(() => registry.hits.listing === 2)
    await skills.skillsFor(A)
    assert.equal(registry.hits.download, 2)
  })

  it('a hanging download costs a request timeoutMs, then the skill appears once loaded', async () => {
    const skills = await create({ timeoutMs: 200, listingTtl: 0 })
    const release = registry.holdDownloads('priv')
    const start = Date.now()
    assert.deepEqual(names(await skills.skillsFor(A)), ['pub-skill'])
    assert.ok(Date.now() - start < 700)
    release()
    for (let i = 0; i < 20 && (await skills.skillsFor(A)).length < 2; i++) await new Promise(resolve => setTimeout(resolve, 50))
    assert.deepEqual(names(await skills.skillsFor(A)), ['priv-skill', 'pub-skill'])
  })

  it('a stalled download keeps its slot: no second download of the same artefact meanwhile', async () => {
    const skills = await create({ timeoutMs: 100, listingTtl: 0 })
    const release = registry.holdDownloads('priv')
    await skills.skillsFor(A)
    await new Promise(resolve => setTimeout(resolve, 700)) // well past the former 6 x timeoutMs bound
    await skills.skillsFor(A)
    assert.equal(registry.hits.download, 2) // pub and priv, once each
    release()
    for (let i = 0; i < 20 && (await skills.skillsFor(A)).length < 2; i++) await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(registry.hits.download, 2)
    assert.deepEqual(names(await skills.skillsFor(A)), ['priv-skill', 'pub-skill'])
  })

  it('one account recovering does not clear another listing failure', async () => {
    const skills = await create({ listingTtl: 0 })
    await skills.skillsFor(A)
    registry.fail(500)
    await skills.skillsFor(A)
    await until(() => skills.status().error)
    registry.fail(undefined)
    await skills.skillsFor(undefined)
    assert.match(skills.status().error!, /500/)
  })

  it('an expired listing during a hanging registry is served from cache at once', async () => {
    const skills = await create({ timeoutMs: 2000, listingTtl: 0 })
    assert.deepEqual(names(await skills.skillsFor(A)), ['priv-skill', 'pub-skill'])
    registry.fail('hang')
    const start = Date.now()
    assert.deepEqual(names(await skills.skillsFor(A)), ['priv-skill', 'pub-skill'])
    assert.ok(Date.now() - start < 300, `took ${Date.now() - start}ms`)
    await until(() => registry.hits.listing === 2) // the background refresh reached the registry, not the next test's
  })

  it('after a listing failure the listing is not asked again within listingTtl', async () => {
    const skills = await create({ listingTtl: 60 })
    registry.fail(500)
    assert.deepEqual(await skills.skillsFor(A), [])
    registry.fail(undefined)
    assert.deepEqual(await skills.skillsFor(A), [])
    assert.equal(registry.hits.listing, 1)
    assert.match(skills.status().error!, /500/)
  })

  it('during a slow republish the previous version is served', async () => {
    const skills = await create({ timeoutMs: 2000, listingTtl: 0 })
    assert.equal((await skills.skillsFor(undefined))[0].skill.body, 'Body\n')
    await registry.publish('pub', { 'SKILL.md': skillMd('pub-skill', 'Body v2') }, { public: true })
    const release = registry.holdDownloads('pub')
    try {
      // the expired listing refreshes in the background, then a request starts the new version's download
      await until(async () => { await skills.skillsFor(undefined); return registry.hits.download === 2 })
      const start = Date.now()
      assert.equal((await skills.skillsFor(undefined))[0]?.skill.body, 'Body\n')
      assert.ok(Date.now() - start < 500, `took ${Date.now() - start}ms`)
    } finally {
      release()
    }
    await until(async () => (await skills.skillsFor(undefined))[0].skill.body === 'Body v2\n')
  })

  it('a listing without dataUpdatedAt downloads its artefact once', async () => {
    registry.undate('pub')
    const skills = await create({ listingTtl: 0 })
    await until(async () => { await skills.skillsFor(undefined); return registry.hits.listing >= 4 })
    assert.deepEqual(names(await skills.skillsFor(undefined)), ['pub-skill'])
    assert.equal(registry.hits.download, 1)
  })

  it('logs a listing failure, an invalid package and a truncated listing once each', async () => {
    await registry.publish('broken', { 'SKILL.md': 'no front matter' }, { public: true })
    registry.reportCount(150)
    try {
      const skills = await create({ listingTtl: 0 })
      await until(async () => { await skills.skillsFor(undefined); return registry.hits.listing >= 3 })
      registry.fail(500)
      await skills.skillsFor(B)
      await skills.skillsFor(B)
      const logged = warn.mock.calls.map(c => String(c.arguments[0]))
      assert.equal(logged.filter(m => /broken/.test(m) && /frontmatter/.test(m)).length, 1, JSON.stringify(logged))
      assert.equal(logged.filter(m => /150/.test(m)).length, 1, JSON.stringify(logged))
      assert.equal(logged.filter(m => /listing for user:b failed/.test(m)).length, 1, JSON.stringify(logged))
    } finally {
      registry.reportCount(undefined)
      registry.unpublish('broken')
    }
  })
})
