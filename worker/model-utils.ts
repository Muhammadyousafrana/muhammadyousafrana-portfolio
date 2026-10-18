import {
  AiGatewayUnauthorizedError,
  createAiGateway,
  type AiGatewayAPISettings,
} from 'ai-gateway-provider'
import { createGoogleGenerativeAI } from 'ai-gateway-provider/providers/google'
import { createUnified } from 'ai-gateway-provider/providers/unified'
import { createClientFallbackModel, createWorkersAI, type WorkersAI } from 'workers-ai-provider'
import { getModelIds, parseAiProvider, type ModelCandidates } from '../shared/models'

interface ModelFallbackOptions {
  isRetriableError?: (error: unknown) => boolean
  // Cap per-model wall-clock. A model that doesn't respond in time is treated as a
  // retryable failure (fail over to the next model); if it's the last model, the
  // caller gets a fast error instead of hanging on a slow provider. The attempt's
  // AbortSignal is aborted on timeout so callers that pass it to the model call
  // don't leave an orphaned request running. Intended for one-shot requests, not
  // streaming.
  perAttemptTimeoutMs?: number | ((model: string) => number)
}

// Retryable so `withModelFallback` fails over to the next model on timeout.
export class ModelAttemptTimeoutError extends Error {
  readonly isRetryable = true
  constructor(model: string, timeoutMs: number) {
    super(`Model "${model}" did not respond within ${timeoutMs}ms`)
    this.name = 'ModelAttemptTimeoutError'
  }
}

const withAttemptTimeout = <T>(
  model: string,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> => {
  // On timeout, abort the losing attempt so a signal-respecting model call is
  // actually cancelled instead of running on as an orphan. Reject BEFORE
  // aborting: abort fires listeners synchronously, and a callback that rejects
  // inside one would otherwise win the race with an unclassified abort error
  // instead of the retryable ModelAttemptTimeoutError. The race still settles
  // on the timer even if run() ignores the signal.
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    run(controller.signal),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new ModelAttemptTimeoutError(model, timeoutMs)
        reject(error)
        controller.abort(error)
      }, timeoutMs)
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

type UnifiedProviderOptions = NonNullable<Parameters<typeof createUnified>[0]>

export interface GoogleGatewayRuntime {
  provider: 'google-gateway'
  candidates: ModelCandidates
  gateway: ReturnType<typeof createAiGateway>
}

export interface WorkersAiRuntime {
  provider: 'workers-ai'
  candidates: ModelCandidates
  workersAI: WorkersAI
}

export type ModelRuntime = GoogleGatewayRuntime | WorkersAiRuntime

export type GatewayChatStructuredModelOptions = Pick<
  UnifiedProviderOptions,
  'supportsStructuredOutputs' | 'transformRequestBody'
>

const AI_GATEWAY_API_VERSION = 'v1'

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const toRetryableFlag = (error: unknown): boolean | null => {
  if (typeof error !== 'object' || error === null) {
    return null
  }

  const candidate = (error as { isRetryable?: unknown }).isRetryable
  return typeof candidate === 'boolean' ? candidate : null
}

const toStatusCode = (error: unknown): number | null => {
  if (typeof error !== 'object' || error === null) {
    return null
  }

  const candidate =
    (error as { status?: unknown; statusCode?: unknown }).status ??
    (error as { statusCode?: unknown }).statusCode
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null
}

// A Cloudflare AI Gateway *authentication* failure — the gateway's own
// Authenticated-Gateway token (CF_AI_GATEWAY_TOKEN) is missing, invalid, or expired —
// as distinct from a generic model or upstream-provider error. Match the
// provider's concrete error class first, with a narrow message fallback for
// wrapping/version drift; deliberately do NOT match bare "valid api key" text.
export const isAiGatewayAuthError = (error: unknown): boolean => {
  if (error instanceof AiGatewayUnauthorizedError) {
    return true
  }

  return getErrorMessage(error).toLowerCase().includes('authentication active')
}

// Log an AI-call failure under the distinct [AI_GATEWAY_AUTH_FAILURE] tag when
// it is a gateway-auth drift, else under the caller's generic tag. The raw
// error rides along so stack traces survive (some catch sites wrap whole route
// handlers, where a plain code bug needs more than its message).
export const logAiFailure = (
  scope: string,
  error: unknown,
  genericTag: string,
  extra?: Record<string, unknown>
): boolean => {
  const authFailure = isAiGatewayAuthError(error)
  console.error(authFailure ? `[AI_GATEWAY_AUTH_FAILURE] ${scope}` : genericTag, {
    detail: getErrorMessage(error),
    ...extra,
    error,
  })
  return authFailure
}

const isRetriableModelError = (error: unknown): boolean => {
  const isRetryable = toRetryableFlag(error)
  if (isRetryable !== null) {
    return isRetryable
  }

  const status = toStatusCode(error)
  if (status !== null) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
  }

  const message = getErrorMessage(error).toLowerCase()
  return (
    message.includes('fetch failed') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('temporarily') ||
    message.includes('try again') ||
    message.includes('overloaded') ||
    message.includes('connection reset') ||
    message.includes('network')
  )
}

export const resolveAiGatewayApiSettings = ({
  apiKey,
  baseURL,
}: {
  apiKey?: string
  baseURL?: string
}): AiGatewayAPISettings | undefined => {
  if (!baseURL) {
    return undefined
  }

  try {
    const url = new URL(baseURL)
    const pathSegments = url.pathname.split('/').filter(Boolean)
    const [apiVersion, accountId, gateway, transport] = pathSegments
    if (
      pathSegments.length !== 4 ||
      apiVersion !== AI_GATEWAY_API_VERSION ||
      !accountId ||
      !gateway ||
      transport !== 'compat'
    ) {
      return undefined
    }

    return {
      accountId,
      gateway,
      apiKey,
    }
  } catch {
    return undefined
  }
}

export const resolveGoogleGatewayRuntime = ({
  apiKey,
  baseURL,
}: {
  apiKey?: string
  baseURL?: string
}): GoogleGatewayRuntime | undefined => {
  // Treat CF_AI_BASE_URL as a Cloudflare gateway locator. We validate the compat
  // pathname shape, then rebuild the canonical Cloudflare endpoints from the
  // parsed account and gateway ids instead of trusting an arbitrary host.
  const settings = resolveAiGatewayApiSettings({ apiKey, baseURL })
  if (!settings || !apiKey) {
    return undefined
  }

  return {
    provider: 'google-gateway',
    candidates: getModelIds('google-gateway'),
    gateway: createAiGateway(settings),
  }
}

export const resolveModelRuntime = ({
  AI,
  AI_PROVIDER,
  CF_AI_GATEWAY_TOKEN,
  CF_AI_BASE_URL,
}: {
  AI?: Ai
  AI_PROVIDER?: string
  CF_AI_GATEWAY_TOKEN?: string
  CF_AI_BASE_URL?: string
}): ModelRuntime | undefined => {
  const provider = parseAiProvider(AI_PROVIDER)
  if (!provider) return undefined

  if (provider === 'google-gateway') {
    return resolveGoogleGatewayRuntime({
      apiKey: CF_AI_GATEWAY_TOKEN?.trim(),
      baseURL: CF_AI_BASE_URL?.trim(),
    })
  }

  const settings = resolveAiGatewayApiSettings({ baseURL: CF_AI_BASE_URL?.trim() })
  if (!AI || !settings) return undefined

  return {
    provider,
    candidates: getModelIds(provider),
    workersAI: createWorkersAI({ binding: AI, gateway: { id: settings.gateway } }),
  }
}

// Google chat/text rides the native provider through the gateway, not the
// unified/compat adapter: compat drops Gemini 3.x thought signatures on tool
// continuations (@ai-sdk/openai-compatible stores them under
// providerMetadata.Unified but reads them back only from
// providerOptions.google.thoughtSignature), so every multi-step tool call
// came back HTTP 400 "Function call is missing a thought_signature". The
// Google fit-analysis structured path deliberately stays on compat.
// Registry ids stay gateway-prefixed (`google-ai-studio/...`, the gateway
// provider slug); the native provider addresses bare ids under /models/<id>,
// so the prefix is stripped here and only here.
const google = createGoogleGenerativeAI()
const GOOGLE_GATEWAY_MODEL_PREFIX = 'google-ai-studio/'

const toNativeGoogleModel = (modelId: string) =>
  google(
    modelId.startsWith(GOOGLE_GATEWAY_MODEL_PREFIX)
      ? modelId.slice(GOOGLE_GATEWAY_MODEL_PREFIX.length)
      : modelId
  )

export const createTextModel = (runtime: ModelRuntime, model: string | readonly string[]) => {
  const models = typeof model === 'string' ? [model] : [...model]
  if (runtime.provider === 'workers-ai') {
    const workersModels = models.map((modelId) => ({
      slug: modelId,
      model: runtime.workersAI(modelId as Parameters<WorkersAI>[0]),
      transport: 'run' as const,
    }))
    // Fallback covers dispatch failure only. Once a stream exists, never splice
    // another model into its text or tool state.
    return workersModels.length === 1
      ? workersModels[0].model
      : createClientFallbackModel(workersModels)
  }

  if (models.length === 1) {
    return runtime.gateway.chat(toNativeGoogleModel(models[0]))
  }

  return runtime.gateway.chat(models.map(toNativeGoogleModel))
}

export const createStructuredModel = (
  runtime: ModelRuntime,
  model: string,
  options: GatewayChatStructuredModelOptions = {}
) => {
  if (runtime.provider === 'workers-ai') {
    return runtime.workersAI(model as Parameters<WorkersAI>[0])
  }

  // Google structured fit-analysis output deliberately stays on unified/compat
  // adapter for its json_schema response_format support — unlike text/chat,
  // which rides the native Google provider (see createTextModel) to
  // preserve Gemini thought signatures. This path intentionally does not
  // expose an inbound pre-parse response hook.
  return runtime.gateway.chat(createUnified(options)(model))
}

export async function withModelFallback<T>(
  candidates: ModelCandidates,
  runWithModel: (model: string, abortSignal?: AbortSignal) => Promise<T>,
  options?: ModelFallbackOptions
): Promise<T> {
  let lastError: unknown

  for (const [index, model] of candidates.entries()) {
    try {
      const timeoutMs =
        typeof options?.perAttemptTimeoutMs === 'function'
          ? options.perAttemptTimeoutMs(model)
          : options?.perAttemptTimeoutMs
      return await (timeoutMs
        ? withAttemptTimeout(model, timeoutMs, (signal) => runWithModel(model, signal))
        : runWithModel(model))
    } catch (error) {
      lastError = error
      const shouldRetry =
        isRetriableModelError(error) || options?.isRetriableError?.(error) === true
      if (!shouldRetry) {
        throw error instanceof Error ? error : new Error(getErrorMessage(error))
      }
      const hasFallback = index < candidates.length - 1
      console.warn(
        hasFallback
          ? `Model "${model}" failed, trying next fallback: ${getErrorMessage(error)}`
          : `Model "${model}" failed with no fallback remaining: ${getErrorMessage(error)}`
      )
    }
  }

  throw lastError instanceof Error ? lastError : new Error('All configured model attempts failed')
}
