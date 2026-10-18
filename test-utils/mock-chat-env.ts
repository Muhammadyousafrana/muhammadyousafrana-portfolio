/* eslint-disable import/no-unresolved */
import { mock } from 'bun:test'
import type { Env } from '../worker/core-utils'

type RateLimitResult = { allowed: boolean; remaining: number; resetAt: number }

export interface MockChatEnvOptions {
  rateLimitResult?: RateLimitResult
  env?: Partial<Env>
}

export interface MockChatEnv {
  env: Env
  consumeRateLimit: ReturnType<typeof mock>
}

// Builds an `Env` whose APP_CONTROLLER namespace resolves to a single stub with
// a spyable rate-limit method, so admission tests can assert exactly which
// controller calls a code path makes.
export const createMockChatEnv = (options: MockChatEnvOptions = {}): MockChatEnv => {
  const consumeRateLimit = mock(
    async () =>
      options.rateLimitResult ?? { allowed: true, remaining: 39, resetAt: Date.now() + 60_000 }
  )

  const stub = { consumeRateLimit }
  const env = {
    APP_CONTROLLER: {
      idFromName: (name: string) => name,
      get: () => stub,
    },
    ...options.env,
  } as unknown as Env

  return { env, consumeRateLimit }
}
