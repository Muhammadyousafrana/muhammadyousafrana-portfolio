import type { Context, MiddlewareHandler } from 'hono'
import { consumeRateLimit, type Env } from './core-utils'

export const CTX_TENANT_ID = 'tenantId'
export const CTX_CLIENT_IP = 'clientIp'

type SecurityContextVariables = {
  [CTX_TENANT_ID]: string
  [CTX_CLIENT_IP]: string
}

type SecurityContext = Context<{ Bindings: Env; Variables: SecurityContextVariables }>

const DEFAULT_COOKIE_NAME = 'chat_tenant'
const DEFAULT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
// Short-lived signed proof that this tenant recently passed Turnstile. The chat
// and AI POST routes check this lease (a cookie that rides the same-origin
// request) instead of a fresh per-request token, so follow-up actions within
// the TTL need no new challenge. The client tracks the returned expiry and
// re-challenges before it lapses.
const CHAT_CHALLENGE_LEASE_COOKIE = 'chat_turnstile'
const CHAT_CHALLENGE_LEASE_TTL_SECONDS = 15 * 60
// Historical value from the WebSocket-transport era; kept because renaming it
// would invalidate every outstanding signed lease.
const CHAT_CHALLENGE_LEASE_PURPOSE = 'chat_ws'
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60
const DEFAULT_CHAT_REQUEST_BYTES = 16 * 1024
const DEFAULT_FIT_ANALYZE_BYTES = 24 * 1024
const DEFAULT_CLIENT_ERROR_BYTES = 16 * 1024
const CORS_ALLOW_METHODS = 'GET,POST,PUT,DELETE,OPTIONS'
const CORS_ALLOW_HEADERS = 'Content-Type,Authorization,X-Turnstile-Token'
const TENANT_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/
const encoder = new TextEncoder()
// Cache by the raw env value so repeated requests skip URL parsing entirely.
const allowedOriginsCache = new Map<string, Set<string>>()

interface TurnstileVerificationResponse {
  success: boolean
}

export type ResponseHeaderMap = Record<string, string>
export type RateLimitFailureCode = 'RATE_LIMITED'
export type TurnstileFailureCode =
  | 'VERIFICATION_REQUIRED'
  | 'VERIFICATION_FAILED'
  | 'VERIFICATION_UNAVAILABLE'

export type RateLimitDecision =
  | {
      ok: true
      headers: ResponseHeaderMap
    }
  | {
      ok: false
      status: 429
      error: string
      code: RateLimitFailureCode
      headers: ResponseHeaderMap
    }

export type TurnstileDecision =
  | {
      ok: true
      token?: string
      verifiedNow: boolean
    }
  | {
      ok: false
      status: 403 | 503
      error: string
      code: TurnstileFailureCode
    }

// Keep direct `ok === false` checks in the route guards that consume these
// decisions. Those sites already narrow cleanly, so a shared helper would only
// add indirection.
export type OriginPolicyDecision =
  | {
      ok: true
      headers?: ResponseHeaderMap
    }
  | {
      ok: false
      status: 403
      error: string
      headers?: ResponseHeaderMap
    }

// Keep this predicate local to origin policy. TypeScript missed the direct
// discriminant narrowing in `withOriginPolicy`, but the other `ok` unions in
// this file still typecheck cleanly without extra helpers.
const isOriginPolicyFailure = (
  decision: OriginPolicyDecision
): decision is Extract<OriginPolicyDecision, { ok: false }> => !decision.ok

export interface ParsedBody<T> {
  ok: boolean
  data?: T
  error?: string
  status?: number
}

export interface TenantSecurityContext {
  tenantId: string
  clientIp: string
}

export interface RateLimitOptions {
  key: string
  perTenant: number
  perIp: number
  windowSeconds: number
}

const hmacKeyCache = new Map<string, Promise<CryptoKey>>()

export const applyResponseHeaders = (
  c: Context<{ Bindings: Env }>,
  headers: ResponseHeaderMap | undefined
): void => {
  if (!headers) {
    return
  }

  for (const [key, value] of Object.entries(headers)) {
    c.header(key, value)
  }
}

const parsePositiveInt = (raw: string | undefined, fallback: number): number => {
  if (!raw) return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return value
}

// Keep runtime truthy parsing aligned with the deploy validator so whitespace
// around env flags does not produce split-brain Turnstile behavior.
const boolFlag = (raw: string | undefined): boolean =>
  typeof raw === 'string' && ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase())

export const isTurnstileRequired = (env: Env): boolean => boolFlag(env.REQUIRE_TURNSTILE)

const base64Url = (bytes: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')

export const secureCompare = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i)
  }
  return mismatch === 0
}

const parseCookieHeader = (cookieHeader: string | undefined): Record<string, string> => {
  if (!cookieHeader) return {}

  const cookies: Record<string, string> = {}
  const cookiePairs = cookieHeader.split(';')
  for (const pair of cookiePairs) {
    const [rawKey, ...rest] = pair.split('=')
    const key = rawKey?.trim()
    if (!key) continue
    const value = rest.join('=').trim()
    try {
      cookies[key] = decodeURIComponent(value)
    } catch {
      cookies[key] = value
    }
  }
  return cookies
}

const normalizeConfiguredOrigin = (origin: string): string | null => {
  const trimmed = origin.trim()
  if (trimmed.length === 0) {
    return null
  }

  try {
    return new URL(trimmed).origin
  } catch {
    return null
  }
}

const parseAllowedOrigins = (rawOrigins: string | undefined): Set<string> => {
  const cacheKey = rawOrigins ?? ''
  const cached = allowedOriginsCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const parsed = new Set<string>()
  for (const origin of cacheKey.split(',')) {
    const normalized = normalizeConfiguredOrigin(origin)
    if (normalized) {
      parsed.add(normalized)
    }
  }

  allowedOriginsCache.set(cacheKey, parsed)
  return parsed
}

// Vite dev serves the browser app and worker from different localhost ports.
// Allow same-host loopback origins here so local API requests do not 403.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

const isLoopbackOriginPair = (requestOrigin: string, originHeader: string): boolean => {
  try {
    const requestUrl = new URL(requestOrigin)
    const originUrl = new URL(originHeader)

    return (
      requestUrl.protocol === originUrl.protocol &&
      LOOPBACK_HOSTS.has(requestUrl.hostname) &&
      requestUrl.hostname === originUrl.hostname
    )
  } catch {
    return false
  }
}

const isOriginAllowed = (
  originHeader: string | undefined,
  requestOrigin: string,
  allowList: Set<string>
): boolean => {
  if (!originHeader) {
    return true
  }

  if (originHeader === requestOrigin) {
    return true
  }

  if (isLoopbackOriginPair(requestOrigin, originHeader)) {
    return true
  }

  return allowList.has(originHeader)
}

const buildSetCookieHeader = (
  name: string,
  value: string,
  requestUrl: string,
  maxAgeSeconds: number
): string => {
  const isSecure = new URL(requestUrl).protocol === 'https:'
  const pieces = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (isSecure) {
    pieces.push('Secure')
  }
  return pieces.join('; ')
}

// This is the single origin/CORS policy for the Worker: `/api/*` calls into
// this shared path from `worker/index.ts`.
export function evaluateOriginPolicy(env: Env, request: Request): OriginPolicyDecision {
  const requestOrigin = new URL(request.url).origin
  const originHeader = request.headers.get('Origin')?.trim() || undefined
  // Always emit `Vary: Origin` from this policy because the same URL can yield
  // different origin-policy headers or rejection outcomes depending on the
  // request's `Origin`. That is cache correctness, not a cross-origin allow by itself.
  // Same-origin requests do not need `ALLOWED_ORIGINS`, but any future split-host
  // deployment (for example `example.com` -> `api.example.com`) must add the
  // browser origin(s) to that env var or CORS will reject the cross-origin call.
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS)

  if (!isOriginAllowed(originHeader, requestOrigin, allowedOrigins)) {
    return {
      ok: false,
      status: 403,
      error: 'Origin not allowed',
      headers: {
        Vary: 'Origin',
      },
    }
  }

  if (!originHeader) {
    return {
      ok: true,
      headers: {
        Vary: 'Origin',
      },
    }
  }

  return {
    ok: true,
    headers: {
      Vary: 'Origin',
      'Access-Control-Allow-Origin': originHeader,
      'Access-Control-Allow-Methods': CORS_ALLOW_METHODS,
      'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
      'Access-Control-Allow-Credentials': 'true',
    },
  }
}

export const withOriginPolicy: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const decision = evaluateOriginPolicy(c.env, c.req.raw)
  applyResponseHeaders(c, decision.headers)

  if (!isOriginPolicyFailure(decision)) {
    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204)
    }

    await next()
    return
  }

  return c.json(
    {
      success: false,
      error: decision.error,
    },
    { status: decision.status }
  )
}

const getHmacKey = (secret: string): Promise<CryptoKey> => {
  const cached = hmacKeyCache.get(secret)
  if (cached) {
    return cached
  }

  const promise = crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  hmacKeyCache.set(secret, promise)
  return promise
}

const signValue = async (value: string, secret: string): Promise<string> => {
  const key = await getHmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return base64Url(signature)
}

export const getClientIp = (request: Request): string => {
  const cfIp = request.headers.get('cf-connecting-ip')
  if (cfIp && cfIp.trim()) {
    return cfIp.trim()
  }

  const forwarded = request.headers.get('x-forwarded-for')
  if (!forwarded) {
    return 'unknown'
  }

  const first = forwarded.split(',')[0]?.trim()
  return first || 'unknown'
}

const resolveSigningSecret = (env: Env): string | null => {
  const explicitSecret = env.SECURITY_HMAC_SECRET?.trim()
  return explicitSecret && explicitSecret.length > 0 ? explicitSecret : null
}

const resolveTenantId = async (
  cookieValue: string | undefined,
  signingSecret: string
): Promise<string | null> => {
  if (!cookieValue) {
    return null
  }

  const separatorIndex = cookieValue.indexOf('.')
  if (separatorIndex <= 0 || separatorIndex >= cookieValue.length - 1) {
    return null
  }

  const tenantId = cookieValue.slice(0, separatorIndex).trim()
  const signature = cookieValue.slice(separatorIndex + 1).trim()
  if (!TENANT_ID_PATTERN.test(tenantId) || signature.length === 0) {
    return null
  }

  const expected = await signValue(tenantId, signingSecret)
  return secureCompare(signature, expected) ? tenantId : null
}

export async function ensureTenantSecurityContext(
  c: Context<{ Bindings: Env }>
): Promise<TenantSecurityContext | Response> {
  const securityContext = c as unknown as SecurityContext
  const signingSecret = resolveSigningSecret(c.env)
  if (!signingSecret) {
    return c.json(
      {
        success: false,
        error: 'Security configuration missing: SECURITY_HMAC_SECRET',
      },
      { status: 503 }
    )
  }

  const cookieName = c.env.SESSION_COOKIE_NAME?.trim() || DEFAULT_COOKIE_NAME
  const maxAgeSeconds = parsePositiveInt(
    c.env.SESSION_COOKIE_MAX_AGE_SECONDS,
    DEFAULT_COOKIE_MAX_AGE_SECONDS
  )
  const cookies = parseCookieHeader(c.req.header('Cookie'))
  let tenantId = await resolveTenantId(cookies[cookieName], signingSecret)

  if (!tenantId) {
    tenantId = crypto.randomUUID()
    const signature = await signValue(tenantId, signingSecret)
    const cookieValue = `${tenantId}.${signature}`
    c.header(
      'Set-Cookie',
      buildSetCookieHeader(cookieName, cookieValue, c.req.url, maxAgeSeconds),
      { append: true }
    )
  }

  const clientIp = getClientIp(c.req.raw)
  securityContext.set(CTX_TENANT_ID, tenantId)
  securityContext.set(CTX_CLIENT_IP, clientIp)
  return { tenantId, clientIp }
}

export const getTenantContextFromRequest = (
  c: Context<{ Bindings: Env }>
): TenantSecurityContext | null => {
  const securityContext = c as unknown as SecurityContext
  const tenantId = securityContext.get(CTX_TENANT_ID)
  const clientIp = securityContext.get(CTX_CLIENT_IP)
  if (!tenantId || !clientIp) {
    return null
  }
  return { tenantId, clientIp }
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000)

// Bind the lease to the tenant and its expiry so a leaked cookie is neither
// reusable by another tenant nor valid past its TTL.
const signChatChallengeLease = (
  tenantId: string,
  expSeconds: number,
  secret: string
): Promise<string> => signValue(`${CHAT_CHALLENGE_LEASE_PURPOSE}:${tenantId}:${expSeconds}`, secret)

const setChatChallengeLeaseCookie = async (
  c: Context<{ Bindings: Env }>,
  tenantId: string,
  expSeconds: number,
  signingSecret: string
): Promise<void> => {
  const signature = await signChatChallengeLease(tenantId, expSeconds, signingSecret)
  c.header(
    'Set-Cookie',
    buildSetCookieHeader(
      CHAT_CHALLENGE_LEASE_COOKIE,
      `${expSeconds}.${signature}`,
      c.req.url,
      Math.max(0, expSeconds - nowSeconds())
    ),
    { append: true }
  )
}

// Sets the signed lease cookie for `tenantId` and returns its absolute expiry
// (epoch seconds), or null if the signing secret is unavailable. The client uses
// the real expiry to re-challenge before the lease actually lapses.
export const issueChatChallengeLease = async (
  c: Context<{ Bindings: Env }>,
  tenantId: string
): Promise<number | null> => {
  const signingSecret = resolveSigningSecret(c.env)
  if (!signingSecret) {
    return null
  }

  const exp = nowSeconds() + CHAT_CHALLENGE_LEASE_TTL_SECONDS
  await setChatChallengeLeaseCookie(c, tenantId, exp, signingSecret)
  return exp
}

// Returns the lease expiry (epoch seconds) iff a present `chat_turnstile` cookie
// validates: signature intact, not expired, and bound to this request's
// validated tenant. Null otherwise.
export const readChatChallengeLeaseExpiry = async (
  c: Context<{ Bindings: Env }>,
  tenantId: string
): Promise<number | null> => {
  const signingSecret = resolveSigningSecret(c.env)
  if (!signingSecret) {
    return null
  }

  const raw = parseCookieHeader(c.req.header('Cookie'))[CHAT_CHALLENGE_LEASE_COOKIE]
  if (!raw) {
    return null
  }

  const separatorIndex = raw.indexOf('.')
  if (separatorIndex <= 0 || separatorIndex >= raw.length - 1) {
    return null
  }

  const exp = Number.parseInt(raw.slice(0, separatorIndex), 10)
  const signature = raw.slice(separatorIndex + 1)
  if (!Number.isFinite(exp) || exp <= nowSeconds()) {
    return null
  }

  const expected = await signChatChallengeLease(tenantId, exp, signingSecret)
  return secureCompare(signature, expected) ? exp : null
}

export const hasValidChatChallengeLease = async (
  c: Context<{ Bindings: Env }>,
  tenantId: string
): Promise<boolean> => (await readChatChallengeLeaseExpiry(c, tenantId)) !== null

// Test-only: sign a lease value with an arbitrary expiry so tests can craft
// expired-but-well-signed cookies.
export const __testUtils = { signChatChallengeLease }

export const evaluateRateLimit = async (
  env: Env,
  tenantId: string,
  clientIp: string,
  options: RateLimitOptions
): Promise<RateLimitDecision> => {
  const tenantKey = `tenant:${tenantId}:${options.key}`
  const ipKey = `ip:${clientIp}:${options.key}`
  const [tenantLimit, ipLimit] = await Promise.all([
    consumeRateLimit(env, tenantKey, options.perTenant, options.windowSeconds),
    consumeRateLimit(env, ipKey, options.perIp, options.windowSeconds),
  ])

  const remaining = Math.min(tenantLimit.remaining, ipLimit.remaining)
  const resetAt = Math.max(tenantLimit.resetAt, ipLimit.resetAt)
  const headers: ResponseHeaderMap = {
    'X-RateLimit-Limit': String(Math.min(options.perTenant, options.perIp)),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': String(Math.floor(resetAt / 1000)),
  }

  if (tenantLimit.allowed && ipLimit.allowed) {
    return {
      ok: true,
      headers,
    }
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
  return {
    ok: false,
    status: 429,
    error: 'Rate limit exceeded',
    code: 'RATE_LIMITED',
    headers: {
      ...headers,
      'Retry-After': String(retryAfterSeconds),
    },
  }
}

export const verifyTurnstileToken = async (
  env: Env,
  clientIp: string,
  options: {
    token?: string
    verified?: boolean
  }
): Promise<TurnstileDecision> => {
  const requireTurnstile = isTurnstileRequired(env)
  if (options.verified) {
    return {
      ok: true,
      token: options.token,
      verifiedNow: false,
    }
  }

  const token = options.token?.trim()
  if (!requireTurnstile && !token) {
    return {
      ok: true,
      verifiedNow: false,
    }
  }

  const secret = env.TURNSTILE_SECRET_KEY?.trim()
  if (!secret) {
    if (!requireTurnstile) {
      return {
        ok: true,
        verifiedNow: false,
      }
    }

    return {
      ok: false,
      status: 503,
      error: 'Verification gate is enabled but not configured',
      code: 'VERIFICATION_UNAVAILABLE',
    }
  }

  if (!token) {
    return {
      ok: false,
      status: 403,
      error: 'Verification token is required',
      code: 'VERIFICATION_REQUIRED',
    }
  }

  const payload = new URLSearchParams({
    secret,
    response: token,
    remoteip: clientIp,
  })

  let verification: TurnstileVerificationResponse | null = null
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: payload.toString(),
    })
    verification = (await response.json()) as TurnstileVerificationResponse
  } catch (error) {
    console.error('Turnstile verification failed:', error)
  }

  if (verification?.success) {
    return {
      ok: true,
      token,
      verifiedNow: true,
    }
  }

  return {
    ok: false,
    status: 403,
    error: 'Verification failed',
    code: 'VERIFICATION_FAILED',
  }
}

export async function parseJsonBodyWithLimit<T>(
  request: Request,
  maxBytes: number
): Promise<ParsedBody<T>> {
  const contentLength = request.headers.get('content-length')
  if (contentLength) {
    const asNumber = Number.parseInt(contentLength, 10)
    if (Number.isFinite(asNumber) && asNumber > maxBytes) {
      return {
        ok: false,
        status: 413,
        error: 'Request body is too large',
      }
    }
  }

  const reader = request.body?.getReader()
  if (!reader) {
    return {
      ok: false,
      status: 400,
      error: 'Request body is required',
    }
  }

  let totalBytes = 0
  const decoder = new TextDecoder()
  let text = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > maxBytes) {
      await reader.cancel()
      return {
        ok: false,
        status: 413,
        error: 'Request body is too large',
      }
    }
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()

  if (!text.trim()) {
    return {
      ok: false,
      status: 400,
      error: 'Request body is required',
    }
  }

  try {
    return {
      ok: true,
      data: JSON.parse(text) as T,
    }
  } catch {
    return {
      ok: false,
      status: 400,
      error: 'Malformed JSON body',
    }
  }
}

export const getRateLimitWindowSeconds = (env: Env): number =>
  parsePositiveInt(env.RATE_LIMIT_WINDOW_SECONDS, DEFAULT_RATE_LIMIT_WINDOW_SECONDS)

export const getChatBodyLimitBytes = (env: Env): number =>
  parsePositiveInt(env.MAX_CHAT_REQUEST_BYTES, DEFAULT_CHAT_REQUEST_BYTES)

export const getFitAnalyzeBodyLimitBytes = (env: Env): number =>
  parsePositiveInt(env.MAX_FIT_ANALYZE_BYTES, DEFAULT_FIT_ANALYZE_BYTES)

export const getChatTenantRateLimit = (env: Env): number =>
  parsePositiveInt(env.CHAT_RATE_LIMIT_PER_TENANT, 40)

export const getChatIpRateLimit = (env: Env): number =>
  parsePositiveInt(env.CHAT_RATE_LIMIT_PER_IP, 80)

export const getAiTenantRateLimit = (env: Env): number =>
  parsePositiveInt(env.AI_RATE_LIMIT_PER_TENANT, 12)

export const getAiIpRateLimit = (env: Env): number => parsePositiveInt(env.AI_RATE_LIMIT_PER_IP, 24)

export const getClientErrorBodyLimitBytes = (env: Env): number =>
  parsePositiveInt(env.MAX_CLIENT_ERROR_BYTES, DEFAULT_CLIENT_ERROR_BYTES)

export const getClientErrorIpRateLimit = (env: Env): number =>
  parsePositiveInt(env.CLIENT_ERROR_RATE_LIMIT_PER_IP, 30)
