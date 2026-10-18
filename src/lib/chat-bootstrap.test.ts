/* eslint-disable import/no-unresolved */
import { CHAT_BOOTSTRAP_ROUTE_PREFIX } from '@shared/chat'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createMockFetch } from '../../test-utils/create-mock-fetch'
import {
  ensureChatBootstrapLoaded,
  getChatBootstrapSnapshot,
  resetChatBootstrapStateForTests,
  retryChatBootstrap,
} from './chat-bootstrap'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return {
    promise,
    resolve,
    reject,
  }
}

const createBootstrapResponse = (requireTurnstile: boolean, hasValidChallenge = false) =>
  new Response(
    JSON.stringify({
      success: true,
      data: {
        requireTurnstile,
        hasValidChallenge,
        challengeExpiresAt: null,
      },
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  )

const originalFetch = globalThis.fetch

describe('chat bootstrap', () => {
  beforeEach(() => {
    resetChatBootstrapStateForTests()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    resetChatBootstrapStateForTests()
  })

  it('shares one fetch across concurrent callers and caches the successful result', async () => {
    let fetchCalls = 0
    const deferredResponse = createDeferred<Response>()

    globalThis.fetch = createMockFetch(async (input, init) => {
      fetchCalls += 1
      expect(input).toBe(`/${CHAT_BOOTSTRAP_ROUTE_PREFIX}/bootstrap`)
      expect(init?.credentials).toBe('same-origin')
      return deferredResponse.promise
    })

    const firstLoad = ensureChatBootstrapLoaded()
    const secondLoad = ensureChatBootstrapLoaded()

    expect(fetchCalls).toBe(1)
    expect(getChatBootstrapSnapshot()).toEqual({
      status: 'loading',
      data: null,
      error: null,
    })

    deferredResponse.resolve(createBootstrapResponse(true))

    await expect(firstLoad).resolves.toEqual({
      requireTurnstile: true,
      hasValidChallenge: false,
      challengeExpiresAt: null,
    })
    await expect(secondLoad).resolves.toEqual({
      requireTurnstile: true,
      hasValidChallenge: false,
      challengeExpiresAt: null,
    })

    expect(getChatBootstrapSnapshot()).toEqual({
      status: 'ready',
      data: { requireTurnstile: true, hasValidChallenge: false, challengeExpiresAt: null },
      error: null,
    })

    await expect(ensureChatBootstrapLoaded()).resolves.toEqual({
      requireTurnstile: true,
      hasValidChallenge: false,
      challengeExpiresAt: null,
    })
    expect(fetchCalls).toBe(1)
  })

  it('rejects invalid success payloads instead of silently disabling Turnstile', async () => {
    globalThis.fetch = createMockFetch(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: {},
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        )
    )

    await expect(ensureChatBootstrapLoaded()).rejects.toThrow(
      'Chat bootstrap returned an invalid payload'
    )
    expect(getChatBootstrapSnapshot().status).toBe('error')
    expect(getChatBootstrapSnapshot().data).toBeNull()
    expect(getChatBootstrapSnapshot().error?.message).toBe(
      'Chat bootstrap returned an invalid payload'
    )
  })

  it('does not cache failures forever and retries with a fresh request', async () => {
    let fetchCalls = 0
    let shouldFail = true

    globalThis.fetch = createMockFetch(async () => {
      fetchCalls += 1

      if (shouldFail) {
        return new Response('unavailable', { status: 503 })
      }

      return createBootstrapResponse(false)
    })

    await expect(ensureChatBootstrapLoaded()).rejects.toThrow(
      'Chat bootstrap failed with status 503'
    )
    expect(fetchCalls).toBe(1)
    expect(getChatBootstrapSnapshot().status).toBe('error')

    shouldFail = false

    await expect(retryChatBootstrap()).resolves.toEqual({
      requireTurnstile: false,
      hasValidChallenge: false,
      challengeExpiresAt: null,
    })
    expect(fetchCalls).toBe(2)
    expect(getChatBootstrapSnapshot()).toEqual({
      status: 'ready',
      data: { requireTurnstile: false, hasValidChallenge: false, challengeExpiresAt: null },
      error: null,
    })
  })
})
