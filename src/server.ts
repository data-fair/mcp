import { createServer, type Server } from 'node:http'
import { createHttpTerminator, type HttpTerminator } from 'http-terminator'
import { startObserver, stopObserver } from '@data-fair/lib-node/observer.js'
import config, { type ApiConfig } from '#config'
import { createDispatcher, type SiteDispatcher } from './site-fetch.ts'
import { session } from '@data-fair/lib-express'
import { createPlatform, type Platform } from './platform.ts'
import { createApp } from './app.ts'
import { sessionOptions } from './scopes.ts'

export interface Runtime {
  app: ReturnType<typeof createApp>
  platform: Platform
  dispatcher: SiteDispatcher
  mainSiteUrl: string
}

/**
 * Everything start() needs beyond listening: resolves mainSiteUrl (falling back to
 * portalUrl, writing the resolved value back so app.ts/context.ts can keep reading
 * `config.mainSiteUrl!` directly), initializes the session reader on the private directory
 * (scope-aware: the credentials middleware reads the caller's scopes from it), then builds the
 * dispatcher, the platform and the app over it — the dispatcher carries upstreamProxyHost itself (see SiteDispatcher), so
 * every consumer built from it honours the same proxy, never a separately passed option
 * that could drift out of sync with it.
 */
export async function createRuntime (config: ApiConfig): Promise<Runtime> {
  const mainSiteUrl = config.mainSiteUrl ?? config.portalUrl
  if (!mainSiteUrl) throw new Error('MAIN_SITE_URL (or PORTAL_URL) is required in http mode')
  config.mainSiteUrl ??= mainSiteUrl

  const dispatcher = createDispatcher({ mainSiteUrl, upstreamProxyHost: config.upstreamProxyHost, timeoutMs: 30_000 })
  session.init(config.privateDirectoryUrl, undefined, undefined, sessionOptions)
  const platform = await createPlatform({ config, dispatcher, mainSiteUrl })
  const app = createApp(platform, dispatcher)

  return { app, platform, dispatcher, mainSiteUrl }
}

let server: Server
let httpTerminator: HttpTerminator | undefined
let platform: Platform | undefined

export const start = async () => {
  const runtime = await createRuntime(config)
  platform = runtime.platform

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
  platform?.close()
  if (config.observer.active) await stopObserver()
}
