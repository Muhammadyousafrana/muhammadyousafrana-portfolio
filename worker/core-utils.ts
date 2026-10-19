/**
 * Shared Worker binding types and AppController routing helpers.
 * Keep changes here small and deliberate: route security depends on these
 * naming and sharding rules staying stable.
 */
import type { AppController, ContactHandoffClaimResult } from './app-controller'

export interface Env {
  AI: Ai
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
  APP_CONTROLLER: DurableObjectNamespace<AppController>
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

const getAppController = (env: Env, scope: string): DurableObjectStub<AppController> => {
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
const getRateLimitController = (env: Env, key: string): DurableObjectStub<AppController> => {
  const shard = hashShard(key)
  return getAppController(env, `${RATE_LIMIT_SCOPE_PREFIX}:${shard}`)
}

// Both halves of one dispatch (claim, then settle) hash the same key, so they
// always land on the same controller instance, where DO input gates make the
// claim check atomic.
const getContactHandoffController = (env: Env, key: string): DurableObjectStub<AppController> => {
  const shard = hashShard(key)
  return getAppController(env, `${CONTACT_HANDOFF_SCOPE_PREFIX}:${shard}`)
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

export async function consumeRateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const controller = getRateLimitController(env, key)
  return controller.consumeRateLimit(key, limit, windowSeconds)
}

export async function claimContactHandoffDispatch(
  env: Env,
  key: string
): Promise<ContactHandoffClaimResult> {
  const controller = getContactHandoffController(env, key)
  return controller.claimContactHandoffDispatch(key)
}

export async function settleContactHandoffDispatch(
  env: Env,
  key: string,
  claimId: string,
  result: unknown | null
): Promise<void> {
  const controller = getContactHandoffController(env, key)
  await controller.settleContactHandoffDispatch(key, claimId, result)
}
