import { RateLimiter } from 'limiter'
import { createHash } from 'node:crypto'
import { type Request, type Response, type NextFunction } from 'express'
import { reqIp } from '@data-fair/lib-express/req-origin.js'
import Debug from 'debug'
import config from '#config'

const debug = Debug('rate-limiting')

// IMPORTANT NOTE: all rate limiting is based on memory only, to be strictly applied when scaling the service
// load balancing has to hash on a stable caller attribute: the ingress hashes on the client address,
// which keeps an authenticated caller on one pod as long as its IP is stable

type RateLimiterEntry = {
  lastUsed: number,
  rateLimiter: RateLimiter
}

/** Credentials are not verified here, so made-up identities from one address never get more than this, together. */
const IP_CEILING_FACTOR = 10
/** A bound on memory: made-up identities must not grow the map until the pod dies. Oldest entries go first. */
const MAX_ENTRIES = 100_000

const rateLimiters = new Map<string, RateLimiterEntry>()

// simple cleanup of the limiters every 20 minutes
setInterval(() => {
  const threshold = Date.now() - 20 * 60 * 1000
  for (const [key, entry] of rateLimiters) {
    if (entry.lastUsed < threshold) rateLimiters.delete(key)
  }
}, 20 * 60 * 1000).unref()

const bucket = (key: string, tokensPerInterval: number, intervalMs: number): RateLimiterEntry => {
  let entry = rateLimiters.get(key)
  if (!entry) {
    if (rateLimiters.size >= MAX_ENTRIES) {
      for (const oldest of rateLimiters.keys()) {
        rateLimiters.delete(oldest)
        if (rateLimiters.size < MAX_ENTRIES * 0.9) break
      }
    }
    entry = { lastUsed: Date.now(), rateLimiter: new RateLimiter({ tokensPerInterval, interval: intervalMs }) }
    rateLimiters.set(key, entry)
  }
  entry.lastUsed = Date.now()
  return entry
}

/** The client address: the reverse proxy's X-Forwarded-For, else the socket (in-cluster callers, or a misconfigured proxy). */
const clientIp = (req: Request): string => req.headers['x-forwarded-for'] ? reqIp(req) : (req.socket.remoteAddress ?? 'unknown')

const SESSION_COOKIE = /(?:^|;\s*)id_token=([^;]+)/

/**
 * Who a request claims to be: its session token (the `id_token` cookie, not the whole cookie
 * header, so unrelated cookies do not change the budget) or its API key. Not verified — the
 * per-address ceiling bounds what a made-up one can buy.
 */
const claimedIdentity = (req: Request): string | undefined => {
  const session = req.headers.cookie?.match(SESSION_COOKIE)?.[1]
  const apiKey = req.headers['x-apikey'] ?? req.headers['x-api-key']
  const secret = session ?? (Array.isArray(apiKey) ? apiKey[0] : apiKey)
  return secret ? createHash('sha256').update(secret).digest('hex') : undefined
}

/**
 * A request is counted twice: against its address's ceiling, then against its caller — its
 * claimed identity when it has one (callers behind one address keep their own budgets, a caller
 * moving between addresses keeps one), its address otherwise.
 */
const consume = (req: Request): { ok: boolean, key: string } => {
  const nb = config.defaultLimits.apiRate?.nb ?? 100
  const intervalMs = (config.defaultLimits.apiRate?.duration ?? 60) * 1000
  const ip = clientIp(req)
  if (!bucket(`ceiling:${ip}`, nb * IP_CEILING_FACTOR, intervalMs).rateLimiter.tryRemoveTokens(1)) return { ok: false, key: `ceiling:${ip}` }
  const identity = claimedIdentity(req)
  const key = identity ? `identity:${identity}` : `ip:${ip}`
  return { ok: bucket(key, nb, intervalMs).rateLimiter.tryRemoveTokens(1), key }
}

// Every caller is limited, in-cluster ones included: parity means no caller gets an unlimited path.
export const rateLimitingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const { ok, key } = consume(req)
  if (!ok) {
    debug('rate limit exceeded for', key)
    res.status(429).type('text/plain').send('Rate limit exceeded')
    return
  }
  next()
}
