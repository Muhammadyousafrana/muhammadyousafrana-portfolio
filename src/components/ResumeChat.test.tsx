/* eslint-disable import/no-unresolved */
import { ResumeChat } from '@/components/ResumeChat'
import { ensureChatBootstrapLoaded, resetChatBootstrapStateForTests } from '@/lib/chat-bootstrap'
import { TurnstileChallengeContext, type TurnstileChallengeValue } from '@/lib/turnstile'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { UIMessageChunk } from 'ai'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { createMockFetch } from '../../test-utils/create-mock-fetch'

const CHAT_MESSAGES_STORAGE_KEY = 'resume-chat-messages'

// ---------------------------------------------------------------------------
// Environment: renders the REAL launcher + docked panel tree (portal, lazy
// body, real useChat against a fetch-mocked /api/chat) under happy-dom,
// registered for this file only — same pattern as
// src/components/chat/useResumeChat.integration.test.tsx.
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch
// Keep bun's natives for everything network/stream shaped; happy-dom owns only
// the DOM (its fetch stack is incompatible with bun's TextDecoderStream).
const nativeFetchGlobals = {
  fetch: globalThis.fetch,
  Response: globalThis.Response,
  Request: globalThis.Request,
  Headers: globalThis.Headers,
  ReadableStream: globalThis.ReadableStream,
  WritableStream: globalThis.WritableStream,
  TransformStream: globalThis.TransformStream,
  TextDecoderStream: globalThis.TextDecoderStream,
  TextEncoderStream: globalThis.TextEncoderStream,
  AbortController: globalThis.AbortController,
  AbortSignal: globalThis.AbortSignal,
}
let createRoot: typeof import('react-dom/client').createRoot

beforeAll(async () => {
  GlobalRegistrator.register()
  Object.assign(globalThis, nativeFetchGlobals)
  // Report reduced motion so framer-motion renders end states without
  // scheduling infinite pulse animations that would keep rAF queues busy.
  globalThis.matchMedia = ((query: string) =>
    ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof globalThis.matchMedia
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  ;({ createRoot } = await import('react-dom/client'))
})

afterAll(async () => {
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT
  await GlobalRegistrator.unregister()
  globalThis.fetch = originalFetch
})

// --- fetch router ----------------------------------------------------------

type ResponseFactory = () => Response | Promise<Response>

let chatResponses: ResponseFactory[] = []

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const routerFetch = createMockFetch(async (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

  if (url.endsWith('/api/chat/bootstrap')) {
    return jsonResponse({
      success: true,
      data: { requireTurnstile: false, hasValidChallenge: true, challengeExpiresAt: null },
    })
  }

  if (url.endsWith('/api/chat')) {
    const next = chatResponses.shift()
    if (!next) {
      throw new Error('Unexpected /api/chat request in test')
    }
    return next()
  }

  throw new Error(`Unexpected fetch in test: ${url}`)
}, originalFetch)

// --- controllable SSE stream (same frames toUIMessageStreamResponse emits) --

const encoder = new TextEncoder()

type StreamHandle = {
  push: (chunk: UIMessageChunk) => void
  finish: () => void
}

const streamingChatResponse = (): StreamHandle => {
  let controller: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController
    },
  })
  chatResponses.push(
    () => new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  )
  return {
    push: (chunk) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)),
    finish: () => {
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  }
}

// --- render harness ---------------------------------------------------------

const turnstileValue = {
  requireTurnstile: false,
  isConfigured: true,
  isVerified: true,
  needsChallenge: false,
  error: null,
  requestChallenge: async () => true,
  reportChallengeRejected: () => {},
} as unknown as TurnstileChallengeValue

let root: Root | null = null
let container: HTMLElement | null = null

const mountResumeChat = async () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  const nextRoot = createRoot(container)
  root = nextRoot
  await act(async () => {
    nextRoot.render(
      <TurnstileChallengeContext.Provider value={turnstileValue}>
        <ResumeChat />
      </TurnstileChallengeContext.Provider>
    )
  })
}

const unmountResumeChat = async () => {
  const currentRoot = root
  root = null
  if (currentRoot) {
    await act(async () => {
      currentRoot.unmount()
    })
  }
  container?.remove()
  container = null
}

const waitFor = async (predicate: () => boolean, description: string) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) {
      return
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
  }
  throw new Error(`Timed out waiting for ${description}`)
}

// --- DOM helpers -------------------------------------------------------------

const trigger = (): HTMLButtonElement => {
  const element = document.querySelector<HTMLButtonElement>(
    'button[aria-controls="resume-chat-dialog"]'
  )
  if (!element) {
    throw new Error('Launcher trigger not found')
  }
  return element
}

const panel = (): HTMLElement => {
  const element = document.getElementById('resume-chat-dialog')
  if (!element) {
    throw new Error('Chat panel not found')
  }
  return element
}

const chatInput = (): HTMLTextAreaElement => {
  const element = document.getElementById('resume-chat-input') as HTMLTextAreaElement | null
  if (!element) {
    throw new Error('Chat input not found')
  }
  return element
}

const closeButton = (): HTMLButtonElement => {
  const element = document.querySelector<HTMLButtonElement>('button[aria-label="Close chat"]')
  if (!element) {
    throw new Error('Close button not found')
  }
  return element
}

const clickElement = async (element: HTMLElement) => {
  await act(async () => {
    element.click()
  })
}

const openPanelAndWaitForInput = async () => {
  await clickElement(trigger())
  await waitFor(() => Boolean(document.getElementById('resume-chat-input')), 'chat input to mount')
}

const setChatInputValue = async (text: string) => {
  const input = chatInput()
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  await act(async () => {
    valueSetter?.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const sendChatMessage = async (text: string) => {
  const input = chatInput()
  await setChatInputValue(text)
  const form = input.closest('form')
  if (!form) {
    throw new Error('Chat form not found')
  }
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

const dispatchEscape = async (target: EventTarget) => {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
}

const isPanelOpen = () =>
  trigger().getAttribute('aria-expanded') === 'true' && !panel().hasAttribute('inert')

describe('ResumeChat docked panel', () => {
  beforeEach(async () => {
    chatResponses = []
    window.sessionStorage.clear()
    globalThis.fetch = routerFetch
    resetChatBootstrapStateForTests()
    await ensureChatBootstrapLoaded()
  })

  afterEach(async () => {
    await unmountResumeChat()
    resetChatBootstrapStateForTests()
    globalThis.fetch = originalFetch
  })

  it('reflects panel state on the trigger and moves focus into the panel on open', async () => {
    await mountResumeChat()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')

    await openPanelAndWaitForInput()

    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(panel().getAttribute('aria-modal')).toBeNull()
    expect(panel().getAttribute('role')).toBe('dialog')
    await waitFor(() => panel().contains(document.activeElement), 'focus to enter the panel')
  })

  it('grows the textarea with content, caps at three rows, then scrolls vertically', async () => {
    await mountResumeChat()
    await openPanelAndWaitForInput()

    const input = chatInput()
    expect(input.tagName).toBe('TEXTAREA')
    expect(input.classList.contains('text-base')).toBe(true)
    expect(input.classList.contains('text-sm')).toBe(false)
    expect(input.classList.contains('md:text-base')).toBe(true)
    expect(input.style.height).toBe('44px')

    let scrollHeight = 70
    Object.defineProperty(input, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    })
    await setChatInputValue('A draft long enough to wrap onto another line.')
    expect(input.style.height).toBe('72px')
    expect(input.style.overflowY).toBe('hidden')

    scrollHeight = 130
    await setChatInputValue(`${input.value} More text that wraps beyond three rows.`)
    expect(input.style.height).toBe('96px')
    expect(input.style.overflowY).toBe('auto')
  })

  it('submits on Enter, but preserves Shift+Enter newlines and ignores IME Enter', async () => {
    const stream = streamingChatResponse()
    await mountResumeChat()
    await openPanelAndWaitForInput()

    const input = chatInput()
    await setChatInputValue('First line')

    const shiftedEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    await act(async () => {
      input.dispatchEvent(shiftedEnter)
    })
    expect(shiftedEnter.defaultPrevented).toBe(false)
    await setChatInputValue('First line\nSecond line')
    expect(input.value).toBe('First line\nSecond line')
    expect(chatResponses).toHaveLength(1)

    const composingEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    })
    await act(async () => {
      input.dispatchEvent(composingEnter)
    })
    expect(composingEnter.defaultPrevented).toBe(false)
    expect(chatResponses).toHaveLength(1)

    const legacyComposingEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(legacyComposingEnter, 'keyCode', { value: 229 })
    await act(async () => {
      input.dispatchEvent(legacyComposingEnter)
    })
    expect(legacyComposingEnter.defaultPrevented).toBe(false)
    expect(chatResponses).toHaveLength(1)

    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    await act(async () => {
      input.dispatchEvent(enter)
    })
    expect(enter.defaultPrevented).toBe(true)
    await waitFor(() => chatResponses.length === 0, 'Enter to submit the chat form')
    expect(input.value).toBe('')

    await act(async () => {
      stream.finish()
    })
  })

  it('hides without unmounting: an in-flight stream keeps streaming and no message is dropped or duplicated', async () => {
    const stream = streamingChatResponse()
    await mountResumeChat()
    await openPanelAndWaitForInput()

    await sendChatMessage('hi')
    await act(async () => {
      stream.push({ type: 'start', messageId: 'msg-a1' })
      stream.push({ type: 'start-step' })
      stream.push({ type: 'text-start', id: 'text-1' })
      stream.push({ type: 'text-delta', id: 'text-1', delta: 'Hello' })
    })
    await waitFor(() => panel().textContent?.includes('Hello') === true, 'first chunk to render')

    const panelNode = panel()
    const inputNode = chatInput()

    await clickElement(closeButton())
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(panel().hasAttribute('inert')).toBe(true)
    // Focus returned to the trigger on close-from-within.
    expect(document.activeElement).toBe(trigger())
    // Hiding is not an unmount: the unmount flush did not run (nothing was
    // persisted for the still-streaming turn) and the panel is still in the DOM.
    expect(window.sessionStorage.getItem(CHAT_MESSAGES_STORAGE_KEY)).toBeNull()
    expect(document.getElementById('resume-chat-dialog')).toBe(panelNode)

    // The stream keeps arriving while hidden.
    await act(async () => {
      stream.push({ type: 'text-delta', id: 'text-1', delta: ' from the assistant' })
    })
    await waitFor(
      () => panel().textContent?.includes('Hello from the assistant') === true,
      'hidden chunk to render'
    )

    // Reopen: same nodes (no remount), full text retained.
    await clickElement(trigger())
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(panel().hasAttribute('inert')).toBe(false)
    expect(document.getElementById('resume-chat-dialog')).toBe(panelNode)
    expect(chatInput()).toBe(inputNode)
    expect(panel().textContent).toContain('Hello from the assistant')

    // The same request completes after the hide/show round trip.
    await act(async () => {
      stream.push({ type: 'text-end', id: 'text-1' })
      stream.push({ type: 'finish-step' })
      stream.push({ type: 'finish' })
      stream.finish()
    })
    await waitFor(
      () => window.sessionStorage.getItem(CHAT_MESSAGES_STORAGE_KEY) !== null,
      'the settled turn to persist'
    )
    const stored = JSON.parse(
      window.sessionStorage.getItem(CHAT_MESSAGES_STORAGE_KEY) ?? '[]'
    ) as Array<{ role: string }>
    expect(stored).toHaveLength(2)
    expect(stored[1]?.role).toBe('assistant')
  })

  it('shows an unread indicator when a reply arrives while hidden and clears it on open', async () => {
    const stream = streamingChatResponse()
    await mountResumeChat()
    await openPanelAndWaitForInput()

    await sendChatMessage('hi')
    await act(async () => {
      stream.push({ type: 'start', messageId: 'msg-a2' })
      stream.push({ type: 'start-step' })
      stream.push({ type: 'text-start', id: 'text-1' })
    })

    await clickElement(closeButton())
    expect(trigger().getAttribute('aria-label')).toBe('Open portfolio AI chat')

    await act(async () => {
      stream.push({ type: 'text-delta', id: 'text-1', delta: 'Reply while hidden' })
    })
    await waitFor(
      () => trigger().getAttribute('aria-label') === 'Open portfolio AI chat (new reply)',
      'unread indicator to appear'
    )

    await clickElement(trigger())
    // Cleared on open; while open the trigger's action (and name) is "focus".
    expect(trigger().getAttribute('aria-label')).toBe('Focus portfolio AI chat')

    await act(async () => {
      stream.push({ type: 'text-end', id: 'text-1' })
      stream.push({ type: 'finish-step' })
      stream.push({ type: 'finish' })
      stream.finish()
    })
  })

  it('closes on Escape only while focus is within the panel and returns focus to the trigger', async () => {
    await mountResumeChat()
    await openPanelAndWaitForInput()

    await act(async () => {
      chatInput().focus()
    })
    await dispatchEscape(chatInput())
    await waitFor(() => !isPanelOpen(), 'Escape from within to close the panel')
    expect(document.activeElement).toBe(trigger())

    await openPanelAndWaitForInput()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    await act(async () => {
      outside.focus()
    })
    await dispatchEscape(outside)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(isPanelOpen()).toBe(true)
    outside.remove()
  })

  it('does not close on outside interaction and the page stays clickable', async () => {
    await mountResumeChat()
    await openPanelAndWaitForInput()

    let outsideClicks = 0
    const outside = document.createElement('button')
    outside.addEventListener('click', () => {
      outsideClicks += 1
    })
    document.body.appendChild(outside)

    await clickElement(outside)

    expect(outsideClicks).toBe(1)
    expect(isPanelOpen()).toBe(true)
    outside.remove()
  })
})
