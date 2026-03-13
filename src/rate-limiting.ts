import { RateLimiter } from 'limiter'
import { type Request, type Response, type NextFunction } from 'express'
import { reqIp } from '@data-fair/lib-express/req-origin.js'
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

const consume = (req: Request): boolean => {
  const ip = reqIp(req)
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
  if (!consume(req)) {
    debug('rate limit exceeded for', reqIp(req))
    res.status(429).type('text/plain').send('Rate limit exceeded')
    return
  }
  next()
}
