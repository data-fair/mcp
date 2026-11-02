import { ensureArtefact } from '@data-fair/lib-node-registry'
import type { Skill } from '@data-fair/openapi-mcp'
import type { CallerAccount } from './scopes.ts'
import { parseSkillPackage } from './registry-skills.ts'

export interface RegistrySkillsOptions {
  url: string
  secretKey: string
  /** seconds a listing is reused before the registry is asked again */
  listingTtl: number
  cacheDir: string
  /** listing timeout, default 5000 */
  timeoutMs?: number
}

export interface RegistrySkills {
  skillsFor (account: CallerAccount | undefined): Promise<Skill[]>
  status (): { error?: string, invalid: { id: string, error: string }[] }
}

interface ArtefactRef { id: string, dataUpdatedAt: string }
interface Listing { at: number, artefacts: ArtefactRef[] }
/** the one content entry kept per artefact; the promise never rejects */
interface Content { dataUpdatedAt: string, promise: Promise<Skill | undefined> }

const messageOf = (err: unknown) => err instanceof Error ? err.message : String(err)
const time = (iso: string) => new Date(iso).getTime()

export function createRegistrySkills (options: RegistrySkillsOptions): RegistrySkills {
  const timeoutMs = options.timeoutMs ?? 5000
  const baseUrl = options.url.replace(/\/+$/, '')

  // keyed by `type:id` or `public`: the account decides visibility, never the credential
  const listings = new Map<string, Listing>()
  const listingsInFlight = new Map<string, Promise<ArtefactRef[]>>()
  // one entry per artefact id: the content is the same for everyone who may list the artefact
  const contents = new Map<string, Content>()
  // ensureArtefact runs one at a time per artefact id (shared extraction dirs)
  const slots = new Map<string, Promise<unknown>>()
  const invalid = new Map<string, string>()
  // latest failure per source (listing key, artefact id), the most recent last
  const errors = new Map<string, string>()
  const setError = (source: string, message: string) => { errors.delete(source); errors.set(source, message) }

  const fetchListing = async (account: CallerAccount | undefined): Promise<ArtefactRef[]> => {
    // anonymous must carry no secret: the secret alone bypasses the registry's visibility rules
    const headers: Record<string, string> = account
      ? { 'x-secret-key': options.secretKey, 'x-account': JSON.stringify({ type: account.type, id: account.id }) }
      : {}
    const res = await fetch(`${baseUrl}/api/v1/artefacts?category=skill&size=100`, { headers, signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`registry listing answered ${res.status}`)
    const body = await res.json() as { results?: ArtefactRef[] }
    if (!Array.isArray(body.results)) throw new Error('registry listing has no results')
    return body.results.map(({ _id, id, dataUpdatedAt }: any) => ({ id: _id ?? id, dataUpdatedAt }))
  }

  const listingFor = async (account: CallerAccount | undefined): Promise<ArtefactRef[] | undefined> => {
    const key = account ? `${account.type}:${account.id}` : 'public'
    const cached = listings.get(key)
    if (cached && Date.now() - cached.at < options.listingTtl * 1000) return cached.artefacts
    let inFlight = listingsInFlight.get(key)
    if (!inFlight) {
      inFlight = fetchListing(account).then(artefacts => {
        listings.set(key, { at: Date.now(), artefacts })
        errors.delete(`listing ${key}`)
        return artefacts
      }).finally(() => listingsInFlight.delete(key))
      listingsInFlight.set(key, inFlight)
    }
    try {
      return await inFlight
    } catch (err) {
      setError(`listing ${key}`, `registry listing failed: ${messageOf(err)}`)
      return cached?.artefacts
    }
  }

  const download = async (id: string) => {
    // the package is public to whoever listed it, so the download carries no account
    // no timeout here: ensureArtefact cannot be aborted, so the id's slot stays held until it settles,
    // and callers are bounded by their own wait
    const { path } = await ensureArtefact({
      registryUrl: baseUrl, secretKey: options.secretKey, artefactId: id, cacheDir: options.cacheDir
    })
    return path
  }

  const loadContent = async ({ id, dataUpdatedAt }: ArtefactRef): Promise<Skill | undefined> => {
    const path = await download(id)
    const parsed = await parseSkillPackage(path)
    if ('error' in parsed) {
      // an unreadable extraction is a download problem, not a verdict on the package
      if (parsed.error.startsWith('cannot read package')) throw new Error(parsed.error)
      invalid.set(id, parsed.error)
      return undefined
    }
    invalid.delete(id)
    for (const warning of parsed.warnings) console.warn(`registry skill ${id}@${dataUpdatedAt}: ${warning}`)
    return parsed.skill
  }

  const startContent = (ref: ArtefactRef): Content => {
    const previous = slots.get(ref.id) ?? Promise.resolve()
    const run = previous.then(() => loadContent(ref))
    // the slot is held until the run really settles, even after callers stopped waiting
    slots.set(ref.id, run.catch(() => {}))
    const content: Content = {
      dataUpdatedAt: ref.dataUpdatedAt,
      promise: run.then(skill => { errors.delete(`download ${ref.id}`); return skill }, err => {
        // failures are not cached
        if (contents.get(ref.id) === content) contents.delete(ref.id)
        setError(`download ${ref.id}`, `registry download of ${ref.id} failed: ${messageOf(err)}`)
        return undefined
      })
    }
    contents.set(ref.id, content)
    return content
  }

  const contentFor = (ref: ArtefactRef): Promise<Skill | undefined> => {
    const existing = contents.get(ref.id)
    // an older listed value never evicts newer content
    const content = existing && time(existing.dataUpdatedAt) >= time(ref.dataUpdatedAt) ? existing : startContent(ref)
    // a request waits for uncached content at most timeoutMs, the load goes on in the background
    let timer: NodeJS.Timeout
    const giveUp = new Promise<undefined>(resolve => { timer = setTimeout(resolve, timeoutMs, undefined) })
    return Promise.race([content.promise, giveUp]).finally(() => clearTimeout(timer))
  }

  return {
    async skillsFor (account) {
      const artefacts = await listingFor(account)
      if (!artefacts) return []
      const skills = await Promise.all(artefacts.map(contentFor))
      return skills.filter((skill): skill is Skill => !!skill)
    },
    status () {
      const error = [...errors.values()].at(-1)
      return { ...(error ? { error } : {}), invalid: [...invalid].map(([id, error]) => ({ id, error })) }
    }
  }
}
