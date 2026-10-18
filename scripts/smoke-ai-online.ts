#!/usr/bin/env bun

import { uiMessageChunkSchema, type UIMessageChunk } from 'ai'
import assert from 'node:assert/strict'
import { CHAT_TOOL_NAME } from '../shared/chat-tools'
import { fitAssessmentSuccessResponseSchema } from '../shared/fit-analysis'
import { getModelIds, parseAiProvider } from '../shared/models'

const baseUrl = process.env.SMOKE_BASE_URL?.replace(/\/$/, '')
const healthToken = process.env.AI_HEALTH_TOKEN?.trim()

if (!baseUrl || !healthToken) {
  console.log('[smoke:ai:online] SKIP: set SMOKE_BASE_URL and AI_HEALTH_TOKEN to opt in.')
  process.exit(0)
}

const provider = parseAiProvider(process.env.AI_PROVIDER)
if (!provider || !process.env.AI_PROVIDER?.trim()) {
  console.error('[smoke:ai:online] Set AI_PROVIDER to workers-ai or google-gateway.')
  process.exit(2)
}

const origin = new URL(baseUrl).origin
const request = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { Origin: origin, ...init.headers },
    signal: AbortSignal.timeout(120_000),
  })

const readJson = async (response: Response) => {
  const text = await response.text()
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`${response.url} returned non-JSON: ${text.slice(0, 200)}`)
  }
}

const parseUiChunks = async (response: Response): Promise<UIMessageChunk[]> => {
  const chunks: UIMessageChunk[] = []
  for (const frame of (await response.text()).split('\n\n')) {
    const line = frame.trim()
    if (!line.startsWith('data: ')) continue
    const payload = line.slice('data: '.length)
    if (payload === '[DONE]') continue
    const validation = await uiMessageChunkSchema().validate!(JSON.parse(payload))
    if (validation.success === false) throw validation.error
    chunks.push(validation.value)
  }
  return chunks
}

const assertSelectedModel = (model: string) => {
  assert(
    getModelIds(provider).some(
      (candidate) => candidate === model || candidate.endsWith(`/${model}`)
    ),
    `Health reported unexpected ${provider} model: ${model}`
  )
}

const main = async () => {
  const unauthenticatedHealth = await request('/api/health/ai')
  assert.equal(unauthenticatedHealth.status, 401, 'AI health endpoint must require AI_HEALTH_TOKEN')

  const health = await request('/api/health/ai', {
    headers: { Authorization: `Bearer ${healthToken}` },
  })
  const healthPayload = (await readJson(health)) as {
    success?: unknown
    data?: { ok?: unknown; model?: unknown; latencyMs?: unknown }
  }
  assert.equal(health.status, 200, `AI health failed: ${JSON.stringify(healthPayload)}`)
  assert.equal(healthPayload.success, true)
  assert.equal(healthPayload.data?.ok, true)
  assert.equal(typeof healthPayload.data?.model, 'string')
  assert.equal(typeof healthPayload.data?.latencyMs, 'number')
  assertSelectedModel(healthPayload.data.model as string)

  const bootstrap = await request('/api/chat/bootstrap')
  assert.equal(bootstrap.status, 200)
  const cookie = bootstrap.headers.get('set-cookie')?.split(';', 1)[0]
  assert(cookie, 'Chat bootstrap did not issue a tenant cookie')
  const bootstrapPayload = (await readJson(bootstrap)) as {
    success?: unknown
    data?: { requireTurnstile?: unknown; hasValidChallenge?: unknown }
  }
  assert.equal(bootstrapPayload.success, true)
  assert.equal(bootstrapPayload.data?.requireTurnstile, false)
  assert.equal(bootstrapPayload.data?.hasValidChallenge, true)

  const workersToolCheck = provider === 'workers-ai'
  const chat = await request('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      messages: [
        {
          id: workersToolCheck ? 'online-workers-tool-check' : 'online-google-chat-check',
          role: 'user',
          parts: [
            {
              type: 'text',
              text: workersToolCheck
                ? 'Call get_weather exactly once with latitude 40.7128 and longitude -74.0060. After the tool returns, answer in one short sentence using its result. Do not answer before calling the tool.'
                : 'Reply in one short sentence describing the candidate profile.',
            },
          ],
        },
      ],
    }),
  })
  if (!chat.ok)
    throw new Error(`Chat failed (${chat.status}): ${(await chat.text()).slice(0, 300)}`)
  assert.match(chat.headers.get('content-type') ?? '', /text\/event-stream/)
  const chunks = await parseUiChunks(chat)
  assert.equal(
    chunks.some((chunk) => chunk.type.startsWith('reasoning-')),
    false
  )
  assert.equal(
    chunks.some((chunk) => chunk.type === 'error' || chunk.type === 'abort'),
    false
  )
  assert(
    chunks.some((chunk) => chunk.type === 'finish'),
    'Chat stream did not finish'
  )

  if (workersToolCheck) {
    const toolInputs = chunks.filter(
      (chunk): chunk is Extract<UIMessageChunk, { type: 'tool-input-available' }> =>
        chunk.type === 'tool-input-available' && chunk.toolName === CHAT_TOOL_NAME.getWeather
    )
    assert.equal(toolInputs.length, 1, 'Expected exactly one get_weather call')
    const toolCallId = toolInputs[0].toolCallId
    const toolOutputIndex = chunks.findIndex(
      (chunk) => chunk.type === 'tool-output-available' && chunk.toolCallId === toolCallId
    )
    const answerIndex = chunks.findIndex(
      (chunk, index) =>
        index > toolOutputIndex && chunk.type === 'text-delta' && chunk.delta.trim().length > 0
    )
    assert(toolOutputIndex > chunks.indexOf(toolInputs[0]), 'Tool output must follow tool input')
    assert(answerIndex > toolOutputIndex, 'Assistant answer must follow the tool output')
  } else {
    assert(
      chunks.some((chunk) => chunk.type === 'text-delta' && chunk.delta.trim().length > 0),
      'Google chat returned no text'
    )
  }

  const fit = await request('/api/analyze-fit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      jd: 'Embedded firmware engineer developing C and C++ for microcontrollers, debugging electronics with oscilloscopes and logic analyzers, and working with CAN communication.',
    }),
  })
  const fitPayload = await readJson(fit)
  assert.equal(fit.status, 200, `Fit analysis failed: ${JSON.stringify(fitPayload)}`)
  fitAssessmentSuccessResponseSchema.parse(fitPayload)

  console.log(`[smoke:ai:online] PASS: ${provider} health, chat, and fit checks succeeded.`)
}

await main()
