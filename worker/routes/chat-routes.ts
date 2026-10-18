import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  MessageConversionError,
  stepCountIs,
  streamText,
  type ModelMessage,
  type UIMessage,
  type UIMessageChunk,
} from 'ai'
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { SYSTEM_PROMPTS } from '../../shared/ai-prompts'
import { CONTACT_HANDOFF_PENDING_TTL_MS } from '../app-controller'
import { normalizeChatHistoryForModel } from '../chat-history-normalize'
import { safeValidateChatMessages } from '../chat-message-validation'
import { buildLocalChatTools } from '../chat-tools'
import {
  planContactSmsDispatch,
  sendContactSms,
  validateContactHandoffSubmission,
  type ContactHandoffEnv,
} from '../contact-handoff'
import { claimContactHandoffDispatch, settleContactHandoffDispatch, type Env } from '../core-utils'
import { createTextModel, logAiFailure, resolveModelRuntime } from '../model-utils'
import {
  applyResponseHeaders,
  evaluateRateLimit,
  getChatBodyLimitBytes,
  getChatIpRateLimit,
  getChatTenantRateLimit,
  getRateLimitWindowSeconds,
  getTenantContextFromRequest,
  hasValidChatChallengeLease,
  parseJsonBodyWithLimit,
  verifyTurnstileToken,
  type TenantSecurityContext,
} from '../security'
import type { RequestLocationContext } from '../tools'
import { isRecord, toText } from '../value-utils'

type AppContext = Context<{ Bindings: Env }>
type ErrorStatusCode = 400 | 403 | 409 | 413 | 429 | 500 | 503

interface ChatRouteFailure {
  status: ErrorStatusCode
  error: string
  code?: string
}

type ChatRouteGuardResult<TBody> =
  | {
      ok: true
      body: TBody
      tenant: TenantSecurityContext
    }
  | {
      ok: false
      failure: ChatRouteFailure
    }

interface ChatRouteGuardOptions {
  rateLimitKey: string
  perTenant: number
  perIp: number
}

// Contact handoffs trigger a real SMS, so their budget is deliberately tight
// and hardcoded: one legitimate visitor submits the form a handful of times at
// most, and there is no reason to let an env var quietly widen this.
const CONTACT_HANDOFF_RATE_LIMIT_PER_TENANT = 5
const CONTACT_HANDOFF_RATE_LIMIT_PER_IP = 10
const CONTACT_HANDOFF_TOOL_CALL_ID_MAX_LENGTH = 128

// Client-held history is untrusted; keep the model context bounded the same
// way the DO's persistence cap did. Whole-message slicing is safe because a
// tool call and its result live in the same assistant UIMessage.
const CHAT_HISTORY_MESSAGE_LIMIT = 100
const CHAT_MAX_TOOL_STEPS = 6
// Wall-clock cap for one chat turn. Worst case is ~6 model steps plus tool
// executions (get_weather self-bounds at ~30s across up to three 10s fetches:
// two geocode relaxations plus the forecast); 90s comfortably covers that while
// still guaranteeing a stalled gateway stream cannot hang the request forever.
const CHAT_STREAM_TIMEOUT_MS = 90_000
const CHAT_MESSAGE_ID_GENERATOR = createIdGenerator({ prefix: 'msg', size: 16 })
const TOOL_GUIDE = ['Tool guide:', '- Use `get_weather` for any live weather request.'].join('\n')
// Voice-tone (register) leads, persona (content, which wins on conflict)
// follows — see the framing sentences at the end of CHAT_VOICE_TONE.
const CHAT_SYSTEM_PROMPT = [
  SYSTEM_PROMPTS.CHAT_VOICE_TONE,
  SYSTEM_PROMPTS.CHAT_PERSONA,
  TOOL_GUIDE,
].join('\n\n')
const INVALID_TOOL_STATE_ERROR =
  'This chat session contains invalid tool state. Start a fresh chat and try again.'

// Headers prepared via c.header() (tenant Set-Cookie, rate-limit headers) are
// only merged automatically into Hono's own response builders; a raw streamed
// Response would drop them, so copy the pending headers over explicitly.
const STREAM_FORWARDED_HEADERS = [
  'Vary',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
  'Retry-After',
] as const

const appendPendingResponseHeaders = (c: AppContext, response: Response): void => {
  for (const cookie of c.res.headers.getSetCookie()) {
    response.headers.append('Set-Cookie', cookie)
  }

  for (const headerName of STREAM_FORWARDED_HEADERS) {
    const value = c.res.headers.get(headerName)
    if (!value) {
      continue
    }

    if (headerName === 'Vary') {
      response.headers.append(headerName, value)
      continue
    }

    response.headers.set(headerName, value)
  }
}

const jsonChatRouteFailure = (c: AppContext, failure: ChatRouteFailure) =>
  c.json(
    failure.code
      ? { success: false, code: failure.code, error: failure.error }
      : { success: false, error: failure.error },
    failure.status
  )

// Same admission order as /api/analyze-fit (see guardAiRouteRequest in
// ai-routes.ts): tenant context → Turnstile (shared challenge lease, with the
// per-request token as a fallback for direct callers) → rate limit → bounded
// JSON body parse.
const guardChatRoute = async <TBody>(
  c: AppContext,
  options: ChatRouteGuardOptions
): Promise<ChatRouteGuardResult<TBody>> => {
  const tenant = getTenantContextFromRequest(c)
  if (!tenant) {
    return { ok: false, failure: { status: 500, error: 'Missing security context' } }
  }

  const turnstile = await verifyTurnstileToken(c.env, tenant.clientIp, {
    verified: await hasValidChatChallengeLease(c, tenant.tenantId),
    token: c.req.header('x-turnstile-token')?.trim(),
  })
  if (turnstile.ok === false) {
    return {
      ok: false,
      failure: { status: turnstile.status, error: turnstile.error, code: turnstile.code },
    }
  }

  const rateLimit = await evaluateRateLimit(c.env, tenant.tenantId, tenant.clientIp, {
    key: options.rateLimitKey,
    perTenant: options.perTenant,
    perIp: options.perIp,
    windowSeconds: getRateLimitWindowSeconds(c.env),
  })
  applyResponseHeaders(c, rateLimit.headers)
  if (rateLimit.ok === false) {
    return {
      ok: false,
      failure: { status: rateLimit.status, error: rateLimit.error, code: rateLimit.code },
    }
  }

  const parsed = await parseJsonBodyWithLimit<TBody>(c.req.raw, getChatBodyLimitBytes(c.env))
  if (!parsed.ok) {
    return {
      ok: false,
      failure: {
        status: parsed.status === 413 ? 413 : 400,
        error: parsed.error ?? 'Invalid request body',
      },
    }
  }

  return { ok: true, body: parsed.data as TBody, tenant }
}

const registerContactHandoffRoute = (
  app: Hono<{ Bindings: Env }>,
  withTenantSecurity: MiddlewareHandler<{ Bindings: Env }>
): void => {
  app.use('/api/contact-handoff', withTenantSecurity)

  app.post('/api/contact-handoff', async (c) => {
    c.header('Cache-Control', 'no-store')

    try {
      const prepared = await guardChatRoute<Record<string, unknown>>(c, {
        rateLimitKey: 'contact-handoff',
        perTenant: CONTACT_HANDOFF_RATE_LIMIT_PER_TENANT,
        perIp: CONTACT_HANDOFF_RATE_LIMIT_PER_IP,
      })
      if (prepared.ok === false) {
        return jsonChatRouteFailure(c, prepared.failure)
      }

      const body = isRecord(prepared.body) ? prepared.body : {}
      const toolCallId = toText(body.toolCallId)
      if (!toolCallId || toolCallId.length > CONTACT_HANDOFF_TOOL_CALL_ID_MAX_LENGTH) {
        return jsonChatRouteFailure(c, { status: 400, error: 'A valid toolCallId is required' })
      }

      const answeredAt = new Date().toISOString()
      const validation = validateContactHandoffSubmission(body)

      // A blocked validation IS a resolution (mirrors the DO flow, where the
      // model narrated it), not an HTTP error. Contract note for the client:
      // blocked data is transport-only — the form stays open and the payload is
      // never fed back as the show_contact_form tool output, because a blocked
      // payload (e.g. an unnormalizable phone) cannot satisfy
      // contactHandoffResolvedOutputSchema.
      if (validation.ok === false) {
        return c.json({
          success: true,
          data: { ...validation.fields, answeredAt, ...validation.resolution },
        })
      }

      // Simulation mode (Twilio env missing) and unusable delivery config
      // resolve without touching the idempotency store: no SMS was sent, so the
      // key must stay available for a real attempt later.
      const plan = planContactSmsDispatch(c.env as Env & ContactHandoffEnv, validation.submission)
      if (plan.kind === 'resolved') {
        return c.json({
          success: true,
          data: { ...validation.fields, answeredAt, ...plan.resolution },
        })
      }

      // Idempotency guard (closes the duplicate-SMS production defect): the
      // claim is atomic inside the AppController DO, a duplicate POST for a
      // finished send gets the stored resolution back without a second Twilio
      // call, and a failed send releases the claim so retries stay possible.
      const dispatchKey = `handoff:${prepared.tenant.tenantId}:${toolCallId}`
      const claim = await claimContactHandoffDispatch(c.env, dispatchKey)
      if (claim.kind === 'completed') {
        return c.json({ success: true, data: claim.result })
      }
      if (claim.kind === 'pending') {
        c.header('Retry-After', String(Math.ceil(CONTACT_HANDOFF_PENDING_TTL_MS / 1000)))
        return jsonChatRouteFailure(c, {
          status: 409,
          code: 'HANDOFF_IN_FLIGHT',
          error: 'This contact request is already being sent.',
        })
      }

      const resolution = await sendContactSms(plan, validation.submission)
      const data = { ...validation.fields, answeredAt, ...resolution }

      try {
        await settleContactHandoffDispatch(
          c.env,
          dispatchKey,
          claim.claimId,
          resolution.status === 'sent' ? data : null
        )
      } catch (error) {
        // The SMS outcome is already decided; failing the response here would
        // make the client retry a send that may have succeeded. Log and return
        // the real resolution — the pending claim expires on its own.
        console.error('[contact-handoff] Failed to settle dispatch record', { error })
      }

      return c.json({ success: true, data })
    } catch (error) {
      console.error('[contact-handoff] Route error', { error })
      return jsonChatRouteFailure(c, {
        status: 500,
        error: 'Failed to process the contact request',
      })
    }
  })
}

type ChatHistoryHygieneResult = { ok: true; messages: UIMessage[] } | { ok: false; error: string }

// First line of defense against a hostile or corrupted client history, run
// before schema validation: only user/assistant turns survive (a client-
// injected `system` message must never reach the model as system context),
// file parts are rejected outright (this chat has no attachments, and a URL
// file part would otherwise trigger a server-side download), the window is
// capped to whole messages, and leading assistant turns are dropped because
// the Google API requires the first content to be a user turn.
const sanitizeIncomingChatHistory = (raw: unknown): ChatHistoryHygieneResult => {
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'messages must be an array' }
  }

  const conversational = raw.filter(
    (message): message is Record<string, unknown> =>
      isRecord(message) && (message.role === 'user' || message.role === 'assistant')
  )

  for (const message of conversational) {
    const parts = Array.isArray(message.parts) ? message.parts : []
    if (parts.some((part) => isRecord(part) && part.type === 'file')) {
      return { ok: false, error: 'File attachments are not supported' }
    }
  }

  const windowed = conversational.slice(-CHAT_HISTORY_MESSAGE_LIMIT)
  const firstUserIndex = windowed.findIndex((message) => message.role === 'user')
  if (firstUserIndex === -1) {
    return { ok: false, error: 'At least one user message is required' }
  }

  return { ok: true, messages: windowed.slice(firstUserIndex) as unknown as UIMessage[] }
}

// The normalizer only merges consecutive USER turns (its DO-era job); a client
// crafting consecutive assistant turns would still reach Gemini as
// non-alternating roles, so reject those before spending a model call.
const hasConsecutiveAssistantTurns = (messages: UIMessage[]): boolean =>
  messages.some(
    (message, index) => message.role === 'assistant' && messages[index - 1]?.role === 'assistant'
  )

// A converted history may still contain a tool call with no matching result
// (e.g. a dangling client-tool part the user typed past, or one dangling call
// among resolved parallel calls — cases the tail-role check cannot see).
// streamText would only surface that as a MissingToolResultsError inside the
// 200 stream, so detect it here and 400 instead. The scan is sequential, not a
// global id match: every call must be resolved before the next user turn (and
// by EOF), so duplicate-id tricks and out-of-order results are rejected too.
const hasDanglingToolCall = (messages: ModelMessage[]): boolean => {
  const pendingCallIds = new Set<string>()

  for (const message of messages) {
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === 'tool-call' && part.providerExecuted !== true) {
          if (pendingCallIds.has(part.toolCallId)) {
            return true
          }
          pendingCallIds.add(part.toolCallId)
        }
      }
      continue
    }

    if (message.role === 'tool' && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === 'tool-result' && !pendingCallIds.delete(part.toolCallId)) {
          // A result with no preceding unresolved call cannot come out of
          // convertToModelMessages — treat it as a crafted history.
          return true
        }
      }
      continue
    }

    if (message.role === 'user' && pendingCallIds.size > 0) {
      return true
    }
  }

  return pendingCallIds.size > 0
}

const toFiniteCoordinate = (value: unknown): number | undefined => {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

// Same fields the DO parsed from its forwarded x-cf-* headers, read directly
// from the request's cf properties now that no DO hop exists.
const parseRequestLocation = (request: Request): RequestLocationContext | undefined => {
  const cf = (request as { cf?: IncomingRequestCfProperties }).cf
  if (!cf) {
    return undefined
  }

  const latitude = toFiniteCoordinate(cf.latitude)
  const longitude = toFiniteCoordinate(cf.longitude)
  const city = toText(cf.city)
  const region = toText(cf.region)
  const country = toText(cf.country)
  const timezone = toText(cf.timezone)

  if (latitude === undefined && longitude === undefined && !city && !region && !country) {
    return undefined
  }

  return {
    ...(latitude !== undefined ? { latitude } : {}),
    ...(longitude !== undefined ? { longitude } : {}),
    ...(city ? { city } : {}),
    ...(region ? { region } : {}),
    ...(country ? { country } : {}),
    ...(timezone ? { timezone } : {}),
  }
}

const registerChatRoute = (
  app: Hono<{ Bindings: Env }>,
  withTenantSecurity: MiddlewareHandler<{ Bindings: Env }>
): void => {
  app.use('/api/chat', withTenantSecurity)

  app.post('/api/chat', async (c) => {
    try {
      const prepared = await guardChatRoute<{ messages?: unknown }>(c, {
        rateLimitKey: 'chat',
        perTenant: getChatTenantRateLimit(c.env),
        perIp: getChatIpRateLimit(c.env),
      })
      if (prepared.ok === false) {
        return jsonChatRouteFailure(c, prepared.failure)
      }
      if (!isRecord(prepared.body) || Array.isArray(prepared.body)) {
        return jsonChatRouteFailure(c, { status: 400, error: 'Invalid request body' })
      }

      const runtime = resolveModelRuntime(c.env)
      if (!runtime) {
        return jsonChatRouteFailure(c, { status: 503, error: 'AI integration is not configured' })
      }

      // Only `messages` is consumed from the useChat DefaultChatTransport body;
      // id/trigger/messageId are session bookkeeping this stateless route does
      // not need.
      const hygiene = sanitizeIncomingChatHistory(prepared.body.messages)
      if (hygiene.ok === false) {
        return jsonChatRouteFailure(c, { status: 400, error: hygiene.error })
      }

      const requestLocation = parseRequestLocation(c.req.raw)
      const tools = buildLocalChatTools({
        toolExecutionContext: {
          ...(requestLocation ? { requestLocation } : {}),
        },
      })

      const validation = await safeValidateChatMessages({ messages: hygiene.messages, tools })
      if (validation.success === false) {
        console.error('[chat-route] UI message validation failed before model conversion', {
          error: validation.error.message,
        })
        return jsonChatRouteFailure(c, { status: 400, error: INVALID_TOOL_STATE_ERROR })
      }

      const validatedMessages = normalizeChatHistoryForModel(validation.data)
      if (hasConsecutiveAssistantTurns(validatedMessages)) {
        return jsonChatRouteFailure(c, { status: 400, error: INVALID_TOOL_STATE_ERROR })
      }

      let modelMessages: ModelMessage[]
      try {
        modelMessages = await convertToModelMessages(validatedMessages, { tools })
      } catch (error) {
        if (!MessageConversionError.isInstance(error)) {
          throw error
        }

        console.error('[chat-route] UI message validation failed before model conversion', {
          error: error.message,
        })
        return jsonChatRouteFailure(c, { status: 400, error: INVALID_TOOL_STATE_ERROR })
      }

      // A history whose converted tail is an assistant turn (e.g. a dangling
      // tool call still awaiting its client-side input) would be rejected by
      // Gemini anyway; fail fast without spending a model call.
      const lastModelMessage = modelMessages[modelMessages.length - 1]
      if (
        !lastModelMessage ||
        (lastModelMessage.role !== 'user' && lastModelMessage.role !== 'tool')
      ) {
        return jsonChatRouteFailure(c, { status: 400, error: INVALID_TOOL_STATE_ERROR })
      }

      if (hasDanglingToolCall(modelMessages)) {
        return jsonChatRouteFailure(c, { status: 400, error: INVALID_TOOL_STATE_ERROR })
      }

      // NOTE: unlike the DO agent, this route deliberately does NOT execute
      // contact submissions found in the incoming history. The SMS runs only
      // through POST /api/contact-handoff; a hostile client hand-crafting a
      // fake resolved show_contact_form output only pollutes its own
      // narration — no privileged action occurs here.
      const result = streamText({
        // Fallback stays inside AI Gateway via the shared ordered model chain.
        // Per-session model preference died with the DO: always default chain.
        model: createTextModel(runtime, runtime.candidates),
        system: CHAT_SYSTEM_PROMPT,
        messages: modelMessages,
        stopWhen: [stepCountIs(CHAT_MAX_TOOL_STEPS)],
        tools,
        // Both halves are load-bearing: the request signal cancels the model
        // stream when the client disconnects, and the wall-clock timeout stops
        // a stalled stream from hanging the request.
        abortSignal: AbortSignal.any([
          c.req.raw.signal,
          AbortSignal.timeout(CHAT_STREAM_TIMEOUT_MS),
        ]),
      })

      const stream = result
        .toUIMessageStream({
          originalMessages: validatedMessages,
          generateMessageId: CHAT_MESSAGE_ID_GENERATOR,
          // Suppress deltas here; the transform below also removes SDK framing.
          sendReasoning: false,
          // Streamed generation errors: keep the greppable gateway-auth log
          // distinct from generic model failures, and return a friendly
          // client-visible errorText (ported from the DO's onError).
          onError: (error) => {
            const authFailure = logAiFailure('chat stream', error, '[chat-route] chat stream error')
            if (authFailure) {
              return 'The AI service is temporarily unavailable. Please try again shortly.'
            }

            return 'Something went wrong generating a reply. Please try again.'
          },
        })
        .pipeThrough(
          new TransformStream<UIMessageChunk, UIMessageChunk>({
            transform(chunk, controller) {
              if (!chunk.type.startsWith('reasoning-')) controller.enqueue(chunk)
            },
          })
        )

      const response = createUIMessageStreamResponse({ stream })
      response.headers.set('Cache-Control', 'no-store')
      appendPendingResponseHeaders(c, response)
      return response
    } catch (error) {
      logAiFailure('chat request', error, '[chat-route] Route error')
      return jsonChatRouteFailure(c, { status: 500, error: 'Failed to process the chat request' })
    }
  })
}

export const registerChatRoutes = (
  app: Hono<{ Bindings: Env }>,
  withTenantSecurity: MiddlewareHandler<{ Bindings: Env }>
): void => {
  registerChatRoute(app, withTenantSecurity)
  registerContactHandoffRoute(app, withTenantSecurity)
}
