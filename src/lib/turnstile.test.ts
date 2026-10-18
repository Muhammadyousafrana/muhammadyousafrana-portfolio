/* eslint-disable import/no-unresolved */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createMockFetch } from '../../test-utils/create-mock-fetch'
// Drive the REAL bootstrap store (reset per-test) rather than mock.module'ing
// '@/lib/chat-bootstrap' — a module mock leaks process-wide in bun and would
// strip real exports that chat-bootstrap.test.ts imports.
import { ensureChatBootstrapLoaded, resetChatBootstrapStateForTests } from './chat-bootstrap'
import { useTurnstileChallengeController } from './turnstile'

const originalFetch = globalThis.fetch

const primeBootstrap = (requireTurnstile: boolean) => {
  globalThis.fetch = createMockFetch(
    async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: { requireTurnstile, hasValidChallenge: false, challengeExpiresAt: null },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
  )
  return ensureChatBootstrapLoaded()
}

type ControllerValue = ReturnType<typeof useTurnstileChallengeController>

let captured: ControllerValue | null = null

function Harness() {
  captured = useTurnstileChallengeController()
  return null
}

const renderController = (): ControllerValue => {
  captured = null
  renderToStaticMarkup(createElement(Harness))
  if (!captured) {
    throw new Error('controller did not render')
  }
  return captured
}

describe('useTurnstileChallengeController', () => {
  beforeEach(() => {
    resetChatBootstrapStateForTests()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    resetChatBootstrapStateForTests()
  })

  it('treats chat as verified and needs no challenge when Turnstile is not required', async () => {
    await primeBootstrap(false)
    const controller = renderController()

    expect(controller.requireTurnstile).toBe(false)
    expect(controller.isVerified).toBe(true)
    expect(controller.needsChallenge).toBe(false)
    await expect(controller.requestChallenge()).resolves.toBe(true)
  })

  it('cannot verify and reports needing no interactive challenge when the site key is missing', async () => {
    // No VITE_TURNSTILE_SITE_KEY in the test env, so the build is unconfigured.
    await primeBootstrap(true)
    const controller = renderController()

    expect(controller.requireTurnstile).toBe(true)
    expect(controller.isConfigured).toBe(false)
    // Without a site key there is nothing to render, so requesting a challenge
    // resolves false rather than hanging on a widget that can never load.
    expect(controller.needsChallenge).toBe(false)
    await expect(controller.requestChallenge()).resolves.toBe(false)
  })
})
