/**
 * The platform document kept live, and the two tool sets served from it: the platform set
 * (`/mcp`, stdio) and the datasets set (`/datasets/mcp`), each cut by the caller's scopes with
 * geocode_address appended.
 */
import { toolsForScopes, type FileLoadOptions, type ToolSet } from '@data-fair/openapi-mcp'
import type { ApiConfig } from '#config'
import { createLiveDocument } from './live-document.ts'
import { prepareEditorSchema } from './editor-schema.ts'
import { datasetsToolSet } from './datasets-server.ts'
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

export interface Platform {
  /** the platform set for these scopes (undefined: unscoped), geocode_address appended */
  platform (scopes: string[] | undefined): ToolSet
  /** the datasets set for these scopes, geocode_address appended */
  datasets (scopes: string[] | undefined): ToolSet
  status (): { services: unknown, error?: string, lastRefresh?: Date, missingDatasetsTools: string[] }
  onChange (cb: () => void): () => void
  refresh (): Promise<boolean>
  close (): void
}

export async function createPlatform (options: { config: Pick<ApiConfig, 'locale' | 'docPath' | 'refreshInterval' | 'extraTools' | 'files' | 'trustedForwarder'>, dispatcher: SiteDispatcher, mainSiteUrl: string }): Promise<Platform> {
  const { config, dispatcher, mainSiteUrl } = options
  const live = await createLiveDocument(`${mainSiteUrl}${config.docPath}`, {
    fetch: siteFetch(mainSiteUrl, { mainSiteUrl, dispatcher, trustedForwarder: config.trustedForwarder }),
    locale: config.locale,
    lint: 'warn',
    // the parsed JSON for code mode (the agents service); the text stays what a model reads
    structuredContent: true,
    // load validates the prefixes: a malformed one fails the first load, which fails the boot
    files: fileOptions(config.files),
    prepareEditorSchema
  })

  const geocode = config.extraTools.geocodeAddress.active ? geocodeAddressTool({ locale: config.locale as 'en' | 'fr', limits: config.extraTools.geocodeAddress.limits }) : undefined
  const withGeocode = (toolSet: ToolSet): ToolSet => geocode ? { ...toolSet, tools: [...toolSet.tools, geocode] } : toolSet

  let platformBase: ToolSet
  let datasetsBase: ToolSet
  let missingDatasetsTools: string[]
  let lastRefresh: Date | undefined
  const derive = (toolSet: ToolSet) => {
    // Structured content, but no output schema: the response schemas of the document cannot be
    // honoured exactly (README, "Structured results").
    platformBase = { ...toolSet, tools: toolSet.tools.map(({ outputSchema, ...tool }) => tool) }
    const datasets = datasetsToolSet(platformBase)
    datasetsBase = datasets.toolSet
    missingDatasetsTools = datasets.missing
    if (missingDatasetsTools.length) console.warn(`datasets server: the platform document lacks ${missingDatasetsTools.join(', ')}`)
  }
  derive(live.toolSet)

  const listeners = new Set<() => void>()
  live.onChange(toolSet => {
    derive(toolSet)
    for (const cb of listeners) {
      try { cb() } catch (err: unknown) { console.error('onChange listener failed:', err) }
    }
  })

  const refresh = async () => {
    const changed = await live.refresh()
    if (!live.error) lastRefresh = new Date()
    return changed
  }
  const timer = config.refreshInterval > 0
    ? setInterval(() => { refresh().catch((err: unknown) => console.error('refresh failed:', err)) }, config.refreshInterval * 1000).unref()
    : undefined

  return {
    platform: scopes => withGeocode(toolsForScopes(platformBase, scopes)),
    datasets: scopes => withGeocode(toolsForScopes(datasetsBase, scopes)),
    status: () => ({ services: live.document['x-platform']?.services, error: live.error, lastRefresh, missingDatasetsTools }),
    onChange (cb) { listeners.add(cb); return () => listeners.delete(cb) },
    refresh,
    close () { if (timer) clearInterval(timer) }
  }
}
