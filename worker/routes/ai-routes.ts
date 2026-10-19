import { generateText, NoObjectGeneratedError, Output } from 'ai'
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { ZodError } from 'zod'
import { SYSTEM_PROMPTS } from '../../shared/ai-prompts'
import {
  FIT_ANALYSIS_RESPONSE_SCHEMA_NAME,
  fitAssessmentResultSchema,
  type FitAssessmentErrorCode,
} from '../../shared/fit-analysis'
import type { Env } from '../core-utils'
import {
  createStructuredModel,
  createTextModel,
  logAiFailure,
  resolveModelRuntime,
  withModelFallback,
  type ModelRuntime,
} from '../model-utils'
import {
  applyResponseHeaders,
  evaluateRateLimit,
  getAiIpRateLimit,
  getAiTenantRateLimit,
  getFitAnalyzeBodyLimitBytes,
  getRateLimitWindowSeconds,
  getTenantContextFromRequest,
  hasValidChatChallengeLease,
  parseJsonBodyWithLimit,
  secureCompare,
  verifyTurnstileToken,
  type TenantSecurityContext,
} from '../security'

type AppContext = Context<{ Bindings: Env }>
type ErrorStatusCode = 400 | 403 | 404 | 413 | 429 | 500 | 503
type ParsedBodyErrorStatusCode = 400 | 413

const getParsedBodyErrorStatus = (status: number | undefined): ParsedBodyErrorStatusCode =>
  status === 413 ? 413 : 400

interface AiRouteGuardOptions {
  bodyLimit: number
  rateLimitKey: 'analyze-fit'
  missingSecurityCode?: FitAssessmentErrorCode
  invalidRequestCode?: FitAssessmentErrorCode
  requestTooLargeCode?: FitAssessmentErrorCode
}

interface AiRouteFailure {
  status: ErrorStatusCode
  error: string
  code?: FitAssessmentErrorCode
}

type AiRouteGuardResult<TBody> =
  | {
      ok: true
      body: TBody
    }
  | {
      ok: false
      failure: AiRouteFailure
    }

type AiRuntimeResult =
  | {
      ok: true
      runtime: ModelRuntime
    }
  | {
      ok: false
      failure: AiRouteFailure
    }

type TenantContextResult =
  | {
      ok: true
      context: TenantSecurityContext
    }
  | {
      ok: false
      failure: AiRouteFailure
    }

const createAiRouteFailure = (
  status: ErrorStatusCode,
  error: string,
  code?: FitAssessmentErrorCode
): AiRouteFailure => ({
  status,
  error,
  code,
})

const jsonAiRouteFailure = (c: AppContext, failure: AiRouteFailure, includeCode = false) =>
  c.json(
    includeCode && failure.code
      ? { success: false, code: failure.code, error: failure.error }
      : { success: false, error: failure.error },
    failure.status
  )

const requireTenantContext = (
  c: AppContext,
  missingSecurityCode?: FitAssessmentErrorCode
): TenantContextResult => {
  const context = getTenantContextFromRequest(c)
  if (!context) {
    return {
      ok: false,
      failure: createAiRouteFailure(500, 'Missing security context', missingSecurityCode),
    }
  }

  return {
    ok: true,
    context,
  }
}

const guardAiRouteRequest = async <TBody>(
  c: AppContext,
  options: AiRouteGuardOptions
): Promise<AiRouteGuardResult<TBody>> => {
  const tenantContextResult = requireTenantContext(c, options.missingSecurityCode)
  if (tenantContextResult.ok === false) {
    return {
      ok: false,
      failure: tenantContextResult.failure,
    }
  }
  const { context: tenantContext } = tenantContextResult

  const turnstile = await verifyTurnstileToken(c.env, tenantContext.clientIp, {
    // Browser rides the shared challenge lease (cookie); the per-request token
    // stays as a fallback for direct/non-browser callers.
    verified: await hasValidChatChallengeLease(c, tenantContext.tenantId),
    token: c.req.header('x-turnstile-token')?.trim(),
  })
  if (turnstile.ok === false) {
    return {
      ok: false,
      failure: createAiRouteFailure(turnstile.status, turnstile.error, turnstile.code),
    }
  }

  const rateLimit = await evaluateRateLimit(c.env, tenantContext.tenantId, tenantContext.clientIp, {
    key: options.rateLimitKey,
    perTenant: getAiTenantRateLimit(c.env),
    perIp: getAiIpRateLimit(c.env),
    windowSeconds: getRateLimitWindowSeconds(c.env),
  })
  applyResponseHeaders(c, rateLimit.headers)
  if (rateLimit.ok === false) {
    return {
      ok: false,
      failure: createAiRouteFailure(rateLimit.status, rateLimit.error, rateLimit.code),
    }
  }

  const parsed = await parseJsonBodyWithLimit<TBody>(c.req.raw, options.bodyLimit)
  if (!parsed.ok) {
    const status = getParsedBodyErrorStatus(parsed.status)
    return {
      ok: false,
      failure: createAiRouteFailure(
        status,
        parsed.error ?? 'Invalid request body',
        status === 413 ? options.requestTooLargeCode : options.invalidRequestCode
      ),
    }
  }

  return {
    ok: true,
    body: parsed.data as TBody,
  }
}

const getAiRuntime = (c: AppContext, unavailableCode?: FitAssessmentErrorCode): AiRuntimeResult => {
  const runtime = resolveModelRuntime(c.env)
  if (!runtime) {
    return {
      ok: false,
      failure: createAiRouteFailure(503, 'AI integration is not configured', unavailableCode),
    }
  }

  return {
    ok: true,
    runtime,
  }
}

const createRetryableError = (message: string): Error & { isRetryable: true } =>
  Object.assign(new Error(message), {
    isRetryable: true as const,
  })

// One-shot AI calls should never hang on a slow model. A slower model fails over
// (or fails fast on the last attempt); Workers fit is capped at 30s per model,
// 60s across its two-model chain.
const ONE_SHOT_MODEL_TIMEOUT_MS = 15_000
const WORKERS_AI_PRIMARY_TIMEOUT_MS = 30_000
const WORKERS_AI_FALLBACK_TIMEOUT_MS = 30_000

const isStructuredFitAssessmentError = (error: unknown): boolean =>
  NoObjectGeneratedError.isInstance(error) || error instanceof ZodError

export const getStructuredFitAssessment = async (
  runtime: ModelRuntime,
  jd: string,
  requestSignal?: AbortSignal
) => {
  // Keep helper-route fallback app-side and disable AI SDK internal retries so
  // one-shot requests still fail over across the shared model order predictably.
  return withModelFallback(
    runtime.candidates,
    async (model, abortSignal) => {
      requestSignal?.throwIfAborted()
      const result = await generateText({
        model: createStructuredModel(runtime, model, {
          supportsStructuredOutputs: true,
        }),
        system: SYSTEM_PROMPTS.FIT_ASSESSOR,
        prompt: `Analyze fit for this JD:\n${jd}`,
        abortSignal:
          requestSignal && abortSignal
            ? AbortSignal.any([requestSignal, abortSignal])
            : (requestSignal ?? abortSignal),
        maxRetries: 0,
        output: Output.object({
          schema: fitAssessmentResultSchema,
          name: FIT_ANALYSIS_RESPONSE_SCHEMA_NAME,
        }),
      })

      if (result.finishReason !== 'stop') {
        throw createRetryableError(
          `Fit analysis returned non-stop finish reason: ${result.finishReason}`
        )
      }

      return result.output
    },
    {
      isRetriableError: isStructuredFitAssessmentError,
      perAttemptTimeoutMs:
        runtime.provider === 'workers-ai'
          ? (model) =>
              model === runtime.candidates[0]
                ? WORKERS_AI_PRIMARY_TIMEOUT_MS
                : WORKERS_AI_FALLBACK_TIMEOUT_MS
          : ONE_SHOT_MODEL_TIMEOUT_MS,
    }
  )
}

// Liveness probe for the selected AI runtime. A real 1-token completion is the
// only fully representative check; a SUCCESS is cached so repeated monitor/smoke
// hits cost at most one probe per TTL.
const AI_HEALTH_CACHE_TTL_MS = 60_000
const AI_HEALTH_PROBE_TIMEOUT_MS = 8_000
const WORKERS_AI_HEALTH_PRIMARY_TIMEOUT_MS = 5_000
const WORKERS_AI_HEALTH_FALLBACK_TIMEOUT_MS = 12_000

type AiHealthSnapshot = {
  at: number
  body: Record<string, unknown>
}

// Best-effort per-isolate cache of the last SUCCESSFUL probe only. Failures are
// never cached: they cost no model tokens (auth rejection / timeout), and caching
// them would make the deploy smoke's retries reuse a stale 503 from the same
// isolate instead of re-probing, and would stretch a fixed key's recovery window.
let cachedAiHealth: AiHealthSnapshot | null = null

// Probe the same ordered model chain production traffic uses, not just the
// primary. Workers attempts are app-side so the health response can name the
// actual winner; Google Gateway uses gateway-side chat fallback, while direct
// AI Studio intentionally selects one model for the free local test profile.
const probeAiHealth = async (
  runtime: ModelRuntime
): Promise<{ latencyMs: number; model: string }> => {
  const startedAt = Date.now()
  const defaultModel = runtime.candidates[0]

  const probeModel = async (model: string | readonly string[], abortSignal: AbortSignal) => {
    const result = await generateText({
      model: createTextModel(runtime, model),
      prompt: 'ping',
      maxOutputTokens: 16,
      maxRetries: 0,
      abortSignal,
    })
    return { model: result.response.modelId || (typeof model === 'string' ? model : defaultModel) }
  }

  const result =
    runtime.provider === 'workers-ai'
      ? await withModelFallback(
          runtime.candidates,
          (model, abortSignal) => probeModel(model, abortSignal!),
          {
            perAttemptTimeoutMs: (model) =>
              model === runtime.candidates[0]
                ? WORKERS_AI_HEALTH_PRIMARY_TIMEOUT_MS
                : WORKERS_AI_HEALTH_FALLBACK_TIMEOUT_MS,
          }
        )
      : await probeModel(runtime.candidates, AbortSignal.timeout(AI_HEALTH_PROBE_TIMEOUT_MS))

  return {
    latencyMs: Date.now() - startedAt,
    model: result.model,
  }
}

const isAiHealthTokenAuthorized = (c: AppContext): boolean => {
  const expectedToken = c.env.AI_HEALTH_TOKEN?.trim()
  if (!expectedToken) {
    // Unset → open probe (cost-bounded by the cache). Set the secret to require a token.
    return true
  }

  const providedToken = (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  return providedToken.length > 0 && secureCompare(providedToken, expectedToken)
}

export const registerAiRoutes = (
  app: Hono<{ Bindings: Env }>,
  withTenantSecurity: MiddlewareHandler<{ Bindings: Env }>
): void => {
  // No tenant/Turnstile gate: an external uptime monitor carries neither. Its own
  // optional bearer token guards it, and it must never be CDN-cached.
  app.get('/api/health/ai', async (c) => {
    c.header('Cache-Control', 'no-store')

    if (!isAiHealthTokenAuthorized(c)) {
      return c.json({ success: false, error: 'Unauthorized' }, 401)
    }

    const now = Date.now()
    if (cachedAiHealth && now - cachedAiHealth.at < AI_HEALTH_CACHE_TTL_MS) {
      return c.json(cachedAiHealth.body, 200)
    }

    const runtime = resolveModelRuntime(c.env)
    if (!runtime) {
      // Config-shape problem (missing/malformed key or base URL), not a live-auth failure.
      return c.json(
        {
          success: false,
          code: 'AI_NOT_CONFIGURED',
          error: 'AI integration is not configured',
        },
        503
      )
    }

    try {
      const { latencyMs, model } = await probeAiHealth(runtime)
      const body = { success: true, data: { ok: true, model, latencyMs } }
      cachedAiHealth = { at: now, body }
      return c.json(body, 200)
    } catch (error) {
      const authFailure = logAiFailure('health probe', error, '[AI_HEALTH_PROBE_FAILED]')
      return c.json(
        {
          success: false,
          code: authFailure ? 'AI_GATEWAY_AUTH_FAILURE' : 'AI_PROBE_FAILED',
          error: authFailure ? 'AI gateway authentication failed' : 'AI health probe failed',
        },
        503
      )
    }
  })

  app.use('/api/analyze-fit', withTenantSecurity)

  app.post('/api/analyze-fit', async (c) => {
    try {
      const bodyLimit = getFitAnalyzeBodyLimitBytes(c.env)
      const prepared = await guardAiRouteRequest<{ jd?: unknown }>(c, {
        bodyLimit,
        rateLimitKey: 'analyze-fit',
        missingSecurityCode: 'ANALYSIS_UNAVAILABLE',
        invalidRequestCode: 'INVALID_REQUEST',
        requestTooLargeCode: 'REQUEST_TOO_LARGE',
      })
      if (prepared.ok === false) {
        return jsonAiRouteFailure(c, prepared.failure, true)
      }

      const jd = typeof prepared.body.jd === 'string' ? prepared.body.jd.trim() : ''
      if (!jd) {
        return jsonAiRouteFailure(
          c,
          createAiRouteFailure(400, 'jd is required', 'MISSING_JOB_DESCRIPTION'),
          true
        )
      }

      const runtimeResult = getAiRuntime(c, 'ANALYSIS_UNAVAILABLE')
      if (runtimeResult.ok === false) {
        return jsonAiRouteFailure(c, runtimeResult.failure, true)
      }

      const fitAssessment = await getStructuredFitAssessment(
        runtimeResult.runtime,
        jd,
        c.req.raw.signal
      )
      return c.json({
        success: true,
        data: fitAssessment,
      })
    } catch (error) {
      logAiFailure('analyze-fit', error, 'Fit analysis error:')
      return jsonAiRouteFailure(
        c,
        createAiRouteFailure(500, 'Failed to analyze fit', 'ANALYSIS_FAILED'),
        true
      )
    }
  })
}
