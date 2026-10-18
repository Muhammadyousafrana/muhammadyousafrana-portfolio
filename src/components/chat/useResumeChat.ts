import { useChatBootstrap, type ChatBootstrapState } from '@/lib/chat-bootstrap'
import { chatDebug } from '@/lib/chat-debug'
import { useTurnstileChallenge } from '@/lib/turnstile'
import { useChat } from '@ai-sdk/react'
import {
  CHAT_TOOL_NAME,
  CONTACT_HANDOFF_COMPANY_MAX_LENGTH,
  CONTACT_HANDOFF_NAME_MAX_LENGTH,
  CONTACT_SMS_MAX_LENGTH,
  type ContactHandoffSubmission,
} from '@shared/chat-tools'
import { normalizeContactPhoneInput } from '@shared/contact-handoff'
import type { UIMessage } from 'ai'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import { useEffect, useRef, useState } from 'react'
import { isRecord, readString } from './chat-message-utils'
import { EMPTY_CONTACT_HANDOFF_FORM } from './contact-flow'

type ChatStatusTone = 'info' | 'error'
export type PendingToolContinuationAction = 'handoff-submit' | 'handoff-cancel'
type PendingToolContinuationMap = Record<string, PendingToolContinuationAction>
type ContactHandoffField = 'contactName' | 'contactPhone' | 'contactCompany' | 'contactMessage'
export type ContactHandoffFormState = Record<ContactHandoffField, string>
export type ContactHandoffFormErrors = Partial<Record<ContactHandoffField, string>>
type ContactHandoffInputMap = Record<string, ContactHandoffFormState>
type ContactHandoffInputErrorMap = Record<string, ContactHandoffFormErrors>
type ContactHandoffSubmitNoticeMap = Record<string, string>

const CHAT_API_ROUTE = '/api/chat'
const CONTACT_HANDOFF_API_ROUTE = '/api/contact-handoff'
// Per-tab reload durability the Durable Object session used to provide. Capped
// to whole messages, matching the server's CHAT_HISTORY_MESSAGE_LIMIT window in
// worker/routes/chat-routes.ts.
const CHAT_MESSAGES_STORAGE_KEY = 'resume-chat-messages'
const STORED_MESSAGE_LIMIT = 100

const BOOTSTRAP_ERROR_MESSAGE = 'Unable to start the chat. Please try again.'
const TURNSTILE_CONFIG_ERROR_MESSAGE =
  'Chat security is enabled, but this build is missing the Turnstile site key.'
const SEND_ERROR_FALLBACK_MESSAGE = 'Unable to send your message. Please try again.'
const HANDOFF_ERROR_FALLBACK_MESSAGE = 'Unable to send the contact request. Please try again.'
// Error strings the chat routes actually return (see worker/routes/chat-routes.ts
// and worker/security.ts). The transport surfaces a failed response's raw JSON
// body as the error message, so substring matching still applies.
const SEND_ERROR_MESSAGES: Array<[string, string]> = [
  ['Verification token is required', "Security check needed. Verify you're human, then try again."],
  ['Verification failed', 'Security verification failed. Please try again.'],
  [
    'Verification gate is enabled but not configured',
    'Chat security is unavailable right now. Please try again later.',
  ],
  [
    'Rate limit exceeded',
    "You're sending messages too quickly. Wait a few seconds, then press Send again.",
  ],
  ['Request body is too large', 'That message is too large to send.'],
  ['invalid tool state', 'This chat contains invalid tool state. Clear the chat and try again.'],
  ['AI integration is not configured', 'Chat is unavailable right now. Please try again later.'],
  // Streamed generation failures arrive with the route's already-friendly
  // onError copy; pass it through instead of flattening to the generic fallback.
  [
    'The AI service is temporarily unavailable',
    'The AI service is temporarily unavailable. Please try again shortly.',
  ],
  [
    'Something went wrong generating a reply',
    'Something went wrong generating a reply. Please try again.',
  ],
]

const readErrorMessage = (error: unknown): string | null => {
  if (error instanceof Error) {
    const message = error.message.trim()
    return message.length > 0 ? message : null
  }

  return null
}

// The transport is stateless (it reads globalThis.fetch per request), so one
// module-level instance serves every mount. Same-origin fetch carries the
// tenant + Turnstile-lease cookies automatically; no extra headers.
const chatTransport = new DefaultChatTransport<UIMessage>({ api: CHAT_API_ROUTE })

const isStorableChatMessage = (value: unknown): value is UIMessage =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  (value.role === 'user' || value.role === 'assistant') &&
  Array.isArray(value.parts) &&
  // Every part must at least be a typed record: a crafted/corrupted entry like
  // parts: [null] would otherwise crash the part scans on every mount.
  value.parts.every((part) => isRecord(part) && typeof part.type === 'string')

const readStoredChatMessages = (): UIMessage[] => {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.sessionStorage.getItem(CHAT_MESSAGES_STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isStorableChatMessage) : []
  } catch {
    // Corrupted payload or storage access issues: start the tab fresh.
    return []
  }
}

// A tool part still streaming its input has an incomplete input payload that
// the server would reject on resubmission; drop it (and a message left empty)
// from any persisted snapshot. Complete parts and partial text restore fine.
const sanitizeMessagesForStorage = (messages: UIMessage[]): UIMessage[] =>
  messages
    .map((message) => ({
      ...message,
      parts: message.parts.filter((part) => !('state' in part && part.state === 'input-streaming')),
    }))
    .filter((message) => message.parts.length > 0)

const persistChatMessages = (messages: UIMessage[]): void => {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const storable = sanitizeMessagesForStorage(messages)
    if (storable.length === 0) {
      window.sessionStorage.removeItem(CHAT_MESSAGES_STORAGE_KEY)
    } else {
      window.sessionStorage.setItem(
        CHAT_MESSAGES_STORAGE_KEY,
        JSON.stringify(storable.slice(-STORED_MESSAGE_LIMIT))
      )
    }
  } catch {
    // Storage quota or access issues: the chat keeps working in memory only.
  }
}

const removeStoredChatMessages = (): void => {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage.removeItem(CHAT_MESSAGES_STORAGE_KEY)
  } catch {
    // Ignore storage access issues; the in-memory state is already cleared.
  }
}

// Auto-continuation is for the client-resolved contact tool ONLY. The base
// helper alone would also fire when a server-executed tool (get_weather) lands
// as the final part of a reply that hit the server's step cap — re-POSTing
// the history and potentially looping until rate limiting. Scoped to the LAST
// step's parts (mirroring the base helper) because continuation replies merge
// into the same assistant message: an already-resolved contact part from an
// earlier step must not re-arm the continuation for a later weather step.
const shouldContinueAfterContactResolution = ({ messages }: { messages: UIMessage[] }): boolean => {
  if (!lastAssistantMessageIsCompleteWithToolCalls({ messages })) {
    return false
  }

  const parts = messages[messages.length - 1]?.parts ?? []
  const lastStepStartIndex = parts.reduce(
    (lastIndex, part, index) => (part.type === 'step-start' ? index : lastIndex),
    -1
  )
  return parts
    .slice(lastStepStartIndex + 1)
    .some((part) => part.type === `tool-${CHAT_TOOL_NAME.showContactForm}`)
}

const createEmptyContactHandoffForm = (): ContactHandoffFormState => ({
  ...EMPTY_CONTACT_HANDOFF_FORM,
})

export const validateContactHandoffInput = (
  formState: ContactHandoffFormState,
  answeredAt = new Date().toISOString()
): { output?: ContactHandoffSubmission; errors?: ContactHandoffFormErrors } => {
  const contactName = formState.contactName.trim()
  const contactPhoneRaw = formState.contactPhone.trim()
  const contactCompany = formState.contactCompany.trim()
  const contactMessage = formState.contactMessage.trim()
  const errors: ContactHandoffFormErrors = {}

  if (!contactName) {
    errors.contactName = 'Name is required.'
  } else if (contactName.length > CONTACT_HANDOFF_NAME_MAX_LENGTH) {
    errors.contactName = `Keep the name under ${CONTACT_HANDOFF_NAME_MAX_LENGTH} characters.`
  }

  const normalizedPhone = normalizeContactPhoneInput(contactPhoneRaw)
  if (!contactPhoneRaw) {
    errors.contactPhone = 'Phone number is required.'
  } else if (!normalizedPhone) {
    errors.contactPhone = 'Enter a valid callback phone number.'
  }

  if (contactCompany.length > CONTACT_HANDOFF_COMPANY_MAX_LENGTH) {
    errors.contactCompany = `Keep the company name under ${CONTACT_HANDOFF_COMPANY_MAX_LENGTH} characters.`
  }

  if (contactMessage.length > CONTACT_SMS_MAX_LENGTH) {
    errors.contactMessage = `Keep the message under ${CONTACT_SMS_MAX_LENGTH} characters.`
  }

  if (Object.keys(errors).length > 0 || !normalizedPhone) {
    return { errors }
  }

  return {
    output: {
      contactName,
      contactPhone: normalizedPhone,
      ...(contactCompany ? { contactCompany } : {}),
      ...(contactMessage ? { contactMessage } : {}),
      answeredAt,
    },
  }
}

const formatSendError = (error: unknown, fallback = SEND_ERROR_FALLBACK_MESSAGE): string => {
  const message = readErrorMessage(error)
  if (!message) {
    return fallback
  }

  const normalizedMessage = message.toLowerCase()
  for (const [match, friendlyMessage] of SEND_ERROR_MESSAGES) {
    if (normalizedMessage.includes(match.toLowerCase())) {
      return friendlyMessage
    }
  }

  return fallback
}

const isVerificationFlavored = (message: string | null | undefined): boolean => {
  const normalized = message?.toLowerCase() ?? ''
  return normalized.includes('verification') || normalized.includes('turnstile')
}

export const collectPendingToolContinuationIds = (messages: UIMessage[]): Set<string> => {
  const pendingToolCallIds = new Set<string>()

  for (const message of messages) {
    for (const part of message.parts) {
      if (
        !('toolCallId' in part) ||
        typeof part.toolCallId !== 'string' ||
        !('state' in part) ||
        typeof part.state !== 'string'
      ) {
        continue
      }

      if (part.state === 'input-available') {
        pendingToolCallIds.add(part.toolCallId)
      }
    }
  }

  return pendingToolCallIds
}

export function useResumeChat(enabled: boolean) {
  const [draftInput, setDraftInput] = useState('')
  const [contactHandoffInputs, setContactHandoffInputs] = useState<ContactHandoffInputMap>({})
  const [contactHandoffInputErrors, setContactHandoffInputErrors] =
    useState<ContactHandoffInputErrorMap>({})
  const [contactHandoffSubmitNotices, setContactHandoffSubmitNotices] =
    useState<ContactHandoffSubmitNoticeMap>({})
  const [pendingToolContinuations, setPendingToolContinuations] =
    useState<PendingToolContinuationMap>({})
  const [sendError, setSendError] = useState<string | null>(null)
  // Read once on mount: useChat only consumes initial messages at construction.
  const [initialMessages] = useState(readStoredChatMessages)
  const { status: sharedBootstrapState, retry: retrySharedBootstrap } = useChatBootstrap(enabled)
  const chatBootstrapState: ChatBootstrapState = enabled ? sharedBootstrapState : 'idle'
  const bootstrapError = enabled && chatBootstrapState === 'error' ? BOOTSTRAP_ERROR_MESSAGE : null
  const {
    requireTurnstile: challengeRequired,
    isConfigured: isTurnstileConfigured,
    isVerified: isChallengeVerified,
    needsChallenge,
    error: challengeError,
    requestChallenge,
    reportChallengeRejected,
  } = useTurnstileChallenge()
  const requireTurnstile = enabled && challengeRequired

  // Deliberately NO reset when `enabled` flips false: the docked panel hides
  // without unmounting, and hiding is not a reset — contact-form drafts, the
  // pendingToolContinuations duplicate-submit/Clear guard, and surfaced errors
  // must all survive hide/show. Page navigation unmounts the hook and wipes
  // this state naturally.

  // Surface the shared managed-widget prompt as soon as an open chat needs a
  // lease. This also re-arms the challenge after reportChallengeRejected flips
  // needsChallenge back on (e.g. a 403 on send or contact submit).
  useEffect(() => {
    if (enabled && chatBootstrapState === 'ready' && needsChallenge) {
      chatDebug('chat', 'requesting challenge on open')
      void requestChallenge()
    }
  }, [enabled, chatBootstrapState, needsChallenge, requestChallenge])

  const turnstileConfigError =
    enabled && chatBootstrapState === 'ready' && requireTurnstile && !isTurnstileConfigured
      ? TURNSTILE_CONFIG_ERROR_MESSAGE
      : null
  const isSecurityPending = requireTurnstile && isTurnstileConfigured && !isChallengeVerified
  // The Turnstile widget's own failure ("Security verification failed.") belongs
  // in the disabled input as a red alert. Scope it to challengeError, not the
  // broad status chain: needsChallenge can flip true on a bare lease-timer expiry
  // with no verification error, and a stale send/stream error still in the chain
  // must not be reclassified as a verify error (it stays in the strip).
  const challengeErrorMessage = isSecurityPending ? challengeError : null
  // The lease rides the same-origin request as a cookie, so a send carries no
  // per-attempt token; the input just stays gated until the lease is held.
  const isChatReady =
    enabled &&
    chatBootstrapState === 'ready' &&
    !turnstileConfigError &&
    (!requireTurnstile || isChallengeVerified)

  const { messages, sendMessage, addToolOutput, setMessages, status, error, clearError } = useChat({
    transport: chatTransport,
    messages: initialMessages,
    // After a contact form resolves via addToolOutput, resubmit the history so
    // the model narrates the outcome (the HTTP replacement for the DO's
    // server-side continuation).
    sendAutomaticallyWhen: shouldContinueAfterContactResolution,
  })

  const isLoading = status === 'submitted' || status === 'streaming'
  // Every request failure funnels here: sendMessage never rejects — admission
  // rejects (403/413/429), network failures, and streamed generation errors all
  // land in status === 'error' with the failure text on `error`. Map it to a
  // visible message and use it to stop the "drafting" spinner on the assistant
  // turn that never completed.
  const chatErrored = status === 'error'
  const streamErrorMessage = chatErrored ? formatSendError(error) : null
  // A user message must not be sent past an unresolved contact form: the server
  // rejects dangling tool calls, and addToolOutput can only resolve parts on the
  // last message — sending past the form would strand it permanently.
  const isAwaitingToolInput = collectPendingToolContinuationIds(messages).size > 0

  // A lease expiry arrives as a 403 on the failed request; drop the local lease
  // so the challenge-on-open effect above re-prompts before the next turn.
  useEffect(() => {
    if (!chatErrored) {
      return
    }

    if (isVerificationFlavored(readErrorMessage(error))) {
      reportChallengeRejected()
    }
  }, [chatErrored, error, reportChallengeRejected])

  // Reload-restore persistence. Skipped while a response is in flight so it is
  // not re-serializing the history on every streamed chunk; the final state
  // persists when status settles back to ready/error.
  useEffect(() => {
    if (isLoading) {
      return
    }

    persistChatMessages(messages)
  }, [messages, isLoading])

  // Hiding the panel no longer unmounts this hook — only a real unmount (page
  // navigation) does, which would otherwise drop an in-progress exchange from
  // storage entirely. Flush a sanitized snapshot on unmount so at least the
  // turn-so-far survives; an in-flight contact dispatch stays safe to resubmit
  // thanks to the server's toolCallId idempotency.
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  useEffect(
    () => () => {
      persistChatMessages(messagesRef.current)
    },
    []
  )

  const statusMessage =
    bootstrapError ??
    turnstileConfigError ??
    sendError ??
    streamErrorMessage ??
    challengeError ??
    // The verify prompt is surfaced by the centered widget block + the disabled
    // input placeholder, so the status strip stays silent during the challenge.
    (enabled && chatBootstrapState === 'loading' ? 'Preparing secure chat...' : null)
  const statusTone: ChatStatusTone =
    bootstrapError || turnstileConfigError || sendError || streamErrorMessage || challengeError
      ? 'error'
      : 'info'
  const canRetryBootstrap = chatBootstrapState === 'error' && !turnstileConfigError

  useEffect(() => {
    const pendingToolCallIds = collectPendingToolContinuationIds(messages)

    const pruneByPendingIds = <TValue>(prev: Record<string, TValue>): Record<string, TValue> => {
      const entries = Object.entries(prev)
      if (entries.length === 0) {
        return prev
      }

      let changed = false
      const next: Record<string, TValue> = {}
      for (const [toolCallId, value] of entries) {
        if (!pendingToolCallIds.has(toolCallId)) {
          changed = true
          continue
        }

        next[toolCallId] = value
      }

      return changed ? next : prev
    }

    setPendingToolContinuations(pruneByPendingIds)
    setContactHandoffInputs(pruneByPendingIds)
    setContactHandoffInputErrors(pruneByPendingIds)
    setContactHandoffSubmitNotices(pruneByPendingIds)
  }, [messages])

  const resetLocalChatState = () => {
    setContactHandoffInputs({})
    setContactHandoffInputErrors({})
    setContactHandoffSubmitNotices({})
    setPendingToolContinuations({})
    setDraftInput('')
    setSendError(null)
  }

  const hasPendingHandoffAction = Object.keys(pendingToolContinuations).length > 0

  const clearChat = () => {
    // Blocked while a contact dispatch is in flight: wiping the history then
    // would orphan the SMS resolution with no tool call left to attach it to.
    if (isLoading || hasPendingHandoffAction) {
      return
    }

    setMessages([])
    removeStoredChatMessages()
    // setMessages([]) leaves the chat status at 'error' after a failed request,
    // so the surfaced error strip would linger. Reset it.
    clearError()
    resetLocalChatState()
  }

  const sendDraft = async () => {
    const nextInput = draftInput.trim()
    if (!nextInput || isLoading || !isChatReady || isAwaitingToolInput) {
      return
    }

    setDraftInput('')
    setSendError(null)
    clearError()

    // Failures do not reject; they surface via status === 'error' above.
    await sendMessage({ text: nextInput })
  }

  const retryBootstrap = () => {
    if (!enabled || chatBootstrapState === 'loading') {
      return
    }

    setSendError(null)
    void retrySharedBootstrap().catch(() => {})
  }

  const updateDraftInput = (value: string) => {
    if (sendError) {
      setSendError(null)
    }
    // Dismiss a surfaced request error the moment the user starts a new draft,
    // matching the local sendError UX.
    if (chatErrored) {
      clearError()
    }

    setDraftInput(value)
  }

  const clearPendingToolContinuation = (toolCallId: string) => {
    setPendingToolContinuations((prev) => {
      if (!prev[toolCallId]) {
        return prev
      }

      const next = { ...prev }
      delete next[toolCallId]
      return next
    })
  }

  const setContactHandoffSubmitNotice = (toolCallId: string, notice: string) => {
    setContactHandoffSubmitNotices((prev) => ({ ...prev, [toolCallId]: notice }))
  }

  const clearContactHandoffSubmitNotice = (toolCallId: string) => {
    setContactHandoffSubmitNotices((prev) => {
      if (!prev[toolCallId]) {
        return prev
      }

      const next = { ...prev }
      delete next[toolCallId]
      return next
    })
  }

  const setContactHandoffInput = (
    toolCallId: string,
    field: ContactHandoffField,
    value: string
  ) => {
    setContactHandoffInputErrors((prev) => {
      const existing = prev[toolCallId]
      if (!existing || !(field in existing)) {
        return prev
      }

      const next = { ...prev }
      const nextErrors = { ...existing }
      delete nextErrors[field]
      if (Object.keys(nextErrors).length === 0) {
        delete next[toolCallId]
      } else {
        next[toolCallId] = nextErrors
      }
      return next
    })
    clearContactHandoffSubmitNotice(toolCallId)

    setContactHandoffInputs((prev) => ({
      ...prev,
      [toolCallId]: {
        ...(prev[toolCallId] ?? createEmptyContactHandoffForm()),
        [field]: value,
      },
    }))
  }

  // Feeds a terminal resolution back as the show_contact_form tool output;
  // sendAutomaticallyWhen then fires the continuation turn. The pending-spinner
  // entry is cleared by the messages effect once the part leaves
  // 'input-available'.
  const resolveContactToolCall = async (toolCallId: string, output: unknown): Promise<void> => {
    try {
      await addToolOutput({
        tool: CHAT_TOOL_NAME.showContactForm,
        toolCallId,
        output,
      })
    } catch (error) {
      clearPendingToolContinuation(toolCallId)
      setSendError(formatSendError(error, HANDOFF_ERROR_FALLBACK_MESSAGE))
    }
  }

  const completeContactHandoff = async (toolCallId: string) => {
    if (pendingToolContinuations[toolCallId]) {
      return
    }

    const formState = contactHandoffInputs[toolCallId] ?? createEmptyContactHandoffForm()
    const validation = validateContactHandoffInput(formState)
    const submittedOutput = validation.output
    if (!submittedOutput) {
      setContactHandoffInputErrors((prev) => ({
        ...prev,
        [toolCallId]: validation.errors ?? {},
      }))
      return
    }

    setPendingToolContinuations((prev) => ({
      ...prev,
      [toolCallId]: 'handoff-submit',
    }))
    clearContactHandoffSubmitNotice(toolCallId)
    setSendError(null)
    setContactHandoffInputs((prev) => ({
      ...prev,
      [toolCallId]: {
        ...formState,
        contactName: submittedOutput.contactName,
        contactPhone: submittedOutput.contactPhone,
        contactCompany: submittedOutput.contactCompany ?? '',
        contactMessage: submittedOutput.contactMessage ?? '',
      },
    }))

    let response: Response
    try {
      response = await fetch(CONTACT_HANDOFF_API_ROUTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolCallId, ...submittedOutput }),
      })
    } catch {
      clearPendingToolContinuation(toolCallId)
      setSendError(HANDOFF_ERROR_FALLBACK_MESSAGE)
      return
    }

    const payload: unknown = await response.json().catch(() => null)

    if (!response.ok) {
      clearPendingToolContinuation(toolCallId)
      const errorText = isRecord(payload) ? readString(payload.error) : undefined

      // The dispatch idempotency claim is still held (another submit of this
      // toolCallId is running). It self-expires (Retry-After), so keep the form
      // open with a wait hint instead of surfacing a failure.
      if (response.status === 409 && isRecord(payload) && payload.code === 'HANDOFF_IN_FLIGHT') {
        const retryAfterSeconds = Number.parseInt(response.headers.get('Retry-After') ?? '', 10)
        const waitSeconds = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 30
        setContactHandoffSubmitNotice(
          toolCallId,
          `This contact request is already being sent. Give it about ${waitSeconds} seconds, then submit again.`
        )
        return
      }

      if (response.status === 403 && isVerificationFlavored(errorText)) {
        // Drop the local lease; the challenge-on-open effect re-prompts and the
        // still-open form can be resubmitted after verifying.
        reportChallengeRejected()
      }

      setSendError(formatSendError(new Error(errorText ?? ''), HANDOFF_ERROR_FALLBACK_MESSAGE))
      return
    }

    const data =
      isRecord(payload) && payload.success === true && isRecord(payload.data) ? payload.data : null
    if (!data) {
      clearPendingToolContinuation(toolCallId)
      setSendError(HANDOFF_ERROR_FALLBACK_MESSAGE)
      return
    }

    // A blocked validation is a resolution of the submission, not of the tool
    // call: the payload cannot satisfy the resolved-output schema, so the form
    // stays open with the server's detail inline and no continuation fires.
    if (data.status === 'blocked') {
      clearPendingToolContinuation(toolCallId)
      setContactHandoffSubmitNotice(
        toolCallId,
        readString(data.detail) ??
          'The contact request was blocked. Check the details and try again.'
      )
      return
    }

    // sent | simulated | error are all terminal resolutions the model narrates
    // ('error' means Twilio failed — same as the old DO behavior). Pass the
    // endpoint payload through untouched.
    await resolveContactToolCall(toolCallId, data)
  }

  const cancelContactHandoff = async (toolCallId: string): Promise<void> => {
    if (pendingToolContinuations[toolCallId]) {
      return
    }

    setPendingToolContinuations((prev) => ({
      ...prev,
      [toolCallId]: 'handoff-cancel',
    }))

    // No endpoint call: cancellation resolves the tool locally and lets the
    // continuation narrate it.
    await resolveContactToolCall(toolCallId, {
      cancelled: true,
      detail: 'Contact request cancelled. No text was sent.',
    })
  }

  return {
    contactHandoffInputs,
    contactHandoffInputErrors,
    contactHandoffSubmitNotices,
    clearChat,
    cancelContactHandoff,
    challengeErrorMessage,
    chatErrored,
    completeContactHandoff,
    draftInput,
    isAwaitingToolInput,
    isChatReady,
    isLoading,
    messages,
    needsChallenge: isSecurityPending,
    pendingToolContinuations,
    canRetryBootstrap,
    retryBootstrap,
    sendDraft,
    setContactHandoffInput,
    setDraftInput: updateDraftInput,
    statusMessage,
    statusTone,
  }
}
