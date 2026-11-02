import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import * as tar from 'tar'
import type { CallerAccount } from '../src/scopes.ts'

export interface Visibility { public?: boolean, privateAccess?: CallerAccount[] }
interface Published { id: string, files: Record<string, string>, visibility: Visibility, dataUpdatedAt: Date, tarball: Buffer }

/** npm-style gzip tarball: every entry under `package/` */
const buildTarball = async (files: Record<string, string>) => {
  const dir = await mkdtemp(join(tmpdir(), 'fake-registry-'))
  try {
    for (const [path, content] of Object.entries(files)) {
      const target = join(dir, 'package', path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content)
    }
    const file = join(dir, 'out.tgz')
    await tar.create({ gzip: true, cwd: dir, file }, ['package'])
    return await readFile(file)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * A fake of the registry's artefacts API. Like the real one: anonymous sees public artefacts only,
 * the internal secret with `x-account` sees public or privateAccess matches, the secret alone sees everything.
 */
export const createFakeRegistry = async () => {
  const secretKey = 'fake-registry-secret'
  const artefacts = new Map<string, Published>()
  let failure: number | 'hang' | undefined
  let clock = Date.parse('2026-01-01T00:00:00Z')
  const held = new Map<string, (() => void)[]>()
  const hits = { listing: 0, download: 0 }

  const server = createServer((req, res) => {
    if (failure === 'hang') return
    if (failure) { res.writeHead(failure).end('{}'); return }
    const url = new URL(req.url!, 'http://localhost')
    const secret = req.headers['x-secret-key'] === secretKey
    let account: CallerAccount | undefined
    try { if (secret && req.headers['x-account']) account = JSON.parse(String(req.headers['x-account'])) } catch { /* ignore */ }
    const isVisible = (a: Published) => {
      if (!secret) return !!a.visibility.public
      if (!req.headers['x-account']) return true
      return !!a.visibility.public || !!a.visibility.privateAccess?.some(p => p.type === account?.type && p.id === account?.id)
    }

    if (url.pathname === '/api/v1/artefacts') {
      hits.listing++
      const results = [...artefacts.values()].filter(a => isVisible(a)).map(a => ({ _id: a.id, category: 'skill', dataUpdatedAt: a.dataUpdatedAt.toISOString() }))
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ results, count: results.length }))
      return
    }
    const match = url.pathname.match(/^\/api\/v1\/artefacts\/([^/]+)\/download$/)
    if (match) {
      hits.download++
      const artefact = artefacts.get(decodeURIComponent(match[1]))
      if (!secret) { res.writeHead(401).end(); return }
      if (!artefact) { res.writeHead(404).end(); return }
      const respond = () => {
        const since = req.headers['if-modified-since']
        if (since && Math.floor(Date.parse(since) / 1000) >= Math.floor(artefact.dataUpdatedAt.getTime() / 1000)) { res.writeHead(304).end(); return }
        res.writeHead(200, {
          'content-type': 'application/gzip',
          'last-modified': artefact.dataUpdatedAt.toUTCString(),
          'x-artefact-version': '1.0.0',
          'content-length': artefact.tarball.length
        }).end(artefact.tarball)
      }
      const hold = held.get(artefact.id)
      if (hold) hold.push(respond); else respond()
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  return {
    url,
    secretKey,
    hits,
    /** publishing again under the same id is a new version with a later dataUpdatedAt */
    async publish (id: string, files: Record<string, string>, visibility: Visibility) {
      clock += 10_000
      artefacts.set(id, { id, files, visibility, dataUpdatedAt: new Date(clock), tarball: await buildTarball(files) })
    },
    /** answers to this artefact's downloads wait for the returned release function */
    holdDownloads (id: string) {
      const pending: (() => void)[] = []
      held.set(id, pending)
      return () => { held.delete(id); pending.forEach(respond => respond()) }
    },
    unpublish (id: string) { artefacts.delete(id) },
    fail (status: number | 'hang' | undefined) { failure = status },
    async close () {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
  }
}
