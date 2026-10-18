/* eslint-disable import/no-unresolved */
import { describe, expect, it } from 'bun:test'
import { Hono, type MiddlewareHandler } from 'hono'
import {
  FIT_ANALYSIS_RESPONSE_SCHEMA_NAME,
  type FitAssessmentResult,
} from '../../shared/fit-analysis'
import { getModelIds } from '../../shared/models'
import type { Env } from '../core-utils'
import { resolveGoogleGatewayRuntime, resolveModelRuntime } from '../model-utils'
import { CTX_CLIENT_IP, CTX_TENANT_ID } from '../security'
import { getStructuredFitAssessment, registerAiRoutes } from './ai-routes'

const FIT_ANALYSIS_MODELS = getModelIds('google-gateway')
const WORKERS_AI_MODELS = getModelIds('workers-ai')
;(globalThis as typeof globalThis & { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false

const validFitAssessment: FitAssessmentResult = {
  verdict: 'Partial Fit',
  fitScore: 48,
  confidence: 'Medium',
  summary: 'Strong backend and platform overlap, with some data-streaming workflow gaps.',
  matches: ['Production TypeScript/Node and AWS ECS platform work are documented.'],
  keyGaps: ['No documented large-scale Kafka streaming experience yet.'],
  disqualifiers: [],
  transferableStrengths: ['Hands-on API design and observability experience transfers well.'],
  recommendation: 'Proceed only for backend-leaning platform roles with clear system ownership.',
}

const GATEWAY_API_KEY = 'test-key'
const GATEWAY_BASE_URL = 'https://gateway.example.com/v1/account/gateway/compat'
const GATEWAY_UNIVERSAL_URL = 'https://gateway.ai.cloudflare.com/v1/account/gateway'
const GATEWAY_PROVIDER = {
  apiKey: GATEWAY_API_KEY,
  baseURL: GATEWAY_BASE_URL,
}
const AI_GATEWAY_PROVIDER = resolveGoogleGatewayRuntime(GATEWAY_PROVIDER)
if (!AI_GATEWAY_PROVIDER) {
  throw new Error('Test gateway settings did not parse')
}

type TestAppEnv = {
  Bindings: Env
  Variables: {
    [CTX_CLIENT_IP]: string
    [CTX_TENANT_ID]: string
  }
}

const buildAppControllerNamespace = (options: { allowRequests?: boolean } = {}) =>
  ({
    idFromName: () => 'app-controller-id' as unknown as DurableObjectId,
    get: () =>
      ({
        consumeRateLimit: async (_key: string, limit: number, windowSeconds: number) => ({
          allowed: options.allowRequests ?? true,
          remaining: options.allowRequests === false ? 0 : limit,
          resetAt: Date.now() + windowSeconds * 1000,
        }),
      }) as unknown,
  }) as unknown as Env['APP_CONTROLLER']

const makeEnv = (overrides: Partial<Env> = {}): Env =>
  ({
    APP_CONTROLLER: buildAppControllerNamespace(),
    AI_PROVIDER: 'google-gateway',
    ...overrides,
  }) as Env

const withTenantSecurity: MiddlewareHandler<TestAppEnv> = async (c, next) => {
  c.set(CTX_TENANT_ID, 'tenant_test_123456')
  c.set(CTX_CLIENT_IP, '127.0.0.1')
  await next()
}

const readRequestUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

const readGatewayRequests = (init: RequestInit | undefined) => {
  const rawBody = typeof init?.body === 'string' ? init.body : ''
  return JSON.parse(rawBody) as Array<{
    query?: {
      model?: string
      response_format?: unknown
    }
  }>
}

const readRequestedModel = (url: string, init: RequestInit | undefined): string => {
  if (url === GATEWAY_UNIVERSAL_URL) {
    return String(readGatewayRequests(init)[0]?.query?.model)
  }

  throw new Error(`Unexpected URL: ${url}`)
}

const createChatCompletionResponse = (
  model: string,
  content: unknown,
  finishReason: string | null = 'stop'
) =>
  new Response(
    JSON.stringify({
      id: 'chatcmpl_test',
      object: 'chat.completion',
      created: 0,
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content,
          },
          finish_reason: finishReason,
        },
      ],
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'cf-aig-step': '0',
      },
    }
  )

const withMockedFetch = async (mockFetch: typeof fetch, run: () => Promise<void>) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch

  try {
    await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}

const withMockedGatewayFetch = async (
  respond: (model: string) => Response | Promise<Response>,
  run: (attemptedModels: string[]) => Promise<void>
) => {
  const attemptedModels: string[] = []

  await withMockedFetch(
    (async (input, init) => {
      const url = readRequestUrl(input)
      const model = readRequestedModel(url, init)
      attemptedModels.push(model)
      return respond(model)
    }) as unknown as typeof fetch,
    async () => {
      await run(attemptedModels)
    }
  )
}

const createAiRoutesApp = (
  middleware: MiddlewareHandler<{
    Bindings: Env
  }> = withTenantSecurity as unknown as MiddlewareHandler<{
    Bindings: Env
  }>
) => {
  const app = new Hono<TestAppEnv>()
  registerAiRoutes(app as unknown as Hono<{ Bindings: Env }>, middleware)
  return app
}

const requestAnalyzeFit = (
  env: Partial<Env>,
  options: {
    body?: string
    headers?: Record<string, string>
  } = {},
  middleware?: MiddlewareHandler<{ Bindings: Env }>
) =>
  createAiRoutesApp(middleware).request(
    'https://portfolio.example.com/api/analyze-fit',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body:
        options.body ?? JSON.stringify({ jd: 'Robotics engineer with embedded C++ experience' }),
    },
    makeEnv(env)
  )

const requestAiHealth = (env: Partial<Env>) =>
  createAiRoutesApp().request(
    'https://portfolio.example.com/api/health/ai',
    undefined,
    makeEnv(env)
  )

describe('/api/health/ai Workers fallback', () => {
  it('reports GLM when the Gemma probe fails', async () => {
    const attemptedModels: string[] = []
    const response = await requestAiHealth({
      AI_PROVIDER: 'workers-ai',
      CF_AI_BASE_URL: GATEWAY_BASE_URL,
      AI: {
        run: async (model: string) => {
          attemptedModels.push(model)
          if (model === WORKERS_AI_MODELS[0]) {
            throw Object.assign(new Error('temporarily unavailable'), { code: 3040 })
          }
          return {
            choices: [
              {
                message: { role: 'assistant', content: 'pong' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }
        },
      } as unknown as Ai,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: { ok: true, model: WORKERS_AI_MODELS[1] },
    })
    expect(attemptedModels).toEqual([...WORKERS_AI_MODELS])
  })
})

describe('getStructuredFitAssessment', () => {
  it('falls back from invalid Gemma output to schema-valid GLM output', async () => {
    const calls: Array<{ model: string; inputs: Record<string, unknown> }> = []
    const runtime = resolveModelRuntime({
      AI_PROVIDER: 'workers-ai',
      CF_AI_BASE_URL: GATEWAY_BASE_URL,
      AI: {
        run: async (model: string, inputs: Record<string, unknown>) => {
          calls.push({ model, inputs })
          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content:
                    model === WORKERS_AI_MODELS[0]
                      ? 'not json'
                      : JSON.stringify(validFitAssessment),
                },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          }
        },
      } as unknown as Ai,
    })
    if (!runtime || runtime.provider !== 'workers-ai') {
      throw new Error('Expected Workers AI runtime')
    }

    const result = await getStructuredFitAssessment(runtime, 'Embedded systems JD')

    expect(result).toEqual(validFitAssessment)
    expect(calls.map(({ model }) => model)).toEqual([...WORKERS_AI_MODELS])
    expect(calls[1].inputs.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { title: FIT_ANALYSIS_RESPONSE_SCHEMA_NAME },
    })
  })

  it('cancels the active Workers attempt without starting fallback when the request aborts', async () => {
    const attemptedModels: string[] = []
    let signal: AbortSignal | undefined
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const runtime = resolveModelRuntime({
      AI_PROVIDER: 'workers-ai',
      CF_AI_BASE_URL: GATEWAY_BASE_URL,
      AI: {
        run: async (model: string, _inputs: Record<string, unknown>, options: AiOptions) => {
          attemptedModels.push(model)
          signal = options.signal
          markStarted?.()
          return await new Promise((_, reject) => {
            options.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
              once: true,
            })
          })
        },
      } as unknown as Ai,
    })
    if (!runtime || runtime.provider !== 'workers-ai') {
      throw new Error('Expected Workers AI runtime')
    }

    const requestController = new AbortController()
    const result = getStructuredFitAssessment(
      runtime,
      'Embedded systems JD',
      requestController.signal
    )
    await started
    requestController.abort(new Error('request cancelled'))

    await expect(result).rejects.toThrow('request cancelled')
    expect(signal?.aborted).toBe(true)
    expect(attemptedModels).toEqual([WORKERS_AI_MODELS[0]])
  })

  it('retries when the first fit model returns non-JSON structured text', async () => {
    await withMockedGatewayFetch(
      (model) =>
        model === FIT_ANALYSIS_MODELS[0]
          ? createChatCompletionResponse(model, 'not json')
          : createChatCompletionResponse(model, JSON.stringify(validFitAssessment)),
      async (attemptedModels) => {
        const result = await getStructuredFitAssessment(AI_GATEWAY_PROVIDER, 'Robotics JD')

        expect(result).toEqual(validFitAssessment)
        expect(attemptedModels).toEqual(FIT_ANALYSIS_MODELS.slice(0, 2))
      }
    )
  })

  it('retries when the first fit model returns schema-invalid structured content', async () => {
    await withMockedGatewayFetch(
      (model) =>
        model === FIT_ANALYSIS_MODELS[0]
          ? createChatCompletionResponse(model, JSON.stringify({ verdict: 'Strong Fit' }))
          : createChatCompletionResponse(model, JSON.stringify(validFitAssessment)),
      async (attemptedModels) => {
        const result = await getStructuredFitAssessment(AI_GATEWAY_PROVIDER, 'Embedded JD')

        expect(result).toEqual(validFitAssessment)
        expect(attemptedModels).toEqual(FIT_ANALYSIS_MODELS.slice(0, 2))
      }
    )
  })

  it('fails after exhausting the two-model fit-analysis fallback chain', async () => {
    await withMockedGatewayFetch(
      (model) => {
        if (model === FIT_ANALYSIS_MODELS[0]) {
          return createChatCompletionResponse(model, null)
        }

        return createChatCompletionResponse(model, JSON.stringify({ verdict: 'Strong Fit' }))
      },
      async (attemptedModels) => {
        await expect(getStructuredFitAssessment(AI_GATEWAY_PROVIDER, 'Systems JD')).rejects.toThrow(
          'No object generated: response did not match schema.'
        )
        expect(attemptedModels).toEqual([...FIT_ANALYSIS_MODELS])
      }
    )
  })

  it('retries when the first fit model returns schema-valid JSON with a non-stop finish reason', async () => {
    await withMockedGatewayFetch(
      (model) =>
        model === FIT_ANALYSIS_MODELS[0]
          ? createChatCompletionResponse(model, JSON.stringify(validFitAssessment), 'length')
          : createChatCompletionResponse(model, JSON.stringify(validFitAssessment)),
      async (attemptedModels) => {
        const result = await getStructuredFitAssessment(AI_GATEWAY_PROVIDER, 'Platform JD')

        expect(result).toEqual(validFitAssessment)
        expect(attemptedModels).toEqual(FIT_ANALYSIS_MODELS.slice(0, 2))
      }
    )
  })

  it('retries when the first fit model returns truncated structured JSON', async () => {
    await withMockedGatewayFetch(
      (model) =>
        model === FIT_ANALYSIS_MODELS[0]
          ? createChatCompletionResponse(
              model,
              JSON.stringify(validFitAssessment).slice(0, -1),
              'length'
            )
          : createChatCompletionResponse(model, JSON.stringify(validFitAssessment)),
      async (attemptedModels) => {
        const result = await getStructuredFitAssessment(AI_GATEWAY_PROVIDER, 'Controls JD')

        expect(result).toEqual(validFitAssessment)
        expect(attemptedModels).toEqual(FIT_ANALYSIS_MODELS.slice(0, 2))
      }
    )
  })

  it('retries when the first fit model hits a transport-level fetch failure', async () => {
    await withMockedGatewayFetch(
      (model) => {
        if (model === FIT_ANALYSIS_MODELS[0]) {
          throw new TypeError('fetch failed')
        }

        return createChatCompletionResponse(model, JSON.stringify(validFitAssessment))
      },
      async (attemptedModels) => {
        const result = await getStructuredFitAssessment(AI_GATEWAY_PROVIDER, 'Robotics JD')

        expect(result).toEqual(validFitAssessment)
        expect(attemptedModels).toEqual(FIT_ANALYSIS_MODELS.slice(0, 2))
      }
    )
  })

  it('pins the production structured request to json_schema on the universal gateway path', async () => {
    let requestUrl = ''
    let requestBody:
      | Array<{
          query?: {
            model?: string
            response_format?: unknown
          }
        }>
      | undefined

    await withMockedFetch(
      (async (input, init) => {
        requestUrl = readRequestUrl(input)
        requestBody = readGatewayRequests(init)
        return createChatCompletionResponse(
          String(requestBody[0]?.query?.model),
          JSON.stringify(validFitAssessment)
        )
      }) as unknown as typeof fetch,
      async () => {
        const result = await getStructuredFitAssessment(AI_GATEWAY_PROVIDER, 'Embedded JD')
        expect(result).toEqual(validFitAssessment)
      }
    )

    expect(requestUrl).toBe(GATEWAY_UNIVERSAL_URL)
    expect(requestBody).toMatchObject([
      {
        query: {
          model: FIT_ANALYSIS_MODELS[0],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: FIT_ANALYSIS_RESPONSE_SCHEMA_NAME,
              strict: true,
            },
          },
        },
      },
    ])
  })

  it('retries when the first fit model returns object-style bullets outside the strict schema', async () => {
    const nonStrictResult = {
      ...validFitAssessment,
      matches: [
        {
          requirement: 'Embedded C++',
          evidence: 'Programmed Arduino Uno and calibrated servo behavior in C++.',
        },
      ],
    }

    await withMockedGatewayFetch(
      (model) =>
        model === FIT_ANALYSIS_MODELS[0]
          ? createChatCompletionResponse(model, JSON.stringify(nonStrictResult))
          : createChatCompletionResponse(model, JSON.stringify(validFitAssessment)),
      async (attemptedModels) => {
        const result = await getStructuredFitAssessment(AI_GATEWAY_PROVIDER, 'Embedded JD')

        expect(result).toEqual(validFitAssessment)
        expect(attemptedModels).toEqual(FIT_ANALYSIS_MODELS.slice(0, 2))
      }
    )
  })
})

describe('/api/analyze-fit error contract', () => {
  it('emits a stable code when the security context is missing', async () => {
    const response = await requestAnalyzeFit({}, {}, (async (_c, next) => {
      await next()
    }) as MiddlewareHandler<{ Bindings: Env }>)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      success: false,
      code: 'ANALYSIS_UNAVAILABLE',
      error: 'Missing security context',
    })
  })

  it('emits a stable code when Turnstile is enabled but not configured', async () => {
    const response = await requestAnalyzeFit({ REQUIRE_TURNSTILE: 'true' })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      success: false,
      code: 'VERIFICATION_UNAVAILABLE',
      error: 'Verification gate is enabled but not configured',
    })
  })

  it('emits a stable code when the Turnstile token is missing', async () => {
    const response = await requestAnalyzeFit({
      REQUIRE_TURNSTILE: 'true',
      TURNSTILE_SECRET_KEY: 'turnstile-secret',
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      success: false,
      code: 'VERIFICATION_REQUIRED',
      error: 'Verification token is required',
    })
  })

  it('emits a stable code when fit analysis is rate limited', async () => {
    const response = await requestAnalyzeFit({
      APP_CONTROLLER: buildAppControllerNamespace({ allowRequests: false }),
    })

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      success: false,
      code: 'RATE_LIMITED',
      error: 'Rate limit exceeded',
    })
  })

  it('emits a stable code for malformed request bodies', async () => {
    const response = await requestAnalyzeFit({}, { body: '{bad json' })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      success: false,
      code: 'INVALID_REQUEST',
      error: 'Malformed JSON body',
    })
  })

  it('emits a stable code when the job description payload is too large', async () => {
    const response = await requestAnalyzeFit(
      { MAX_FIT_ANALYZE_BYTES: '12' },
      { body: JSON.stringify({ jd: 'x'.repeat(200) }) }
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      success: false,
      code: 'REQUEST_TOO_LARGE',
      error: 'Request body is too large',
    })
  })

  it('emits a stable code when the job description is missing', async () => {
    const response = await requestAnalyzeFit({}, { body: JSON.stringify({ jd: '   ' }) })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      success: false,
      code: 'MISSING_JOB_DESCRIPTION',
      error: 'jd is required',
    })
  })

  it('emits a stable code when the AI integration is unavailable', async () => {
    const response = await requestAnalyzeFit({})

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      success: false,
      code: 'ANALYSIS_UNAVAILABLE',
      error: 'AI integration is not configured',
    })
  })

  it('emits a stable code when fit analysis exhausts the configured model attempts', async () => {
    await withMockedGatewayFetch(
      (model) => createChatCompletionResponse(model, JSON.stringify({ verdict: 'Strong Fit' })),
      async (attemptedModels) => {
        const response = await requestAnalyzeFit({
          CF_AI_GATEWAY_TOKEN: GATEWAY_API_KEY,
          CF_AI_BASE_URL: GATEWAY_BASE_URL,
        })

        expect(response.status).toBe(500)
        await expect(response.json()).resolves.toEqual({
          success: false,
          code: 'ANALYSIS_FAILED',
          error: 'Failed to analyze fit',
        })
        expect(attemptedModels).toEqual([...FIT_ANALYSIS_MODELS])
      }
    )
  })
})

describe('/api/analyze-fit success contract', () => {
  it('returns the validated success envelope when the provider returns structured JSON', async () => {
    await withMockedGatewayFetch(
      (model) => createChatCompletionResponse(model, JSON.stringify(validFitAssessment)),
      async () => {
        const response = await requestAnalyzeFit({
          CF_AI_GATEWAY_TOKEN: GATEWAY_API_KEY,
          CF_AI_BASE_URL: GATEWAY_BASE_URL,
        })

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual({
          success: true,
          data: validFitAssessment,
        })
      }
    )
  })

  it('fails closed when the first model returns object-shaped assistant content on the universal gateway path', async () => {
    await withMockedGatewayFetch(
      (model) => createChatCompletionResponse(model, validFitAssessment),
      async (attemptedModels) => {
        const response = await requestAnalyzeFit({
          CF_AI_GATEWAY_TOKEN: GATEWAY_API_KEY,
          CF_AI_BASE_URL: GATEWAY_BASE_URL,
        })

        expect(response.status).toBe(500)
        await expect(response.json()).resolves.toEqual({
          success: false,
          code: 'ANALYSIS_FAILED',
          error: 'Failed to analyze fit',
        })
        expect(attemptedModels).toEqual([FIT_ANALYSIS_MODELS[0]])
      }
    )
  })

  it('falls back when the first model returns object-style evidence bullets outside the strict schema', async () => {
    const nonStrictResult = {
      ...validFitAssessment,
      matches: [
        {
          requirement: 'Embedded C++',
          evidence: 'Programmed Arduino Uno and calibrated servo behavior in C++.',
        },
      ],
      keyGaps: [
        {
          gap: 'No documented ROS2 production experience',
        },
      ],
      transferableStrengths: [
        {
          strength: 'Hands-on hardware integration experience transfers well.',
        },
      ],
    }

    await withMockedGatewayFetch(
      (model) =>
        model === FIT_ANALYSIS_MODELS[0]
          ? createChatCompletionResponse(model, JSON.stringify(nonStrictResult))
          : createChatCompletionResponse(model, JSON.stringify(validFitAssessment)),
      async (attemptedModels) => {
        const response = await requestAnalyzeFit({
          CF_AI_GATEWAY_TOKEN: GATEWAY_API_KEY,
          CF_AI_BASE_URL: GATEWAY_BASE_URL,
        })

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual({
          success: true,
          data: validFitAssessment,
        })
        expect(attemptedModels).toEqual(FIT_ANALYSIS_MODELS.slice(0, 2))
      }
    )
  })
})
