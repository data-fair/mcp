/**
 * A site for the tests: the index, the annotated data-fair document (servers[0].url pointed
 * at this site) and canned dataset responses that echo the request's host, cookies and
 * forwarded headers — so assertions read what actually reached the API.
 */
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'

export interface FakeSite { origin: string, port: number, hits: { url: string, headers: Record<string, string | string[] | undefined> }[], setDoc (patch: (doc: any) => void): void, close (): Promise<void> }

export async function startFakeSite (): Promise<FakeSite> {
  let doc = JSON.parse(readFileSync(new URL('./fixtures/data-fair-api-docs.json', import.meta.url), 'utf8'))
  const index = JSON.parse(readFileSync(new URL('./fixtures/data-fair-agents-index.json', import.meta.url), 'utf8'))
  const FIXTURE_ORIGIN = 'http://fixture.test'
  let etag = 1
  const hits: FakeSite['hits'] = []
  let origin = ''
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url!, origin)
    hits.push({ url: req.url!, headers: req.headers as any })
    const json = (body: unknown, headers: Record<string, string> = {}) => { res.writeHead(200, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)) }
    if (url.pathname === '/data-fair/api/v1/agents/index.json') {
      // generated against a placeholder origin: the services point at this site
      return json({ ...index, services: index.services.map((s: any) => ({ ...s, openapi: s.openapi.replace(FIXTURE_ORIGIN, origin) })) }, { etag: '"index"' })
    }
    const skill = url.pathname.match(/^\/data-fair\/api\/v1\/agents\/skills\/([a-z0-9-]+)\.md$/)
    if (skill) {
      try {
        const body = readFileSync(new URL(`./fixtures/data-fair-skills/${skill[1]}.md`, import.meta.url), 'utf8')
        res.writeHead(200, { 'content-type': 'text/markdown' }); return res.end(body)
      } catch { res.writeHead(404); return res.end('unknown skill') }
    }
    if (url.pathname === '/data-fair/api/v1/api-docs.json') {
      if (req.headers['if-none-match'] === `"${etag}"`) { res.writeHead(304); return res.end() }
      return json({ ...doc, servers: [{ url: `${origin}/data-fair/api/v1` }] }, { etag: `"${etag}"` })
    }
    // the account listing and the catalog listing answer the same canned page
    if (url.pathname === '/data-fair/api/v1/datasets' || url.pathname === '/data-fair/api/v1/catalog/datasets') {
      return json({ count: 1, results: [{ id: 'ds1', slug: 'ds1', title: `Seen by ${req.headers['x-forwarded-host'] ?? req.headers.host}`, summary: `cookie=${req.headers.cookie ?? ''} apikey=${req.headers['x-apikey'] ?? ''}`, count: 1, status: 'finalized', updatedAt: '2026-01-01T00:00:00Z', page: `${origin}/datasets/ds1` }] })
    }
    res.writeHead(404); res.end('not found ' + url.pathname)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as any).port
  origin = `http://127.0.0.1:${port}`
  return {
    origin,
    port,
    hits,
    setDoc (patch) { doc = structuredClone(doc); patch(doc); etag++ },
    close: () => new Promise<void>(resolve => server.close(() => resolve()))
  }
}
