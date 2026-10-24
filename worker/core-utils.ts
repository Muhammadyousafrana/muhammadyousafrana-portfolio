/**
 * Shared Worker binding types and AppController routing helpers.
 * Keep changes here small and deliberate: route security depends on these
 * naming and sharding rules staying stable.
 */
import type { ContactHandoffClaimResult } from './app-controller'

export interface Env {
  AI?: Ai
  AI_PROVIDER?: string
  CF_AI_BASE_URL?: string
  CF_AI_GATEWAY_TOKEN?: string
  GOOGLE_GENERATIVE_AI_API_KEY?: string
  // Optional bearer token for the GET /api/health/ai probe. When set, the
  // endpoint requires `Authorization: Bearer <token>`; when unset the probe is
  // open (still cost-bounded by its server-side cache).
  AI_HEALTH_TOKEN?: string
  ALLOWED_ORIGINS?: string
  SECURITY_HMAC_SECRET?: string
  TURNSTILE_SECRET_KEY?: string
  REQUIRE_TURNSTILE?: string
  SESSION_COOKIE_NAME?: string
  SESSION_COOKIE_MAX_AGE_SECONDS?: string
  RATE_LIMIT_WINDOW_SECONDS?: string
  CHAT_RATE_LIMIT_PER_TENANT?: string
  CHAT_RATE_LIMIT_PER_IP?: string
  AI_RATE_LIMIT_PER_TENANT?: string
  AI_RATE_LIMIT_PER_IP?: string
  MAX_CHAT_REQUEST_BYTES?: string
  MAX_FIT_ANALYZE_BYTES?: string
  MAX_CLIENT_ERROR_BYTES?: string
  CLIENT_ERROR_RATE_LIMIT_PER_IP?: string
  APP_CONTROLLER?: any
}

const RATE_LIMIT_SCOPE_PREFIX = 'rate-limit'
const CONTACT_HANDOFF_SCOPE_PREFIX = 'contact-handoff'
const SHARD_COUNT = 128

// Scope strings become Durable Object names, so keep them deterministic,
// ASCII-safe, and bounded before deriving controller ids.
const sanitizeScopeSegment = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9:_-]/g, '')
    .slice(0, 128)

// Spread independent keys across a fixed shard set so rate-limit and handoff
// traffic do not all pin to a single AppController instance.
const hashShard = (input: string): number => {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % SHARD_COUNT
}

const getAppController = (env: Env, scope: string): any => {
  const scopeName = sanitizeScopeSegment(scope) || 'controller'
  const id = env.APP_CONTROLLER.idFromName(scopeName)
  return env.APP_CONTROLLER.get(id)
}

// Changing either the scope prefix or shard derivation changes which Durable
// Object `idFromName()` resolves to, so any future rename needs a real deploy
// migration plan backed by repo/deploy history. Keep the rate-limit and
// contact-handoff namespaces separate even when two inputs hash to the same
// shard number.
// The shard only selects the AppController instance; that controller still
// stores rate limits and handoff claims by full key within it.
const getRateLimitController = (env: Env, key: string): any => {
  const shard = hashShard(key)
  return getAppController(env, `${RATE_LIMIT_SCOPE_PREFIX}:${shard}`)
}

// Both halves of one dispatch (claim, then settle) hash the same key, so they
// always land on the same controller instance, where DO input gates make the
// claim check atomic.
const getContactHandoffController = (env: Env, key: string): any => {
  const shard = hashShard(key)
  return getAppController(env, `${CONTACT_HANDOFF_SCOPE_PREFIX}:${shard}`)
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

// In-memory fallback stores for non-Cloudflare environments (Node.js on Heroku)
const inMemoryRateLimits = new Map<string, { count: number; resetAt: number }>()
const inMemoryHandoffClaims = new Map<string, { claimId: string; claimedAt: number }>()
const inMemoryHandoffSettled = new Map<string, { result: unknown; expiresAt: number }>()

export async function consumeRateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  if (env.APP_CONTROLLER) {
    const controller = getRateLimitController(env, key)
    return controller.consumeRateLimit(key, limit, windowSeconds)
  }
  const now = Date.now()
  const record = inMemoryRateLimits.get(key)
  if (!record || now >= record.resetAt) {
    const resetAt = now + windowSeconds * 1000
    inMemoryRateLimits.set(key, { count: 1, resetAt })
    return { allowed: true, remaining: limit - 1, resetAt }
  }
  if (record.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: record.resetAt }
  }
  record.count += 1
  return { allowed: true, remaining: limit - record.count, resetAt: record.resetAt }
}

export async function claimContactHandoffDispatch(
  env: Env,
  key: string
): Promise<ContactHandoffClaimResult> {
  if (env.APP_CONTROLLER) {
    const controller = getContactHandoffController(env, key)
    return controller.claimContactHandoffDispatch(key)
  }
  const now = Date.now()
  const settled = inMemoryHandoffSettled.get(key)
  if (settled && now < settled.expiresAt) {
    return { kind: 'completed', result: settled.result }
  }
  const pending = inMemoryHandoffClaims.get(key)
  if (pending && now - pending.claimedAt < 30_000) {
    return { kind: 'pending' }
  }
  const claimId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
  inMemoryHandoffClaims.set(key, { claimId, claimedAt: now })
  return { kind: 'claimed', claimId }
}

export async function settleContactHandoffDispatch(
  env: Env,
  key: string,
  claimId: string,
  result: unknown | null
): Promise<void> {
  if (env.APP_CONTROLLER) {
    const controller = getContactHandoffController(env, key)
    await controller.settleContactHandoffDispatch(key, claimId, result)
    return
  }
  const current = inMemoryHandoffClaims.get(key)
  if (!current || current.claimId !== claimId) return
  inMemoryHandoffClaims.delete(key)
  if (result !== null) {
    inMemoryHandoffSettled.set(key, { result, expiresAt: Date.now() + 86400000 })
  }
}
