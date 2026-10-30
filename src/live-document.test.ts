import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createLiveDocument } from './live-document.ts'

const platformDoc = JSON.parse(await readFile(new URL('../test/fixtures/platform-api-docs.json', import.meta.url), 'utf8'))
const RAW = '/data-fair/api/v1/datasets/{id}/raw'
/** the platform document without the raw download operation */
const smaller = (() => {
  const { [RAW]: _raw, ...paths } = platformDoc.paths
  return { ...platformDoc, paths }
})()
const names = (ts: { tools: { name: string }[] }) => ts.tools.map(t => t.name)
const LOAD = { lint: 'warn' as const }

/**
 * An HTTP stub keyed by URL with ETags: a request whose If-None-Match equals the current
 * ETag gets a 304. `set` replaces a document and bumps its ETag.
 */
function stack () {
  const docs = new Map<string, { body: unknown, etag: string, text?: boolean }>()
  const hits: Record<string, number> = {}
  const requests: Request[] = []
  let counter = 0
  /** URLs answering a given error status until cleared, whatever their validators */
  const failing = new Map<string, number>()
  const set = (url: string, body: unknown) => docs.set(url, { body, etag: `"${++counter}"` })
  const setText = (url: string, body: string) => docs.set(url, { body, etag: `"${++counter}"`, text: true })
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init)
    requests.push(req)
    hits[req.url] = (hits[req.url] ?? 0) + 1
    const status = failing.get(req.url)
    if (status) return new Response('unavailable', { status })
    const doc = docs.get(req.url)
    if (!doc) return new Response('not found', { status: 404 })
    if (req.headers.get('if-none-match') === doc.etag) return new Response(null, { status: 304, headers: { etag: doc.etag } })
    return doc.text
      ? new Response(doc.body as string, { headers: { 'content-type': 'text/markdown', etag: doc.etag } })
      : new Response(JSON.stringify(doc.body), { headers: { 'content-type': 'application/json', etag: doc.etag } })
  }) as typeof fetch
  return { set, setText, failing, fetchFn, hits, requests }
}

const DOC = 'https://site.test/platform-api-docs.json'
const SKILL = 'https://site.test/skills/workflow.md'
const withLinkedSkill = (href: string) => ({ ...platformDoc, 'x-agent': { skills: [{ name: 'workflow', description: 'When data.', href }] } })

describe('createLiveDocument', () => {
  it('refresh sends If-None-Match and keeps the tool set on 304', async () => {
    const s = stack()
    s.set(DOC, platformDoc)
    const live = await createLiveDocument(DOC, { fetch: s.fetchFn, ...LOAD })
    const first = live.toolSet
    assert.ok(names(first).includes('datafair_download_dataset_file'))
    assert.equal(await live.refresh(), false)
    assert.equal(s.requests.filter(r => r.url === DOC).at(-1)!.headers.get('if-none-match'), '"1"')
    assert.equal(live.toolSet, first, 'the same object')
    assert.equal(live.error, undefined)
  })

  it('sends If-Modified-Since when the document carries Last-Modified', async () => {
    const seen: Request[] = []
    const lastModified = 'Mon, 19 Oct 2026 10:00:00 GMT'
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      seen.push(req)
      if (req.headers.get('if-modified-since') === lastModified) return new Response(null, { status: 304 })
      return new Response(JSON.stringify(platformDoc), { headers: { 'content-type': 'application/json', 'last-modified': lastModified } })
    }) as typeof fetch
    const live = await createLiveDocument(DOC, { fetch: fetchFn, ...LOAD })
    assert.equal(await live.refresh(), false)
    assert.equal(seen.filter(r => r.url === DOC).length, 2)
  })

  it('throws on a failing first load', async () => {
    const s = stack()
    await assert.rejects(createLiveDocument(DOC, { fetch: s.fetchFn, ...LOAD }), /failed to load https:\/\/site\.test\/platform-api-docs\.json: HTTP 404/)
    s.set(DOC, { ...platformDoc, 'x-agent': { skills: 'x' } })
    await assert.rejects(createLiveDocument(DOC, { fetch: s.fetchFn, ...LOAD }), /x-agent invalid/)
  })

  it('a failing refresh keeps the previous tool set and sets error', async () => {
    const s = stack()
    s.set(DOC, platformDoc)
    const live = await createLiveDocument(DOC, { fetch: s.fetchFn, ...LOAD })
    const first = live.toolSet
    let notified = 0
    live.onChange(() => notified++)

    s.failing.set(DOC, 503)
    assert.equal(await live.refresh(), false)
    assert.equal(live.toolSet, first)
    assert.equal(live.error, `failed to load ${DOC}: HTTP 503`)

    // a document that answers but no longer loads is a failure too
    s.failing.delete(DOC)
    s.set(DOC, { ...platformDoc, 'x-agent': { skills: 'x' } })
    assert.equal(await live.refresh(), false)
    assert.equal(live.toolSet, first)
    assert.match(live.error!, /x-agent invalid/)

    // the same bytes back under a new ETag: the error clears, nothing changed
    s.set(DOC, platformDoc)
    assert.equal(await live.refresh(), false)
    assert.equal(live.error, undefined)
    assert.equal(live.toolSet, first)
    assert.equal(notified, 0)
  })

  it('a changed document replaces toolSet and calls onChange once', async () => {
    const s = stack()
    s.set(DOC, platformDoc)
    const live = await createLiveDocument(DOC, { fetch: s.fetchFn, ...LOAD })
    const first = live.toolSet
    const seen: string[][] = []
    const unsubscribe = live.onChange(ts => seen.push(ts.tools.map(t => t.name)))

    s.set(DOC, smaller)
    assert.equal(await live.refresh(), true)
    assert.notEqual(live.toolSet, first)
    assert.ok(names(first).includes('datafair_download_dataset_file'), 'the previous set is not mutated')
    assert.ok(!names(live.toolSet).includes('datafair_download_dataset_file'))
    assert.equal(seen.length, 1)
    assert.deepEqual(seen[0], names(live.toolSet))

    // a skill description changes only what the skills say
    const [skill] = platformDoc['x-agent'].skills
    s.set(DOC, { ...smaller, 'x-agent': { skills: [{ ...skill, description: 'Another description.' }] } })
    assert.equal(await live.refresh(), true)
    assert.equal(live.toolSet.skills[0].description, 'Another description.')
    assert.equal(seen.length, 2)

    unsubscribe()
    s.set(DOC, platformDoc)
    assert.equal(await live.refresh(), true)
    assert.equal(seen.length, 2, 'an unsubscribed listener is not called')
  })

  it('shares one refresh between overlapping calls', async () => {
    const s = stack()
    s.set(DOC, platformDoc)
    const live = await createLiveDocument(DOC, { fetch: s.fetchFn, ...LOAD })
    s.set(DOC, smaller)
    let notified = 0
    live.onChange(() => notified++)
    assert.deepEqual(await Promise.all([live.refresh(), live.refresh()]), [true, true])
    assert.equal(s.hits[DOC], 2)
    assert.equal(notified, 1)
  })

  it('skill bodies are revalidated conditionally', async () => {
    const s = stack()
    s.set(DOC, withLinkedSkill('skills/workflow.md'))
    s.setText(SKILL, 'Version 1.')
    const live = await createLiveDocument(DOC, { fetch: s.fetchFn, ...LOAD })
    const body = () => live.toolSet.skills.find(x => x.name === 'workflow')!.body
    assert.equal(body(), 'Version 1.')
    let notified = 0
    live.onChange(() => notified++)

    assert.equal(await live.refresh(), false, 'an unchanged body is a 304')
    assert.equal(s.hits[SKILL], 2)
    assert.equal(s.requests.filter(r => r.url === SKILL).at(-1)!.headers.get('if-none-match'), '"2"')

    s.setText(SKILL, 'Version 2.')
    assert.equal(await live.refresh(), true)
    assert.equal(notified, 1)
    assert.equal(body(), 'Version 2.')

    // a link the document dropped is no longer revalidated
    s.set(DOC, platformDoc)
    assert.equal(await live.refresh(), true)
    const hits = s.hits[SKILL]
    await live.refresh()
    assert.equal(s.hits[SKILL], hits)
  })

  it('keeps serving the last good skill body when its revalidation fails, and sets error', async () => {
    const s = stack()
    s.set(DOC, withLinkedSkill('skills/workflow.md'))
    s.setText(SKILL, 'The body.')
    const live = await createLiveDocument(DOC, { fetch: s.fetchFn, ...LOAD })
    const first = live.toolSet
    let notified = 0
    live.onChange(() => notified++)
    s.failing.set(SKILL, 503)
    assert.equal(await live.refresh(), false)
    assert.equal(live.toolSet, first, 'the same object')
    assert.equal(live.toolSet.skills[0].body, 'The body.')
    assert.equal(live.toolSet.skills[0].error, undefined)
    assert.equal(live.error, `failed to revalidate skill body ${SKILL}: HTTP 503`)
    assert.equal(notified, 0)
    // the failure passes: the body kept its validators, a 304 clears the error
    s.failing.delete(SKILL)
    assert.equal(await live.refresh(), false)
    assert.equal(s.requests.at(-1)!.headers.get('if-none-match'), '"2"')
    assert.equal(live.error, undefined)
    assert.equal(live.toolSet, first)
  })

  it('recovers a skill body that failed from the start, even when the file did not change', async () => {
    const s = stack()
    s.set(DOC, withLinkedSkill('skills/workflow.md'))
    s.setText(SKILL, 'The body.')
    s.failing.set(SKILL, 503)
    const live = await createLiveDocument(DOC, { fetch: s.fetchFn, ...LOAD })
    const skill = () => live.toolSet.skills.find(x => x.name === 'workflow')!
    assert.match(skill().error!, /HTTP 503/)
    assert.equal(await live.refresh(), false, 'still failing: nothing changed')
    assert.equal(live.error, undefined, 'a body that never answered is the skill\'s error, not the document\'s')
    s.failing.delete(SKILL)
    assert.equal(await live.refresh(), true)
    assert.equal(skill().body, 'The body.')
    assert.equal(skill().error, undefined)
  })

  it('a throwing listener neither fails the refresh nor silences the others', async () => {
    const s = stack()
    s.set(DOC, platformDoc)
    const live = await createLiveDocument(DOC, { fetch: s.fetchFn, ...LOAD })
    let notified = 0
    live.onChange(() => { throw new Error('listener bug') })
    live.onChange(() => notified++)
    s.set(DOC, smaller)
    assert.equal(await live.refresh(), true)
    assert.equal(notified, 1)
  })

  it('reports an unreachable body on its skill and still serves the document', async () => {
    const s = stack()
    s.set(DOC, withLinkedSkill('skills/gone.md'))
    const live = await createLiveDocument(DOC, { fetch: s.fetchFn, ...LOAD })
    assert.equal(live.toolSet.skills[0].error, 'HTTP 404 (https://site.test/skills/gone.md)')
    assert.ok(live.toolSet.tools.length > 0)
  })

  it('exposes the document behind the current tool set', async () => {
    const s = stack()
    s.set(DOC, platformDoc)
    const live = await createLiveDocument(DOC, { fetch: s.fetchFn, ...LOAD })
    assert.equal(live.document['x-platform'].services[0].id, 'datafair')
    s.set(DOC, smaller)
    assert.equal(await live.refresh(), true)
    assert.equal(live.document.paths[RAW], undefined)
  })

  it('executes tools through the call context', async () => {
    const s = stack()
    s.set(DOC, smaller)
    const live = await createLiveDocument(DOC, { fetch: s.fetchFn, ...LOAD })
    const seen: Request[] = []
    const upstream = (async (input: RequestInfo | URL) => { seen.push(input as Request); return new Response(JSON.stringify({ results: [] }), { headers: { 'content-type': 'application/json' } }) }) as typeof fetch
    await live.toolSet.tools.find(t => t.name === 'datafair_list_datasets')!.execute({}, { fetch: upstream, headers: { cookie: 'c=1' } })
    assert.ok(new URL(seen[0].url).href.startsWith('http://fixture.test/data-fair/api/v1/catalog/datasets'))
    assert.equal(seen[0].headers.get('cookie'), 'c=1')
  })
})
