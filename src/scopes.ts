/**
 * The caller's credentials, checked before the MCP handler: a cookie session or a bearer access
 * token is verified by lib-express's session (the server never decodes a JWT itself) and its
 * scopes reach the handler in an internal header, which a client can never set since it is
 * always deleted first. An API key is passed on unscoped: data-fair checks it.
 */
import type { IncomingMessage } from 'node:http'
import type { RequestHandler } from 'express'
import { session, markScopeChecked, httpError } from '@data-fair/lib-express'
import { siteFetch, type SiteDispatcher } from './site-fetch.ts'

export const SCOPES_HEADER = 'x-mcp-scopes'

/** a cookie session or a bearer access token, the credentials a session is read from */
const hasSessionCredential = (req: IncomingMessage) =>
  /(^|;\s*)id_token=/.test(req.headers.cookie ?? '') || /^bearer(\s|$)/i.test(req.headers.authorization ?? '')

/**
 * `required`: a caller without credentials is refused, a credential that does not verify fails
 * with its error (401 for a bad token, 5xx when the directory's keys cannot be read). Not
 * `required`: a credential that does not verify is dropped and the caller served anonymously.
 */
export function credentials (options: { required: boolean, mainSiteUrl: string }): RequestHandler {
  const main = new URL(options.mainSiteUrl)
  return async (req, res, next) => {
    delete req.headers[SCOPES_HEADER]
    if (!hasSessionCredential(req)) {
      if (options.required && !req.headers['x-apikey'] && !req.headers['x-api-key']) {
        res.status(401).type('text').send('credentials required')
        return
      }
      return next()
    }
    // an in-cluster caller has no forwarded headers: its bearer is addressed to the main site
    const sessionReq = req.headers['x-forwarded-host']
      ? req
      : { headers: { ...req.headers, 'x-forwarded-host': main.host, 'x-forwarded-proto': main.protocol.replace(':', '') } } as unknown as IncomingMessage
    // the scopes are checked per tool, by the handler that reads them
    markScopeChecked(sessionReq)
    let scopes: string[] | undefined
    try {
      const state = await session.req(sessionReq)
      // an id_token cookie without its signature reads as no session at all: not a verified caller
      if (!state.user) throw httpError(401, 'invalid session')
      scopes = state.scopes
    } catch (err) {
      if (options.required) throw err
      delete req.headers.cookie
      delete req.headers.authorization
      return next()
    }
    if (scopes) req.headers[SCOPES_HEADER] = JSON.stringify(scopes)
    next()
  }
}

/** The scopes the credentials middleware verified, undefined for an unscoped or anonymous caller. */
export function scopesOf (request: Request | undefined): string[] | undefined {
  const header = request?.headers.get(SCOPES_HEADER)
  return header ? JSON.parse(header) : undefined
}

/**
 * The stdio caller's session: an API key is the identity (data-fair checks it per call, no
 * scopes to read); otherwise the main site's my-session answers for whatever the environment
 * injects (a proxy adding a session). No forwarder secret is sent.
 */
export async function stdioSession (options: { mainSiteUrl: string, dispatcher: SiteDispatcher, apiKey?: string }): Promise<{ authenticated: boolean, scopes?: string[] }> {
  if (options.apiKey) return { authenticated: true }
  const fetch = siteFetch(options.mainSiteUrl, { mainSiteUrl: options.mainSiteUrl, dispatcher: options.dispatcher })
  const res = await fetch(`${options.mainSiteUrl}/simple-directory/api/auth/my-session`)
  if (!res.ok) return { authenticated: false }
  const body = await res.json() as { user?: unknown, scopes?: string[] }
  return body.user ? { authenticated: true, scopes: body.scopes } : { authenticated: false }
}
