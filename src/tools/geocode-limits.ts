/**
 * The IGN Géoplateforme limits callers by source IP (50 requests per second): past that it refuses
 * our servers' addresses for everyone. Two buckets guard it (data-fair
 * docs/architecture/agent-rate-limiting.md, "The geocoding tool"): a global one, per instance, under
 * IGN's limit; and one per caller, so no single caller can fill the global one. In memory, per instance.
 */
import { RateLimiter } from 'limiter'

export interface GeocodeLimits {
  global: { nb: number, duration: number }
  perCaller: { nb: number, duration: number }
}

export type Taken = { ok: true } | { ok: false, retryAfterSeconds: number, reason: string }

/** A bound on memory: forwarded IPs are attacker-chosen. Oldest entries go first. */
const MAX_CALLERS = 100_000

export function createGeocodeLimits (limits: GeocodeLimits): (callerKey: string | undefined) => Taken {
  const global = new RateLimiter({ tokensPerInterval: limits.global.nb, interval: limits.global.duration * 1000 })
  const callers = new Map<string, RateLimiter>()
  return (callerKey) => {
    if (!callerKey) return { ok: false, retryAfterSeconds: 0, reason: 'no caller to account the request to' }
    let caller = callers.get(callerKey)
    if (!caller) {
      if (callers.size >= MAX_CALLERS) callers.delete(callers.keys().next().value!)
      caller = new RateLimiter({ tokensPerInterval: limits.perCaller.nb, interval: limits.perCaller.duration * 1000 })
      callers.set(callerKey, caller)
    }
    if (!caller.tryRemoveTokens(1)) return { ok: false, retryAfterSeconds: limits.perCaller.duration, reason: 'your geocoding budget is spent' }
    if (!global.tryRemoveTokens(1)) return { ok: false, retryAfterSeconds: limits.global.duration, reason: 'the geocoder is busy' }
    return { ok: true }
  }
}
