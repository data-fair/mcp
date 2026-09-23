import { createServer, type Server } from 'node:http'
import { createHttpTerminator, type HttpTerminator } from 'http-terminator'
import { startObserver, stopObserver } from '@data-fair/lib-node/observer.js'
import config, { type ApiConfig } from '#config'
import { createDispatcher, type SiteDispatcher } from './site-fetch.ts'
import { createComposition, type Composition } from './composition.ts'
import { createApp } from './app.ts'

export interface Runtime {
  app: ReturnType<typeof createApp>
  composition: Composition
  dispatcher: SiteDispatcher
  mainSiteUrl: string
}

/**
 * Everything start() needs beyond listening: resolves mainSiteUrl (falling back to
 * portalUrl, writing the resolved value back so app.ts/context.ts can keep reading
 * `config.mainSiteUrl!` directly), then builds the dispatcher, the composition and the
 * app over it — the dispatcher carries upstreamProxyHost itself (see SiteDispatcher), so
 * every consumer built from it honours the same proxy, never a separately passed option
 * that could drift out of sync with it.
 */
export async function createRuntime (config: ApiConfig): Promise<Runtime> {
  const mainSiteUrl = config.mainSiteUrl ?? config.portalUrl
  if (!mainSiteUrl) throw new Error('MAIN_SITE_URL (or PORTAL_URL) is required in http mode')
  config.mainSiteUrl ??= mainSiteUrl

  const dispatcher = createDispatcher({ mainSiteUrl, upstreamProxyHost: config.upstreamProxyHost, timeoutMs: 30_000 })
  const composition = await createComposition({ config, dispatcher, mainSiteUrl })
  const app = createApp(composition, dispatcher)

  return { app, composition, dispatcher, mainSiteUrl }
}

let server: Server
let httpTerminator: HttpTerminator | undefined
let composition: Composition | undefined

export const start = async () => {
  const runtime = await createRuntime(config)
  composition = runtime.composition

  server = createServer(runtime.app)
  httpTerminator = createHttpTerminator({ server })

  // cf https://connectreport.com/blog/tuning-http-keep-alive-in-node-js/
  // timeout is often 60s on the reverse proxy, better to a have a longer one here
  // so that interruption is managed downstream instead of here
  server.keepAliveTimeout = (60 * 1000) + 1000
  server.headersTimeout = (60 * 1000) + 2000

  if (config.observer.active) await startObserver(config.observer.port)
  server.listen(config.port)
  await new Promise(resolve => server.once('listening', resolve))

  console.log(`API server listening on port ${config.port}`)
}

export const stop = async () => {
  await httpTerminator?.terminate()
  composition?.close()
  if (config.observer.active) await stopObserver()
}
