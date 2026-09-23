/**
 * One composer for the process, over the main site's index; the composed set for a profile
 * set, the compatibility alias, the extra tools, and the refresh loop.
 */
import { createComposer, type Composer, type ToolSet } from '@data-fair/openapi-mcp'
import type { Dispatcher } from 'undici'
import type { ApiConfig } from '#config'
import { siteFetch } from './site-fetch.ts'
import { geocodeAddressTool } from './tools/geocode-address.ts'

export interface Composition {
  composer: Composer
  /** the composed set for a request's profiles, extra tools joined */
  main (profiles: string[]): Promise<ToolSet>
  /** data-fair's explore operations under their pre-v2 names, plus geocode_address */
  alias (): Promise<ToolSet>
  lastRefresh (): Date | undefined
  close (): void
}

export async function createComposition (options: { config: Pick<ApiConfig, 'locale' | 'indexPath' | 'refreshInterval' | 'extraTools' | 'ignoreRateLimiting' | 'upstreamProxyHost'>, dispatcher: Dispatcher, mainSiteUrl: string }): Promise<Composition> {
  const { config, dispatcher, mainSiteUrl } = options
  const fetchFn = siteFetch(mainSiteUrl, { mainSiteUrl, dispatcher, ignoreRateLimiting: config.ignoreRateLimiting, upstreamProxyHost: config.upstreamProxyHost })
  const composer = await createComposer(`${mainSiteUrl}${config.indexPath}`, { fetch: fetchFn, locale: config.locale, lint: 'warn' })
  for (const s of composer.services) if (s.status !== 'ok') console.warn(`service ${s.id}: ${s.status}${s.reason ? ` — ${s.reason}` : ''}`)

  const geocode = config.extraTools.geocodeAddress.active ? geocodeAddressTool({ locale: config.locale as 'en' | 'fr' }) : undefined
  const withExtras = (toolSet: ToolSet): ToolSet => {
    if (!geocode || !toolSet.profiles.some(p => config.extraTools.geocodeAddress.profiles.includes(p))) return toolSet
    return { ...toolSet, tools: [...toolSet.tools, geocode] }
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
      return withExtras((await composer.compose(['explore'], { services: ['data-fair'], namePrefix: '' })).toolSet)
    },
    lastRefresh: () => lastRefresh,
    close () { if (timer) clearInterval(timer) }
  }
}
