/* eslint-disable import/no-unresolved */
import { ensureChatBootstrapLoaded, resetChatBootstrapStateForTests } from '@/lib/chat-bootstrap'
import { TurnstileChallengeContext, type TurnstileChallengeValue } from '@/lib/turnstile'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { CHAT_TOOL_NAME } from '@shared/chat-tools'
import type { UIMessageChunk } from 'ai'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { createMockFetch } from '../../../test-utils/create-mock-fetch'
import type { ChatToolPart } from './chat-message-utils'
import { getToolParts } from './chat-message-utils'
import { useResumeChat } from './useResumeChat'

const CHAT_MESSAGES_STORAGE_KEY = 'resume-chat-messages'

// ---------------------------------------------------------------------------
// Environment: these tests run the REAL useChat + DefaultChatTransport against
// a fetch-mocked /api/chat (UIMessage SSE frames, the exact wire shape
// worker/routes/chat-routes.ts streams) and /api/contact-handoff. That needs a
// live React renderer with effects, so happy-dom is registered for this file
// only and unregistered afterwards (bun runs all test files in one process).
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch
// happy-dom's fetch stack (Response/ReadableStream/...) is incompatible with
// bun's native TextDecoderStream, which the AI SDK's SSE parser pipes through
// ("readable should be ReadableStream"). Keep bun's natives for everything
// network/stream shaped and let happy-dom own only the DOM.
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
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  // react-dom/client must be imported after the DOM globals exist.
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

let fetchLog: Array<{ url: string; init?: RequestInit }> = []
let chatResponses: ResponseFactory[] = []
let handoffResponses: ResponseFactory[] = []

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

const bootstrapResponse = () =>
  jsonResponse({
    success: true,
    data: { requireTurnstile: false, hasValidChallenge: true, challengeExpiresAt: null },
  })

const routerFetch = createMockFetch(async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  fetchLog.push({ url, init: init ?? undefined })

  if (url.endsWith('/api/chat/bootstrap')) {
    return bootstrapResponse()
  }

  if (url.endsWith('/api/contact-handoff')) {
    const next = handoffResponses.shift()
    if (!next) {
      throw new Error('Unexpected /api/contact-handoff request in test')
    }
    return next()
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

const chatPostCount = () => fetchLog.filter((call) => call.url.endsWith('/api/chat')).length

const readChatPostBody = (index: number): { messages: unknown[] } => {
  const calls = fetchLog.filter((call) => call.url.endsWith('/api/chat'))
  const call = calls[index]
  if (!call?.init?.body) {
    throw new Error(`No /api/chat POST at index ${index}`)
  }
  return JSON.parse(String(call.init.body)) as { messages: unknown[] }
}

// --- SSE stream builders (same frames toUIMessageStreamResponse emits) ------

const sseResponse = (chunks: UIMessageChunk[]) =>
  new Response(
    [...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), 'data: [DONE]\n\n'].join(''),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  )

// The step markers are load-bearing: real streamText responses wrap each step
// in start-step/finish-step, and lastAssistantMessageIsCompleteWithToolCalls
// only looks at tool parts after the LAST step start — without them, a
// continuation reply would immediately re-trigger another auto-send.
const textReplyChunks = (messageId: string, text: string): UIMessageChunk[] => [
  { type: 'start', messageId },
  { type: 'start-step' },
  { type: 'text-start', id: 'text-1' },
  { type: 'text-delta', id: 'text-1', delta: text },
  { type: 'text-end', id: 'text-1' },
  { type: 'finish-step' },
  { type: 'finish' },
]

const contactFormChunks = (messageId: string, toolCallId: string): UIMessageChunk[] => [
  { type: 'start', messageId },
  { type: 'start-step' },
  {
    type: 'tool-input-available',
    toolCallId,
    toolName: CHAT_TOOL_NAME.showContactForm,
    input: {},
  },
  { type: 'finish-step' },
  { type: 'finish' },
]

// --- render harness ---------------------------------------------------------

let reportChallengeRejectedMock = mock(() => {})

const buildTurnstileValue = (): TurnstileChallengeValue =>
  ({
    requireTurnstile: false,
    isConfigured: true,
    isVerified: true,
    needsChallenge: false,
    error: null,
    requestChallenge: async () => true,
    reportChallengeRejected: reportChallengeRejectedMock,
  }) as unknown as TurnstileChallengeValue

type LatestHookResult = ReturnType<typeof useResumeChat>

let latestHookResult: LatestHookResult | null = null
let root: Root | null = null
let container: HTMLElement | null = null

function HookHarness({ enabled }: { enabled: boolean }) {
  latestHookResult = useResumeChat(enabled)
  return null
}

const hook = (): LatestHookResult => {
  if (!latestHookResult) {
    throw new Error('Hook harness has not rendered yet')
  }
  return latestHookResult
}

const mountHarness = async () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  const nextRoot = createRoot(container)
  root = nextRoot
  await act(async () => {
    nextRoot.render(
      <TurnstileChallengeContext.Provider value={buildTurnstileValue()}>
        <HookHarness enabled />
      </TurnstileChallengeContext.Provider>
    )
  })
}

const rerenderHarness = async (enabled: boolean) => {
  const currentRoot = root
  if (!currentRoot) {
    throw new Error('Harness is not mounted')
  }
  await act(async () => {
    currentRoot.render(
      <TurnstileChallengeContext.Provider value={buildTurnstileValue()}>
        <HookHarness enabled={enabled} />
      </TurnstileChallengeContext.Provider>
    )
  })
}

const unmountHarness = async () => {
  const currentRoot = root
  root = null
  if (currentRoot) {
    await act(async () => {
      currentRoot.unmount()
    })
  }
  container?.remove()
  container = null
  latestHookResult = null
}

// The auto-continuation after addToolOutput is detached (fire-and-forget inside
// the Chat), so completion is observed by polling instead of awaiting a call.
const waitFor = async (predicate: () => boolean, description: string) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
  }
  throw new Error(`Timed out waiting for ${description}`)
}

const sendUserMessage = async (text: string) => {
  await act(async () => {
    hook().setDraftInput(text)
  })
  await act(async () => {
    await hook().sendDraft()
  })
  await waitFor(() => !hook().isLoading, `send of "${text}" to settle`)
}

const openContactForm = async (toolCallId: string): Promise<ChatToolPart> => {
  chatResponses.push(() => sseResponse(contactFormChunks('msg-assistant-form', toolCallId)))
  await sendUserMessage('I want to get in touch')

  const lastMessage = hook().messages[hook().messages.length - 1]
  const toolPart = getToolParts(lastMessage).find((part) => part.toolCallId === toolCallId)
  if (!toolPart) {
    throw new Error('Expected an open contact form tool part')
  }
  expect(toolPart.state).toBe('input-available')
  return toolPart
}

const fillContactForm = async (toolCallId: string) => {
  await act(async () => {
    hook().setContactHandoffInput(toolCallId, 'contactName', 'Jane Recruiter')
    hook().setContactHandoffInput(toolCallId, 'contactPhone', '(604) 555-1234')
    hook().setContactHandoffInput(toolCallId, 'contactMessage', 'Please call me.')
  })
}

const findToolPart = (toolCallId: string): ChatToolPart | undefined =>
  hook()
    .messages.flatMap((message) => getToolParts(message))
    .find((part) => part.toolCallId === toolCallId)

const SENT_HANDOFF_DATA = {
  contactName: 'Jane Recruiter',
  contactPhone: '+16045551234',
  contactMessage: 'Please call me.',
  answeredAt: '2026-07-10T00:00:00.000Z',
  status: 'sent',
  detail: 'Text sent successfully.',
  preview: 'Please call me.',
  sid: 'SM123',
}

describe('useResumeChat over HTTP', () => {
  beforeEach(async () => {
    fetchLog = []
    chatResponses = []
    handoffResponses = []
    reportChallengeRejectedMock = mock(() => {})
    window.sessionStorage.clear()
    globalThis.fetch = routerFetch
    resetChatBootstrapStateForTests()
    await ensureChatBootstrapLoaded()
  })

  afterEach(async () => {
    await unmountHarness()
    resetChatBootstrapStateForTests()
    globalThis.fetch = originalFetch
  })

  it('sends a message and streams the assistant reply', async () => {
    chatResponses.push(() => sseResponse(textReplyChunks('msg-a1', 'Hello from the assistant!')))
    await mountHarness()

    await sendUserMessage('hi')

    expect(chatPostCount()).toBe(1)
    const body = readChatPostBody(0)
    const lastSent = body.messages[body.messages.length - 1] as {
      role: string
      parts: Array<{ type: string; text?: string }>
    }
    expect(lastSent.role).toBe('user')
    expect(lastSent.parts[0]?.text).toBe('hi')

    expect(hook().messages).toHaveLength(2)
    expect(hook().messages[1]?.role).toBe('assistant')
    expect(JSON.stringify(hook().messages[1]?.parts)).toContain('Hello from the assistant!')
    expect(hook().chatErrored).toBe(false)
  })

  it('resolves a submitted contact form with the endpoint payload and fires the continuation', async () => {
    await mountHarness()
    await openContactForm('call-1')
    await fillContactForm('call-1')

    handoffResponses.push(() => jsonResponse({ success: true, data: SENT_HANDOFF_DATA }))
    chatResponses.push(() => sseResponse(textReplyChunks('msg-a2', 'All sent!')))

    await act(async () => {
      await hook().completeContactHandoff('call-1')
    })
    await waitFor(
      () => chatPostCount() === 2 && !hook().isLoading,
      'the tool continuation POST to settle'
    )

    // The submission POST carries the locally validated fields.
    const handoffCall = fetchLog.find((call) => call.url.endsWith('/api/contact-handoff'))
    const handoffBody = JSON.parse(String(handoffCall?.init?.body)) as Record<string, unknown>
    expect(handoffBody.toolCallId).toBe('call-1')
    expect(handoffBody.contactName).toBe('Jane Recruiter')
    expect(handoffBody.contactPhone).toBe('+16045551234')

    // The tool output is the endpoint's data object, passed through untouched.
    const toolPart = findToolPart('call-1')
    expect(toolPart?.state).toBe('output-available')
    expect(toolPart && 'output' in toolPart ? toolPart.output : undefined).toEqual(
      SENT_HANDOFF_DATA
    )

    // The continuation request carried the resolved tool part.
    expect(JSON.stringify(readChatPostBody(1).messages)).toContain('Text sent successfully.')
    expect(hook().pendingToolContinuations).toEqual({})
  })

  it('keeps the form open on a blocked resolution without resolving the tool or continuing', async () => {
    await mountHarness()
    await openContactForm('call-2')
    await fillContactForm('call-2')

    handoffResponses.push(() =>
      jsonResponse({
        success: true,
        data: {
          contactName: 'Jane Recruiter',
          contactPhone: '(604) 555-1234',
          answeredAt: '2026-07-10T00:00:00.000Z',
          status: 'blocked',
          detail: 'Enter a valid callback phone number for the handoff.',
          preview: '',
        },
      })
    )

    await act(async () => {
      await hook().completeContactHandoff('call-2')
    })

    expect(findToolPart('call-2')?.state).toBe('input-available')
    expect(hook().contactHandoffSubmitNotices['call-2']).toBe(
      'Enter a valid callback phone number for the handoff.'
    )
    expect(hook().pendingToolContinuations).toEqual({})
    // Only the initial form turn hit /api/chat — no continuation.
    expect(chatPostCount()).toBe(1)
  })

  it('keeps the form open and retryable on a 409 in-flight duplicate', async () => {
    await mountHarness()
    await openContactForm('call-3')
    await fillContactForm('call-3')

    handoffResponses.push(() =>
      jsonResponse(
        {
          success: false,
          code: 'HANDOFF_IN_FLIGHT',
          error: 'This contact request is already being sent.',
        },
        409,
        { 'Retry-After': '30' }
      )
    )

    await act(async () => {
      await hook().completeContactHandoff('call-3')
    })

    expect(findToolPart('call-3')?.state).toBe('input-available')
    expect(hook().contactHandoffSubmitNotices['call-3']).toContain('already being sent')
    expect(hook().contactHandoffSubmitNotices['call-3']).toContain('30 seconds')
    // Submit is re-enabled: no pending spinner survives.
    expect(hook().pendingToolContinuations).toEqual({})
    expect(chatPostCount()).toBe(1)

    // The retry actually works: the next submit resolves normally (the server
    // returns the stored resolution for the settled dispatch).
    handoffResponses.push(() => jsonResponse({ success: true, data: SENT_HANDOFF_DATA }))
    chatResponses.push(() => sseResponse(textReplyChunks('msg-retry', 'All sent!')))
    await act(async () => {
      await hook().completeContactHandoff('call-3')
    })
    await waitFor(
      () => chatPostCount() === 2 && !hook().isLoading,
      'the retried handoff continuation to settle'
    )
    expect(findToolPart('call-3')?.state).toBe('output-available')
    expect(hook().contactHandoffSubmitNotices['call-3']).toBeUndefined()
  })

  it("treats a Twilio delivery failure (status 'error') as a terminal resolution and continues", async () => {
    await mountHarness()
    await openContactForm('call-err')
    await fillContactForm('call-err')

    const errorData = {
      contactName: 'Jane Recruiter',
      contactPhone: '+16045551234',
      contactMessage: 'Please call me.',
      answeredAt: '2026-07-10T00:00:00.000Z',
      status: 'error',
      detail: 'The text could not be delivered.',
      preview: 'Please call me.',
    }
    handoffResponses.push(() => jsonResponse({ success: true, data: errorData }))
    chatResponses.push(() => sseResponse(textReplyChunks('msg-a-err', 'That did not go through.')))

    await act(async () => {
      await hook().completeContactHandoff('call-err')
    })
    await waitFor(
      () => chatPostCount() === 2 && !hook().isLoading,
      'the error-resolution continuation to settle'
    )

    const toolPart = findToolPart('call-err')
    expect(toolPart?.state).toBe('output-available')
    expect(toolPart && 'output' in toolPart ? toolPart.output : undefined).toEqual(errorData)
  })

  it('does not auto-send after a server-executed tool ends the reply at the step cap', async () => {
    chatResponses.push(() =>
      sseResponse([
        { type: 'start', messageId: 'msg-weather' },
        { type: 'start-step' },
        {
          type: 'tool-input-available',
          toolCallId: 'call-weather',
          toolName: CHAT_TOOL_NAME.getWeather,
          input: { location: 'Seattle' },
        },
        {
          type: 'tool-output-available',
          toolCallId: 'call-weather',
          output: { temperature: 12.3 },
        },
        { type: 'finish-step' },
        { type: 'finish' },
      ])
    )
    await mountHarness()

    await sendUserMessage('weather in Seattle?')
    // Give a would-be auto-send every chance to fire before asserting.
    await waitFor(() => !hook().isLoading, 'the weather turn to settle')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
    })

    expect(findToolPart('call-weather')?.state).toBe('output-available')
    // Continuation is contact-form-only; a completed get_weather part at the
    // end of the reply must not re-POST the history.
    expect(chatPostCount()).toBe(1)
    expect(hook().chatErrored).toBe(false)
  })

  it('does not re-continue when a weather step ends the merged post-contact reply', async () => {
    await mountHarness()
    await openContactForm('call-8')
    await fillContactForm('call-8')

    handoffResponses.push(() => jsonResponse({ success: true, data: SENT_HANDOFF_DATA }))
    // The continuation reply merges into the SAME assistant message as the
    // resolved contact part; its final step is a completed server-executed
    // weather call with no trailing text (step cap shape).
    chatResponses.push(() =>
      sseResponse([
        { type: 'start', messageId: 'msg-merged' },
        { type: 'start-step' },
        {
          type: 'tool-input-available',
          toolCallId: 'call-weather-2',
          toolName: CHAT_TOOL_NAME.getWeather,
          input: { location: 'Seattle' },
        },
        {
          type: 'tool-output-available',
          toolCallId: 'call-weather-2',
          output: { temperature: 12.3 },
        },
        { type: 'finish-step' },
        { type: 'finish' },
      ])
    )

    await act(async () => {
      await hook().completeContactHandoff('call-8')
    })
    await waitFor(
      () => chatPostCount() === 2 && !hook().isLoading,
      'the merged continuation to settle'
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
    })

    // The resolved contact part from the earlier step must not re-arm the
    // continuation for the later weather step: exactly two POSTs, no loop.
    expect(chatPostCount()).toBe(2)
    expect(findToolPart('call-weather-2')?.state).toBe('output-available')
    expect(hook().chatErrored).toBe(false)
  })

  it('cancels the contact form locally and continues with the cancelled output', async () => {
    await mountHarness()
    await openContactForm('call-4')

    chatResponses.push(() => sseResponse(textReplyChunks('msg-a3', 'No problem.')))

    await act(async () => {
      await hook().cancelContactHandoff('call-4')
    })
    await waitFor(
      () => chatPostCount() === 2 && !hook().isLoading,
      'the cancel continuation POST to settle'
    )

    const toolPart = findToolPart('call-4')
    expect(toolPart?.state).toBe('output-available')
    expect(toolPart && 'output' in toolPart ? toolPart.output : undefined).toEqual({
      cancelled: true,
      detail: 'Contact request cancelled. No text was sent.',
    })
    // Cancel never calls the handoff endpoint.
    expect(fetchLog.some((call) => call.url.endsWith('/api/contact-handoff'))).toBe(false)
  })

  it('blocks sending a chat message past an unresolved contact form', async () => {
    await mountHarness()
    await openContactForm('call-5')

    expect(hook().isAwaitingToolInput).toBe(true)
    await act(async () => {
      hook().setDraftInput('never mind, tell me about your work')
    })
    await act(async () => {
      await hook().sendDraft()
    })

    // No second /api/chat POST: the server would reject the dangling tool call
    // and addToolOutput could never resolve a buried part.
    expect(chatPostCount()).toBe(1)
    expect(hook().draftInput).toBe('never mind, tell me about your work')
  })

  it('persists messages per tab and rehydrates them on the next mount', async () => {
    chatResponses.push(() => sseResponse(textReplyChunks('msg-a4', 'Persisted reply.')))
    await mountHarness()
    await sendUserMessage('remember this')

    const stored = JSON.parse(
      window.sessionStorage.getItem(CHAT_MESSAGES_STORAGE_KEY) ?? 'null'
    ) as Array<{ id: string }>
    expect(stored).toHaveLength(2)

    await unmountHarness()
    await mountHarness()

    expect(hook().messages).toHaveLength(2)
    expect(JSON.stringify(hook().messages[1]?.parts)).toContain('Persisted reply.')
  })

  it('clears messages, local state, and the storage key on Clear', async () => {
    chatResponses.push(() => sseResponse(textReplyChunks('msg-a5', 'Soon gone.')))
    await mountHarness()
    await sendUserMessage('clear me')
    expect(window.sessionStorage.getItem(CHAT_MESSAGES_STORAGE_KEY)).not.toBeNull()

    await act(async () => {
      hook().clearChat()
    })

    expect(hook().messages).toHaveLength(0)
    expect(hook().draftInput).toBe('')
    expect(window.sessionStorage.getItem(CHAT_MESSAGES_STORAGE_KEY)).toBeNull()
    // No server call: clearing is purely local now.
    expect(chatPostCount()).toBe(1)
  })

  it('does not clear while a contact dispatch is in flight', async () => {
    await mountHarness()
    await openContactForm('call-6')
    await fillContactForm('call-6')

    let resolveHandoff: ((response: Response) => void) | undefined
    handoffResponses.push(
      () =>
        new Promise<Response>((resolve) => {
          resolveHandoff = resolve
        })
    )
    chatResponses.push(() => sseResponse(textReplyChunks('msg-a6', 'Sent while you waited.')))

    let submitPromise: Promise<void> | undefined
    await act(async () => {
      submitPromise = hook().completeContactHandoff('call-6')
      await Promise.resolve()
    })
    expect(hook().pendingToolContinuations['call-6']).toBe('handoff-submit')

    await act(async () => {
      hook().clearChat()
    })
    expect(hook().messages.length).toBeGreaterThan(0)

    await act(async () => {
      resolveHandoff?.(jsonResponse({ success: true, data: SENT_HANDOFF_DATA }))
      await submitPromise
    })
    await waitFor(
      () => chatPostCount() === 2 && !hook().isLoading,
      'the deferred handoff continuation to settle'
    )
    expect(findToolPart('call-6')?.state).toBe('output-available')
  })

  it('keeps contact-form drafts and the in-flight dispatch guard across an enabled (hide/show) toggle', async () => {
    await mountHarness()
    await openContactForm('call-hide')
    await fillContactForm('call-hide')

    let resolveHandoff: ((response: Response) => void) | undefined
    handoffResponses.push(
      () =>
        new Promise<Response>((resolve) => {
          resolveHandoff = resolve
        })
    )
    chatResponses.push(() => sseResponse(textReplyChunks('msg-hide', 'Sent while hidden.')))

    let submitPromise: Promise<void> | undefined
    await act(async () => {
      submitPromise = hook().completeContactHandoff('call-hide')
      await Promise.resolve()
    })
    expect(hook().pendingToolContinuations['call-hide']).toBe('handoff-submit')

    // The docked panel hides (enabled=false) and shows again without
    // unmounting: nothing resets — not the form draft, not the in-flight
    // duplicate-submit guard.
    await rerenderHarness(false)
    await rerenderHarness(true)
    expect(hook().contactHandoffInputs['call-hide']?.contactName).toBe('Jane Recruiter')
    expect(hook().pendingToolContinuations['call-hide']).toBe('handoff-submit')

    await act(async () => {
      resolveHandoff?.(jsonResponse({ success: true, data: SENT_HANDOFF_DATA }))
      await submitPromise
    })
    await waitFor(
      () => chatPostCount() === 2 && !hook().isLoading,
      'the hidden handoff continuation to settle'
    )
    expect(findToolPart('call-hide')?.state).toBe('output-available')
  })

  it('re-arms the human check when a send fails with a verification error', async () => {
    chatResponses.push(() =>
      jsonResponse(
        { success: false, code: 'VERIFICATION_REQUIRED', error: 'Verification token is required' },
        403
      )
    )
    await mountHarness()

    await sendUserMessage('hello?')

    expect(hook().chatErrored).toBe(true)
    expect(reportChallengeRejectedMock).toHaveBeenCalled()
    expect(hook().statusMessage).toBe("Security check needed. Verify you're human, then try again.")
    expect(hook().statusTone).toBe('error')
  })
})
