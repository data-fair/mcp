import { createServer, type Server } from 'node:http'
import { createHttpTerminator, type HttpTerminator } from 'http-terminator'
import { startObserver, stopObserver } from '@data-fair/lib-node/observer.js'
import config from '#config'
import { createDispatcher } from './site-fetch.ts'
import { createComposition, type Composition } from './composition.ts'
import { createApp } from './app.ts'

let server: Server
let httpTerminator: HttpTerminator
let composition: Composition

export const start = async () => {
  const mainSiteUrl = config.mainSiteUrl ?? config.portalUrl
  if (!mainSiteUrl) throw new Error('MAIN_SITE_URL (or PORTAL_URL) is required in http mode')

  const dispatcher = createDispatcher({ mainSiteUrl })
  composition = await createComposition({ config, dispatcher, mainSiteUrl })

  server = createServer(createApp(composition, dispatcher))
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
  await httpTerminator.terminate()
  composition.close()
  if (config.observer.active) await stopObserver()
}
