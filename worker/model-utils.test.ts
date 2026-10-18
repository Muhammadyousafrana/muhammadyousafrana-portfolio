/* eslint-disable import/no-unresolved */
import { generateText, Output, stepCountIs, streamText, tool } from 'ai'
import { AiGatewayUnauthorizedError } from 'ai-gateway-provider'
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import {
  createStructuredModel,
  createTextModel,
  isAiGatewayAuthError,
  ModelAttemptTimeoutError,
  resolveAiGatewayApiSettings,
  resolveGoogleGatewayRuntime,
  resolveModelRuntime,
  withModelFallback,
} from './model-utils'

const GATEWAY_API_KEY = 'test-key'
const GATEWAY_LOCATOR_URL = 'https://gateway.example.com/v1/account/gateway/compat'
const GATEWAY_UNIVERSAL_URL = 'https://gateway.ai.cloudflare.com/v1/account/gateway'

const createChatCompletionResponse = (model: string, content: unknown) =>
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
          finish_reason: 'stop',
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

describe('resolveGoogleGatewayRuntime', () => {
  it('extracts account and gateway ids from the current compat base URL shape', () => {
    expect(
      resolveAiGatewayApiSettings({
        apiKey: GATEWAY_API_KEY,
        baseURL: GATEWAY_LOCATOR_URL,
      })
    ).toEqual({
      accountId: 'account',
      gateway: 'gateway',
      apiKey: GATEWAY_API_KEY,
    })
  })

  it('returns a reusable provider config for valid compat URLs', () => {
    const provider = resolveGoogleGatewayRuntime({
      apiKey: GATEWAY_API_KEY,
      baseURL: GATEWAY_LOCATOR_URL,
    })

    expect(provider).toBeDefined()
  })

  it('returns undefined for invalid compat URLs', () => {
    expect(
      resolveGoogleGatewayRuntime({
        apiKey: GATEWAY_API_KEY,
        baseURL: 'https://gateway.example.com/not-compat',
      })
    ).toBeUndefined()
  })
})

describe('resolveModelRuntime', () => {
  it('builds a Workers AI runtime without a Google API key', () => {
    const runtime = resolveModelRuntime({
      AI: { run: async () => ({}) } as unknown as Ai,
      AI_PROVIDER: 'workers-ai',
      CF_AI_BASE_URL: GATEWAY_LOCATOR_URL,
    })

    expect(runtime?.provider).toBe('workers-ai')
    if (!runtime) throw new Error('Expected Workers AI runtime')

    const model = createTextModel(runtime, '@cf/zai-org/glm-4.7-flash')
    expect(model.provider).toBe('workersai.chat')
    expect(model.modelId).toBe('@cf/zai-org/glm-4.7-flash')
  })

  it('keeps Google Gateway available behind the provider switch', () => {
    const runtime = resolveModelRuntime({
      AI_PROVIDER: 'google-gateway',
      CF_AI_GATEWAY_TOKEN: GATEWAY_API_KEY,
      CF_AI_BASE_URL: GATEWAY_LOCATOR_URL,
    })

    expect(runtime?.provider).toBe('google-gateway')
  })

  it('rejects unknown provider values', () => {
    expect(
      resolveModelRuntime({
        AI: { run: async () => ({}) } as unknown as Ai,
        AI_PROVIDER: 'unknown',
        CF_AI_BASE_URL: GATEWAY_LOCATOR_URL,
      })
    ).toBeUndefined()
  })
})

// Native Google generateContent response (the chat/text wire), as opposed to
// the OpenAI-compatible chat.completion shape the structured/compat path uses.
const createGoogleGenerateContentResponse = (text: string) =>
  new Response(
    JSON.stringify({
      candidates: [
        {
          content: { role: 'model', parts: [{ text }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'cf-aig-step': '0',
      },
    }
  )

describe('gateway model helpers', () => {
  const getProvider = () => {
    const provider = resolveGoogleGatewayRuntime({
      apiKey: GATEWAY_API_KEY,
      baseURL: GATEWAY_LOCATOR_URL,
    })
    if (!provider) {
      throw new Error('Expected valid provider config')
    }
    return provider
  }

  it('builds text models on the native Google provider with the gateway prefix stripped', () => {
    const model = createTextModel(getProvider(), 'google-ai-studio/gemini-3.1-flash-lite')

    expect(model.provider).toBe('google.generative-ai')
    expect(model.modelId).toBe('gemini-3.1-flash-lite')
  })

  it('passes an already-bare model id through unchanged', () => {
    const model = createTextModel(getProvider(), 'gemini-3.1-flash-lite')

    expect(model.provider).toBe('google.generative-ai')
    expect(model.modelId).toBe('gemini-3.1-flash-lite')
  })

  it('builds the ordered native-Google fallback chain through the universal gateway path', async () => {
    const provider = getProvider()
    const originalFetch = globalThis.fetch
    let requestUrl = ''
    let requestBody = ''

    globalThis.fetch = (async (input, init) => {
      requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      requestBody = typeof init?.body === 'string' ? init.body : ''
      return createGoogleGenerateContentResponse('ok')
    }) as typeof fetch

    try {
      const result = await generateText({
        model: createTextModel(provider, [
          'google-ai-studio/gemini-3.1-flash-lite',
          'google-ai-studio/gemini-3-flash-preview',
        ]),
        prompt: 'Say ok',
        maxRetries: 0,
      })

      expect(result.text).toBe('ok')
      expect(requestUrl).toBe(GATEWAY_UNIVERSAL_URL)
      const body = JSON.parse(requestBody) as { provider: string; endpoint: string }[]
      expect(body.map(({ provider: p, endpoint }) => ({ provider: p, endpoint }))).toEqual([
        {
          provider: 'google-ai-studio',
          endpoint: 'v1beta/models/gemini-3.1-flash-lite:generateContent',
        },
        {
          provider: 'google-ai-studio',
          endpoint: 'v1beta/models/gemini-3-flash-preview:generateContent',
        },
      ])
      // The provider's placeholder key must never reach the gateway body.
      expect(requestBody).not.toContain('CF_TEMP_TOKEN')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('builds the production structured model through the universal gateway path', async () => {
    const provider = resolveGoogleGatewayRuntime({
      apiKey: GATEWAY_API_KEY,
      baseURL: GATEWAY_LOCATOR_URL,
    })
    if (!provider) {
      throw new Error('Expected valid provider config')
    }

    const originalFetch = globalThis.fetch
    let requestUrl = ''
    let requestBody = ''

    globalThis.fetch = (async (input, init) => {
      requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      requestBody = typeof init?.body === 'string' ? init.body : ''
      return createChatCompletionResponse(
        'google-ai-studio/gemini-3-flash-preview',
        JSON.stringify({ ok: true })
      )
    }) as typeof fetch

    try {
      const result = await generateText({
        model: createStructuredModel(provider, 'google-ai-studio/gemini-3-flash-preview', {
          supportsStructuredOutputs: true,
        }),
        prompt: 'Return ok',
        maxRetries: 0,
        output: Output.object({
          schema: z.object({ ok: z.boolean() }),
          name: 'test_object',
        }),
      })

      expect(result.output).toEqual({ ok: true })
      expect(requestUrl).toBe(GATEWAY_UNIVERSAL_URL)
      expect(JSON.parse(requestBody)).toMatchObject([
        {
          provider: 'compat',
          endpoint: 'chat/completions',
          query: {
            model: 'google-ai-studio/gemini-3-flash-preview',
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'test_object',
                strict: true,
              },
            },
          },
        },
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('Workers AI model helpers', () => {
  const createRuntime = (
    run: (model: string, inputs: Record<string, unknown>, options: AiOptions) => Promise<unknown>
  ) => {
    const runtime = resolveModelRuntime({
      AI: { run: run as unknown as Ai['run'] } as Ai,
      AI_PROVIDER: 'workers-ai',
      CF_AI_BASE_URL: GATEWAY_LOCATOR_URL,
    })
    if (!runtime || runtime.provider !== 'workers-ai') {
      throw new Error('Expected Workers AI runtime')
    }
    return runtime
  }

  it('passes structured-output schemas through the Workers AI binding', async () => {
    const calls: Array<{ model: string; inputs: Record<string, unknown>; options: AiOptions }> = []
    const runtime = createRuntime(async (model, inputs, options) => {
      calls.push({ model, inputs, options })
      return {
        choices: [
          {
            message: { role: 'assistant', content: JSON.stringify({ ok: true }) },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }
    })

    const result = await generateText({
      model: createStructuredModel(runtime, '@cf/zai-org/glm-4.7-flash'),
      prompt: 'Return ok',
      maxRetries: 0,
      output: Output.object({
        schema: z.object({ ok: z.boolean() }),
        name: 'test_object',
      }),
    })

    expect(result.output).toEqual({ ok: true })
    expect(calls[0].model).toBe('@cf/zai-org/glm-4.7-flash')
    expect(calls[0].options.gateway?.id).toBe('gateway')
    expect(calls[0].inputs.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { title: 'test_object' },
    })
  })

  it('falls back to GLM when Gemma fails before returning a stream', async () => {
    const calls: string[] = []
    const runtime = createRuntime(async (model) => {
      calls.push(model)
      if (model === '@cf/google/gemma-4-26b-a4b-it') throw new Error('Gemma unavailable')
      return {
        choices: [
          {
            message: { role: 'assistant', content: 'GLM fallback.' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }
    })

    const result = streamText({
      model: createTextModel(runtime, runtime.candidates),
      prompt: 'Say which model answered.',
      maxRetries: 0,
    })

    expect(await result.text).toBe('GLM fallback.')
    expect(calls).toEqual(['@cf/google/gemma-4-26b-a4b-it', '@cf/zai-org/glm-4.7-flash'])
  })

  it('does not call GLM when Gemma returns a stream successfully', async () => {
    const calls: string[] = []
    const runtime = createRuntime(async (model) => {
      calls.push(model)
      return {
        choices: [
          {
            message: { role: 'assistant', content: 'Gemma primary.' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }
    })

    const result = streamText({
      model: createTextModel(runtime, runtime.candidates),
      prompt: 'Say which model answered.',
      maxRetries: 0,
    })

    expect(await result.text).toBe('Gemma primary.')
    expect(calls).toEqual(['@cf/google/gemma-4-26b-a4b-it'])
  })

  it('preserves tool-call ids across a Workers AI continuation', async () => {
    const calls: Array<Record<string, unknown>> = []
    const runtime = createRuntime(async (_model, inputs) => {
      calls.push(inputs)
      if (calls.length === 1) {
        return {
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call_weather_1',
                    type: 'function',
                    function: { name: 'getWeather', arguments: '{"city":"Seattle"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }
      }

      return {
        choices: [
          {
            message: { role: 'assistant', content: 'Sunny.' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }
    })

    const result = await generateText({
      model: createTextModel(runtime, '@cf/zai-org/glm-4.7-flash'),
      prompt: 'Weather?',
      tools: {
        getWeather: tool({
          inputSchema: z.object({ city: z.string() }),
          execute: async ({ city }) => ({ city, condition: 'Sunny' }),
        }),
      },
      stopWhen: stepCountIs(2),
    })

    expect(result.text).toBe('Sunny.')
    const continuation = calls[1].messages as Array<Record<string, unknown>>
    expect(continuation).toContainEqual(
      expect.objectContaining({ role: 'tool', tool_call_id: 'call_weather_1' })
    )
  })
})

describe('withModelFallback perAttemptTimeoutMs', () => {
  // Never resolves, so the per-attempt timeout is what settles the attempt (no
  // orphan timers left running after the test).
  const hangForever = () => new Promise<string>(() => {})

  it('fails over to the next model when a model exceeds the per-attempt timeout', async () => {
    const attempted: string[] = []
    const result = await withModelFallback(
      ['slow-model', 'fast-model'],
      async (model) => {
        attempted.push(model)
        return model === 'slow-model' ? hangForever() : 'fast-result'
      },
      { perAttemptTimeoutMs: 20 }
    )

    expect(result).toBe('fast-result')
    expect(attempted).toEqual(['slow-model', 'fast-model'])
  })

  it('aborts the timed-out attempt so the model call is cancelled, not orphaned', async () => {
    const signals = new Map<string, AbortSignal | undefined>()
    const result = await withModelFallback(
      ['slow-model', 'fast-model'],
      (model, abortSignal) => {
        signals.set(model, abortSignal)
        if (model !== 'slow-model') {
          return Promise.resolve('fast-result')
        }
        // Reject with an unclassified (non-retryable) abort error inside the
        // abort listener, mimicking a cancelled model call. Failover succeeding
        // proves the surfaced error was still the retryable timeout, i.e. the
        // timer rejects before aborting.
        return new Promise<string>((_, reject) => {
          abortSignal?.addEventListener(
            'abort',
            () => reject(new DOMException('This operation was aborted', 'AbortError')),
            { once: true }
          )
        })
      },
      { perAttemptTimeoutMs: 20 }
    )

    expect(result).toBe('fast-result')
    expect(signals.get('slow-model')?.aborted).toBe(true)
    expect(signals.get('slow-model')?.reason).toBeInstanceOf(ModelAttemptTimeoutError)
    expect(signals.get('fast-model')?.aborted).toBe(false)
  })

  it('throws ModelAttemptTimeoutError fast when the last model also times out', async () => {
    const startedAt = Date.now()
    const attempt = withModelFallback(['slow-a', 'slow-b'], () => hangForever(), {
      perAttemptTimeoutMs: 20,
    })

    await expect(attempt).rejects.toBeInstanceOf(ModelAttemptTimeoutError)
    // Settled on the timeouts (~40ms for two attempts), not left hanging.
    expect(Date.now() - startedAt).toBeLessThan(500)
  })

  it('returns the first model result when it responds within the timeout', async () => {
    const attempted: string[] = []
    const result = await withModelFallback(
      ['first', 'second'],
      async (model) => {
        attempted.push(model)
        return 'ok'
      },
      { perAttemptTimeoutMs: 100 }
    )

    expect(result).toBe('ok')
    expect(attempted).toEqual(['first'])
  })
})

describe('isAiGatewayAuthError', () => {
  it('matches the AI Gateway unauthorized error class', () => {
    expect(isAiGatewayAuthError(new AiGatewayUnauthorizedError())).toBe(true)
  })

  it('keeps a narrow message fallback for wrapping or provider version drift', () => {
    const authMessage =
      "Your AI Gateway has authentication active, but you didn't provide a valid apiKey"
    expect(isAiGatewayAuthError(new Error(authMessage))).toBe(true)
  })

  it('does not flag ordinary model/transport failures', () => {
    expect(isAiGatewayAuthError(new Error('fetch failed'))).toBe(false)
    expect(
      isAiGatewayAuthError(new Error('No object generated: response did not match schema'))
    ).toBe(false)
    expect(isAiGatewayAuthError(Object.assign(new Error('rate limited'), { code: 429 }))).toBe(
      false
    )
    expect(isAiGatewayAuthError(undefined)).toBe(false)
  })

  it('does not misclassify an upstream provider key rejection as gateway drift', () => {
    // Google/BYOK-style upstream error — a different failure from gateway-token drift.
    expect(isAiGatewayAuthError(new Error('API key not valid. Please pass a valid API key.'))).toBe(
      false
    )
  })
})
