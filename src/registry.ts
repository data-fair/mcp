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

const messageOf = (err: unknown) => err instanceof Error ? err.message : String(err)

const withTimeout = <T>(promise: Promise<T>, ms: number, what: string): Promise<T> => {
  let timer: NodeJS.Timeout
  const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export function createRegistrySkills (options: RegistrySkillsOptions): RegistrySkills {
  const timeoutMs = options.timeoutMs ?? 5000
  const baseUrl = options.url.replace(/\/+$/, '')

  // keyed by `type:id` or `public`: the account decides visibility, never the credential
  const listings = new Map<string, Listing>()
  const listingsInFlight = new Map<string, Promise<ArtefactRef[]>>()
  // keyed by `id@dataUpdatedAt`; content is the same for everyone who may list the artefact
  const contents = new Map<string, Promise<Skill | undefined>>()
  const invalid = new Map<string, string>()
  let error: string | undefined

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
        error = undefined
        return artefacts
      }).finally(() => listingsInFlight.delete(key))
      listingsInFlight.set(key, inFlight)
    }
    try {
      return await inFlight
    } catch (err) {
      error = `registry listing failed: ${messageOf(err)}`
      return cached?.artefacts
    }
  }

  const loadContent = async ({ id, dataUpdatedAt }: ArtefactRef): Promise<Skill | undefined> => {
    // the package is public to whoever listed it, so the download carries no account
    const { path } = await withTimeout(ensureArtefact({
      registryUrl: baseUrl, secretKey: options.secretKey, artefactId: id, cacheDir: options.cacheDir
    }), timeoutMs * 6, `registry download of ${id}`)
    const parsed = await parseSkillPackage(path)
    if ('error' in parsed) {
      invalid.set(id, parsed.error)
      return undefined
    }
    invalid.delete(id)
    for (const warning of parsed.warnings) console.warn(`registry skill ${id}@${dataUpdatedAt}: ${warning}`)
    return parsed.skill
  }

  const contentFor = async (ref: ArtefactRef): Promise<Skill | undefined> => {
    const key = `${ref.id}@${ref.dataUpdatedAt}`
    let content = contents.get(key)
    if (!content) {
      content = loadContent(ref)
      contents.set(key, content)
      // failures are not cached, successes (including invalid packages) are
      content.catch(() => { if (contents.get(key) === content) contents.delete(key) })
      // drop superseded versions of the same artefact
      for (const other of contents.keys()) if (other !== key && other.startsWith(`${ref.id}@`)) contents.delete(other)
    }
    try {
      return await content
    } catch (err) {
      error = `registry download of ${ref.id} failed: ${messageOf(err)}`
      return undefined
    }
  }

  return {
    async skillsFor (account) {
      const artefacts = await listingFor(account)
      if (!artefacts) return []
      const skills = await Promise.all(artefacts.map(contentFor))
      return skills.filter((skill): skill is Skill => !!skill)
    },
    status () {
      return { ...(error ? { error } : {}), invalid: [...invalid].map(([id, error]) => ({ id, error })) }
    }
  }
}
