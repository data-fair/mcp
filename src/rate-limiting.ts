import { RateLimiter } from 'limiter'
import { type Request, type Response, type NextFunction } from 'express'
import { reqIp, reqIsInternal } from '@data-fair/lib-express/req-origin.js'
import Debug from 'debug'
import config from '#config'

const debug = Debug('rate-limiting')

// IMPORTANT NOTE: all rate limiting is based on memory only, to be strictly applied when scaling the service
// load balancing has to be based on a hash of the rate limiting key i.e the origin IP

type RateLimiterEntry = {
  lastUsed: number,
  rateLimiter: RateLimiter
}

const rateLimiters: Record<string, RateLimiterEntry> = {}

// simple cleanup of the limiters every 20 minutes
setInterval(() => {
  const threshold = Date.now() - 20 * 60 * 1000
  for (const key of Object.keys(rateLimiters)) {
    if (rateLimiters[key].lastUsed < threshold) delete rateLimiters[key]
  }
}, 20 * 60 * 1000).unref()

/** The client address: the reverse proxy's X-Forwarded-For, else the socket (a misconfigured proxy must not turn into a 500). */
const clientIp = (req: Request): string => req.headers['x-forwarded-for'] ? reqIp(req) : (req.socket.remoteAddress ?? 'unknown')

const consume = (req: Request): boolean => {
  const ip = clientIp(req)
  if (!rateLimiters[ip]) {
    const nb = config.defaultLimits.apiRate?.nb ?? 100
    const duration = config.defaultLimits.apiRate?.duration ?? 60
    rateLimiters[ip] = {
      lastUsed: Date.now(),
      rateLimiter: new RateLimiter({
        tokensPerInterval: nb,
        interval: duration * 1000
      })
    }
  }
  const entry = rateLimiters[ip]
  entry.lastUsed = Date.now()
  return entry.rateLimiter.tryRemoveTokens(1)
}

export const rateLimitingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // an internal caller (no reverse proxy in front of it) has no X-Forwarded-For to key on,
  // and reqIp would throw; it is also not who per-IP limiting is meant to constrain.
  if (reqIsInternal(req)) return next()
  if (!consume(req)) {
    debug('rate limit exceeded for', clientIp(req))
    res.status(429).type('text/plain').send('Rate limit exceeded')
    return
  }
  next()
}
