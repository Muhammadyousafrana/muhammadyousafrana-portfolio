/* eslint-disable import/no-unresolved */
import { describe, expect, it, mock } from 'bun:test'
import { createMockChatEnv, type MockChatEnvOptions } from '../test-utils/mock-chat-env'
import type { Env } from './core-utils'

mock.module('cloudflare:email', () => ({
  EmailMessage: class EmailMessage {},
}))

mock.module('cloudflare:workers', () => ({
  DurableObject: class DurableObject {},
  env: {},
}))

const handler = (await import('./index')).default

const execContext = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext

const postClientError = (body: BodyInit, options: MockChatEnvOptions = {}): Promise<Response> => {
  const mocked = createMockChatEnv(options)
  const request = new Request('http://localhost/api/client-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '1.2.3.4' },
    body,
  })
  return handler.fetch(
    request as unknown as Parameters<typeof handler.fetch>[0],
    mocked.env as Env,
    execContext
  )
}

describe('POST /api/client-errors', () => {
  it('accepts and logs a well-formed report (shadowing the legacy handler)', async () => {
    const response = await postClientError(
      JSON.stringify({ message: 'boom', url: 'http://x/', stack: 'at foo' })
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true })
  })

  it('rejects oversized payloads with 413 (legacy handler would 200)', async () => {
    const response = await postClientError(JSON.stringify({ message: 'x'.repeat(64) }), {
      env: { MAX_CLIENT_ERROR_BYTES: '16' },
    })
    expect(response.status).toBe(413)
  })

  it('rejects bodies without a usable message field with 400', async () => {
    const response = await postClientError(JSON.stringify({ notMessage: 'nope' }))
    expect(response.status).toBe(400)
  })

  it('returns 429 when the IP rate limit is exhausted', async () => {
    const response = await postClientError(JSON.stringify({ message: 'boom' }), {
      rateLimitResult: { allowed: false, remaining: 0, resetAt: Date.now() + 60_000 },
    })
    expect(response.status).toBe(429)
  })
})
