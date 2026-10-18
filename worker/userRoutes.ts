import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { CHAT_BOOTSTRAP_ROUTE_PREFIX } from '../shared/chat'
import { type Env } from './core-utils'
import { registerAiRoutes } from './routes/ai-routes'
import { registerChatRoutes } from './routes/chat-routes'
import {
  ensureTenantSecurityContext,
  evaluateRateLimit,
  getClientErrorBodyLimitBytes,
  getClientErrorIpRateLimit,
  getClientIp,
  getRateLimitWindowSeconds,
  getTenantContextFromRequest,
  isTurnstileRequired,
  issueChatChallengeLease,
  parseJsonBodyWithLimit,
  readChatChallengeLeaseExpiry,
  verifyTurnstileToken,
  type TenantSecurityContext,
} from './security'
import { isRecord } from './value-utils'

type AppContext = Context<{ Bindings: Env }>
type ErrorStatusCode = 400 | 403 | 404 | 413 | 429 | 500 | 503

const jsonError = (c: AppContext, error: string | undefined, status: ErrorStatusCode) =>
  c.json({ success: false, error }, status)

const applyDecisionHeaders = (c: AppContext, headers: Record<string, string> | undefined): void => {
  if (!headers) {
    return
  }

  for (const [key, value] of Object.entries(headers)) {
    c.header(key, value)
  }
}

const CLIENT_ERROR_FIELD_MAX = 2000
const CLIENT_ERROR_STACK_MAX = 8000

const truncateField = (value: unknown, maxLength: number): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.slice(0, maxLength) : undefined

// Keep only known fields, each length-bounded, so a large or arbitrarily-shaped
// payload cannot flood observability even within the byte cap.
const sanitizeClientErrorReport = (raw: unknown): Record<string, unknown> | null => {
  if (!isRecord(raw)) {
    return null
  }

  const message = truncateField(raw.message, CLIENT_ERROR_FIELD_MAX)
  if (!message) {
    return null
  }

  const url = truncateField(raw.url, CLIENT_ERROR_FIELD_MAX)
  const userAgent = truncateField(raw.userAgent, CLIENT_ERROR_FIELD_MAX)
  const timestamp = truncateField(raw.timestamp, 64)
  const source = truncateField(raw.source, CLIENT_ERROR_FIELD_MAX)
  const stack = truncateField(raw.stack, CLIENT_ERROR_STACK_MAX)
  const componentStack = truncateField(raw.componentStack, CLIENT_ERROR_STACK_MAX)

  return {
    message,
    ...(url ? { url } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(timestamp ? { timestamp } : {}),
    ...(source ? { source } : {}),
    ...(stack ? { stack } : {}),
    ...(componentStack ? { componentStack } : {}),
    ...(typeof raw.lineno === 'number' ? { lineno: raw.lineno } : {}),
    ...(typeof raw.colno === 'number' ? { colno: raw.colno } : {}),
    ...(typeof raw.errorBoundary === 'boolean' ? { errorBoundary: raw.errorBoundary } : {}),
  }
}

// Registered in `userRoutes()`, which runs before the legacy handler in
// `index.ts`, so this metered/bounded handler shadows the unprotected one.
// Rate-limits by client IP only (both admission buckets keyed on IP) so error
// reporting keeps working without a tenant cookie or HMAC config. Rate limit is
// checked before the body is read or logged.
const handleClientErrorReport = async (c: AppContext): Promise<Response> => {
  const clientIp = getClientIp(c.req.raw)
  const perIp = getClientErrorIpRateLimit(c.env)
  const rateLimit = await evaluateRateLimit(c.env, clientIp, clientIp, {
    key: 'client-errors',
    perTenant: perIp,
    perIp,
    windowSeconds: getRateLimitWindowSeconds(c.env),
  })
  applyDecisionHeaders(c, rateLimit.headers)
  if (rateLimit.ok === false) {
    return jsonError(c, rateLimit.error, rateLimit.status)
  }

  const parsed = await parseJsonBodyWithLimit<unknown>(
    c.req.raw,
    getClientErrorBodyLimitBytes(c.env)
  )
  if (!parsed.ok) {
    return jsonError(c, parsed.error, parsed.status === 413 ? 413 : 400)
  }

  const report = sanitizeClientErrorReport(parsed.data)
  if (!report) {
    return jsonError(c, 'Invalid error report', 400)
  }

  console.error('[CLIENT ERROR]', report)
  return c.json({ success: true })
}

const withTenantSecurity: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const context = await ensureTenantSecurityContext(c)
  if (context instanceof Response) {
    return context
  }

  await next()
}

const requireTenantContext = (c: AppContext): TenantSecurityContext | Response => {
  const context = getTenantContextFromRequest(c)
  if (!context) {
    return jsonError(c, 'Missing security context', 500)
  }

  return context
}

export function userRoutes(app: Hono<{ Bindings: Env }>) {
  app.get(`/${CHAT_BOOTSTRAP_ROUTE_PREFIX}/bootstrap`, withTenantSecurity, async (c) => {
    c.header('Cache-Control', 'no-store')
    const context = getTenantContextFromRequest(c)
    const requireTurnstile = isTurnstileRequired(c.env)
    // A returning visitor with an unexpired lease skips the checkbox entirely.
    // Surface the real expiry so the client re-challenges before it lapses.
    const leaseExpiry =
      requireTurnstile && context ? await readChatChallengeLeaseExpiry(c, context.tenantId) : null
    return c.json({
      success: true,
      data: {
        requireTurnstile,
        hasValidChallenge: !requireTurnstile || leaseExpiry !== null,
        challengeExpiresAt: leaseExpiry === null ? null : leaseExpiry * 1000,
      },
    })
  })

  // Browser exchanges a solved Turnstile token for a short-lived signed lease
  // bound to the tenant. The chat and fit-analysis routes then admit on the
  // lease cookie, so requests within the TTL need no new challenge.
  app.post(`/${CHAT_BOOTSTRAP_ROUTE_PREFIX}/verify-turnstile`, withTenantSecurity, async (c) => {
    const context = requireTenantContext(c)
    if (context instanceof Response) {
      return context
    }

    const decision = await verifyTurnstileToken(c.env, context.clientIp, {
      token: c.req.header('x-turnstile-token')?.trim(),
    })
    if (decision.ok === false) {
      return c.json({ success: false, error: decision.error, code: decision.code }, decision.status)
    }

    const exp = await issueChatChallengeLease(c, context.tenantId)
    c.header('Cache-Control', 'no-store')
    return c.json({
      success: true,
      data: { verified: true, challengeExpiresAt: exp === null ? null : exp * 1000 },
    })
  })

  app.post('/api/client-errors', handleClientErrorReport)

  registerAiRoutes(app, withTenantSecurity)
  registerChatRoutes(app, withTenantSecurity)
}
