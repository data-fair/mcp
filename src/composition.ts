/**
 * One composer for the process, over the main site's index; the composed set for a profile
 * set, the compatibility alias, the extra tools, and the refresh loop.
 */
import { createComposer, createFileFetcher, type Composer, type FileLoadOptions, type ToolSet } from '@data-fair/openapi-mcp'
import type { ApiConfig } from '#config'
import { siteFetch, type SiteDispatcher } from './site-fetch.ts'
import { geocodeAddressTool } from './tools/geocode-address.ts'

/** config.files (seconds, like refreshInterval) as openapi-mcp's file options (milliseconds). */
export function fileOptions (files: ApiConfig['files'] | undefined): FileLoadOptions {
  return {
    urlPrefixes: files?.urlPrefixes ?? [],
    maxSize: files?.maxSize,
    timeout: files?.timeout === undefined ? undefined : files.timeout * 1000
  }
}

export interface Composition {
  composer: Composer
  /** the composed set for a request's profiles, extra tools joined */
  main (profiles: string[]): Promise<ToolSet>
  /** data-fair's catalog operations under their pre-v2 names, plus geocode_address */
  alias (): Promise<ToolSet>
  lastRefresh (): Date | undefined
  close (): void
}

export async function createComposition (options: { config: Pick<ApiConfig, 'locale' | 'indexPath' | 'refreshInterval' | 'extraTools' | 'files' | 'trustedForwarder'>, dispatcher: SiteDispatcher, mainSiteUrl: string }): Promise<Composition> {
  const { config, dispatcher, mainSiteUrl } = options
  const fetchFn = siteFetch(mainSiteUrl, { mainSiteUrl, dispatcher, trustedForwarder: config.trustedForwarder })
  // a malformed prefix throws here, at boot: left to the composer it would only mark the whole service as errored
  createFileFetcher(fileOptions(config.files))
  const composer = await createComposer(`${mainSiteUrl}${config.indexPath}`, {
    fetch: fetchFn,
    locale: config.locale,
    lint: 'warn',
    // the parsed JSON for code mode (the agents service); the text stays what a model reads
    structuredContent: true,
    files: fileOptions(config.files)
  })
  for (const s of composer.services) if (s.status !== 'ok') console.warn(`service ${s.id}: ${s.status}${s.reason ? ` — ${s.reason}` : ''}`)

  const geocode = config.extraTools.geocodeAddress.active ? geocodeAddressTool({ locale: config.locale as 'en' | 'fr', limits: config.extraTools.geocodeAddress.limits }) : undefined
  // Structured content, but no output schema: the response schemas of the composed documents
  // cannot be honoured exactly (README, "Structured results").
  const withExtras = (toolSet: ToolSet): ToolSet => {
    const tools = toolSet.tools.map(({ outputSchema, ...tool }) => tool)
    if (!geocode || !toolSet.profiles.some(p => config.extraTools.geocodeAddress.profiles.includes(p))) return { ...toolSet, tools }
    return { ...toolSet, tools: [...tools, geocode] }
  }

  let lastRefresh: Date | undefined
  const timer = config.refreshInterval > 0
    ? setInterval(() => composer.refresh().then(() => { lastRefresh = new Date() }, (err: unknown) => console.error('refresh failed:', err)), config.refreshInterval * 1000).unref()
    : undefined
  composer.onChange(() => { lastRefresh = new Date() })

  return {
    composer,
    async main (profiles) {
      const known = new Set(composer.profiles().map(p => p.name))
      const unknown = profiles.find(p => !known.has(p))
      if (unknown) throw new Error(`unknown profile "${unknown}" (declared: ${[...known].join(', ')})`)
      return withExtras((await composer.compose(profiles)).toolSet)
    },
    async alias () {
      return withExtras((await composer.compose(['catalog'], { services: ['data-fair'], namePrefix: '' })).toolSet)
    },
    lastRefresh: () => lastRefresh,
    close () { if (timer) clearInterval(timer) }
  }
}
