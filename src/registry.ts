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

/** a listed skill and the artefact it comes from; the id never reaches the served skill */
export interface RegistrySkill { id: string, skill: Skill }

export interface RegistrySkills {
  skillsFor (account: CallerAccount | undefined): Promise<RegistrySkill[]>
  status (): { error?: string, invalid: { id: string, error: string }[] }
}

interface ArtefactRef { id: string, dataUpdatedAt?: string }
interface Listing { at: number, artefacts: ArtefactRef[] }
/** the latest version started for an artefact; the promise never rejects */
interface Content { dataUpdatedAt?: string, promise: Promise<Skill | undefined> }
/** the latest version loaded for an artefact (no skill: the package is invalid) */
interface Loaded { dataUpdatedAt?: string, skill: Skill | undefined }

const messageOf = (err: unknown) => err instanceof Error ? err.message : String(err)

/** Whether a listed version is newer than the one held: an equal string never is, so a missing or unparsable value loads once. */
const isNewer = (listed: string | undefined, held: string | undefined) => {
  if (listed === held) return false
  return !(Date.parse(listed ?? '') <= Date.parse(held ?? ''))
}

export function createRegistrySkills (options: RegistrySkillsOptions): RegistrySkills {
  const timeoutMs = options.timeoutMs ?? 5000
  const listingTtlMs = options.listingTtl * 1000
  const baseUrl = options.url.replace(/\/+$/, '')

  // keyed by `type:id` or `public`: the account decides visibility, never the credential
  const listings = new Map<string, Listing>() // the last good listing
  const listingFailures = new Map<string, number>() // when the last listing failed, until one succeeds
  const listingsInFlight = new Map<string, Promise<ArtefactRef[] | undefined>>()
  const truncated = new Set<string>()
  // per artefact id: the content is the same for everyone who may list the artefact
  const contents = new Map<string, Content>()
  const loaded = new Map<string, Loaded>()
  // ensureArtefact runs one at a time per artefact id (shared extraction dirs)
  const slots = new Map<string, Promise<unknown>>()
  const invalid = new Map<string, string>()
  // latest failure per source (listing key, artefact id), the most recent last; logged when it starts or changes
  const errors = new Map<string, string>()
  const setError = (source: string, message: string) => {
    if (errors.get(source) !== message) console.warn(message)
    errors.delete(source)
    errors.set(source, message)
  }

  const fetchListing = async (account: CallerAccount | undefined): Promise<{ artefacts: ArtefactRef[], count: number }> => {
    // anonymous must carry no secret: the secret alone bypasses the registry's visibility rules
    const headers: Record<string, string> = account
      ? { 'x-secret-key': options.secretKey, 'x-account': JSON.stringify({ type: account.type, id: account.id }) }
      : {}
    const res = await fetch(`${baseUrl}/api/v1/artefacts?category=skill&size=100`, { headers, signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`registry listing answered ${res.status}`)
    const body = await res.json() as { results?: ArtefactRef[], count?: number }
    if (!Array.isArray(body.results)) throw new Error('registry listing has no results')
    const artefacts = body.results.map(({ _id, id, dataUpdatedAt }: any) => ({ id: _id ?? id, dataUpdatedAt }))
    return { artefacts, count: typeof body.count === 'number' ? body.count : artefacts.length }
  }

  /** one refresh in flight per key; never rejects (undefined: failed) */
  const refreshListing = (key: string, account: CallerAccount | undefined) => {
    let inFlight = listingsInFlight.get(key)
    if (inFlight) return inFlight
    inFlight = fetchListing(account).then(({ artefacts, count }) => {
      listings.set(key, { at: Date.now(), artefacts })
      listingFailures.delete(key)
      errors.delete(`listing ${key}`)
      // no pagination: past one page, the rest is not served
      if (count <= artefacts.length) truncated.delete(key)
      else if (!truncated.has(key)) {
        truncated.add(key)
        console.warn(`registry listing for ${key}: ${count} skills, only the first ${artefacts.length} served`)
      }
      return artefacts
    }, err => {
      listingFailures.set(key, Date.now())
      setError(`listing ${key}`, `registry listing for ${key} failed: ${messageOf(err)}`)
      return undefined
    }).finally(() => listingsInFlight.delete(key))
    listingsInFlight.set(key, inFlight)
    return inFlight
  }

  const listingFor = async (account: CallerAccount | undefined): Promise<ArtefactRef[] | undefined> => {
    const key = account ? `${account.type}:${account.id}` : 'public'
    const cached = listings.get(key)
    const now = Date.now()
    if (cached && now - cached.at < listingTtlMs) return cached.artefacts
    // after a failure the registry is left alone for a listingTtl: the last good listing, or none
    const failedAt = listingFailures.get(key)
    if (failedAt !== undefined && now - failedAt < listingTtlMs) return cached?.artefacts
    const refresh = refreshListing(key, account)
    // stale-while-revalidate: only a key never listed waits for the registry (bounded by timeoutMs)
    return cached ? cached.artefacts : await refresh
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
      if (invalid.get(id) !== parsed.error) console.warn(`registry skill ${id}@${dataUpdatedAt} skipped: ${parsed.error}`)
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
      promise: run.then(skill => {
        errors.delete(`download ${ref.id}`)
        loaded.set(ref.id, { dataUpdatedAt: ref.dataUpdatedAt, skill })
        return skill
      }, err => {
        // failures are not cached
        if (contents.get(ref.id) === content) contents.delete(ref.id)
        setError(`download ${ref.id}`, `registry download of ${ref.id} failed: ${messageOf(err)}`)
        return undefined
      })
    }
    contents.set(ref.id, content)
    return content
  }

  const contentFor = async (ref: ArtefactRef): Promise<Skill | undefined> => {
    const latest = contents.get(ref.id)
    const done = loaded.get(ref.id)
    // an older listed value never evicts newer content (a failed load leaves only the loaded one)
    const held = latest ?? done
    const content = held && !isNewer(ref.dataUpdatedAt, held.dataUpdatedAt) ? latest : startContent(ref)
    // a loaded version is served while a newer one loads: only a first-ever load is waited for
    if (done) return done.skill
    // that wait is at most timeoutMs, the load goes on in the background
    let timer: NodeJS.Timeout
    const giveUp = new Promise<undefined>(resolve => { timer = setTimeout(resolve, timeoutMs, undefined) })
    return Promise.race([content!.promise, giveUp]).finally(() => clearTimeout(timer))
  }

  return {
    async skillsFor (account) {
      const artefacts = await listingFor(account)
      if (!artefacts) return []
      const skills = await Promise.all(artefacts.map(async ref => ({ id: ref.id, skill: await contentFor(ref) })))
      return skills.filter((entry): entry is RegistrySkill => !!entry.skill)
    },
    status () {
      const error = [...errors.values()].at(-1)
      return { ...(error ? { error } : {}), invalid: [...invalid].map(([id, error]) => ({ id, error })) }
    }
  }
}
