import { TurnstileChallengeSlot } from '@/components/TurnstileChallengeProvider'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { resumeViewModel } from '@/data/resume'
import type { UIMessage } from 'ai'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Bot, Loader2, Send, ShieldCheck, TriangleAlert, User } from 'lucide-react'
import type { FormEvent, KeyboardEvent } from 'react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import { getMessageText, getToolParts, isContactToolPart } from './chat-message-utils'
import { ChatStatusStrip } from './ChatStatusStrip'
import {
  deriveContactFlowState,
  isTerminalContactFlowPhase,
  type ToolRenderContext,
} from './contact-flow'
import { ContactFlowCard } from './ContactFlowCard'
import { renderToolPart } from './tool-renderers'
import { useResumeChat } from './useResumeChat'

const COMPOSER_MIN_HEIGHT = 44
const COMPOSER_MAX_HEIGHT = 96

// Lets the persistent shell (rendered by the launcher, above the Suspense
// boundary) drive the header Clear button from the body's live handler/state,
// so the shell — and its enter animation — never remounts when the body
// suspends. See src/components/ResumeChat.tsx.
export type ChatClearBridge = {
  setHandler: (handler: (() => void) | null) => void
  setDisabled: (disabled: boolean) => void
  register: () => () => void
}

type ResumeChatDialogBodyProps = {
  isOpen: boolean
  clearBridge: ChatClearBridge
  // Assistant content landed while the panel was hidden; drives the launcher's
  // unread indicator.
  onUnreadActivity: () => void
}

type AssistantMessageContentProps = ToolRenderContext & {
  latestAssistantMessageId: string | null
  isChatErrored: boolean
  message: UIMessage
}

export function AssistantMessageContent({
  latestAssistantMessageId,
  isChatErrored,
  message,
  ...toolRenderContext
}: AssistantMessageContentProps) {
  const text = getMessageText(message)
  const toolParts = getToolParts(message)
  // Contact tools share state across multiple parts, so render them as one flow card.
  const contactParts = toolParts.filter((part) => isContactToolPart(part))
  const nonContactParts = toolParts.filter((part) => !isContactToolPart(part))
  const contactFlowState =
    contactParts.length > 0 ? deriveContactFlowState(contactParts, toolRenderContext) : null
  const showDraftingState =
    !text.trim() &&
    !isChatErrored &&
    latestAssistantMessageId === message.id &&
    !(contactFlowState && isTerminalContactFlowPhase(contactFlowState.phase))

  return (
    <>
      {contactFlowState && (
        <ContactFlowCard
          state={contactFlowState}
          setContactHandoffInput={toolRenderContext.setContactHandoffInput}
          completeContactHandoff={toolRenderContext.completeContactHandoff}
          cancelContactHandoff={toolRenderContext.cancelContactHandoff}
        />
      )}

      {text.trim() && (
        <div
          className={contactParts.length > 0 ? 'mt-3 border-t border-slate-300/60 pt-3' : undefined}
        >
          <ReactMarkdown>{text}</ReactMarkdown>
        </div>
      )}

      {/* Each divider renders only when renderable content actually precedes
          its block (render order: contact card, text, drafting, tool cards) —
          a tool-only bubble gets no leading rule and no dead top spacing. */}
      {showDraftingState && (
        <div
          className={contactParts.length > 0 ? 'mt-3 border-t border-slate-300/60 pt-3' : undefined}
        >
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
            Drafting response...
          </span>
        </div>
      )}

      {nonContactParts.length > 0 && (
        <div
          className={
            contactParts.length > 0 || Boolean(text.trim()) || showDraftingState
              ? 'mt-3 border-t border-slate-300/60 pt-3'
              : undefined
          }
        >
          {nonContactParts.map((part) => (
            <div key={part.toolCallId}>{renderToolPart(part)}</div>
          ))}
        </div>
      )}
    </>
  )
}

export default function ResumeChatDialogBody({
  isOpen,
  clearBridge,
  onUnreadActivity,
}: ResumeChatDialogBodyProps) {
  const {
    contactHandoffInputs,
    contactHandoffInputErrors,
    contactHandoffSubmitNotices,
    clearChat,
    cancelContactHandoff,
    challengeErrorMessage,
    chatErrored,
    completeContactHandoff,
    canRetryBootstrap,
    draftInput,
    isAwaitingToolInput,
    isChatReady,
    isLoading,
    messages,
    needsChallenge,
    pendingToolContinuations,
    retryBootstrap,
    sendDraft,
    setContactHandoffInput,
    setDraftInput,
    statusMessage,
    statusTone,
  } = useResumeChat(isOpen)

  // Register with the persistent shell's header Clear button and keep its
  // handler/disabled state current. The button lives in the shell (which never
  // remounts); this body may suspend and remount, so it publishes state instead
  // of owning the button.
  useEffect(() => clearBridge.register(), [clearBridge])
  useEffect(() => {
    clearBridge.setHandler(clearChat)
  })
  // Clear is local-only now, but stays disabled while a reply streams or a
  // contact dispatch is in flight: wiping the history mid-handoff would orphan
  // the SMS resolution with no tool call left to attach it to. Mirrors the
  // guard inside clearChat.
  const hasPendingHandoffAction = Object.keys(pendingToolContinuations).length > 0
  useEffect(() => {
    clearBridge.setDisabled(isLoading || hasPendingHandoffAction)
  }, [clearBridge, isLoading, hasPendingHandoffAction])

  // Unread derivation: the panel hides without unmounting, so a stream that
  // keeps arriving while hidden shows up here as message updates. Layout-effect
  // sync (not a render-time write) makes the committed open state
  // authoritative, so reopening in the same commit as a message update never
  // marks unread. Any assistant-message mutation counts — tool cards included.
  const isOpenRef = useRef(isOpen)
  useLayoutEffect(() => {
    isOpenRef.current = isOpen
  }, [isOpen])
  useEffect(() => {
    if (!isOpenRef.current && messages[messages.length - 1]?.role === 'assistant') {
      onUnreadActivity()
    }
  }, [messages, onUnreadActivity])
  const prefersReducedMotion = useReducedMotion()
  // Info-tone waits ("Preparing secure chat...") live inside the input as a
  // disabled spinner overlay, so the status strip is error-only and no longer
  // pops in above the input.
  const busyMessage = statusTone === 'info' ? statusMessage : null
  const showBusyInput = Boolean(busyMessage) && !needsChallenge
  // A Turnstile widget failure (challengeErrorMessage, from the hook) shows as a
  // red role="alert" overlay inside the disabled input — the same slot as the
  // busy wait — instead of the status strip. The strip stays for retryable
  // bootstrap/continuation errors and for send/stream errors while the input is
  // enabled. The centered widget keeps its own error + Try again as the action.
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const latestMessage = messages[messages.length - 1]
  // "Currently drafting": only meaningful while a request is in flight. The
  // new /api/chat stream carries no finishReason metadata, so a settled status
  // is the signal that the latest assistant turn is done.
  const latestAssistantMessageId =
    isLoading && latestMessage?.role === 'assistant' ? latestMessage.id : null
  const toolRenderContext: ToolRenderContext = {
    contactHandoffInputs,
    contactHandoffInputErrors,
    contactHandoffSubmitNotices,
    pendingToolContinuations,
    setContactHandoffInput,
    cancelContactHandoff,
    completeContactHandoff,
  }

  useEffect(() => {
    if (!isOpen) {
      return
    }

    if (messages.length === 0 && !isLoading) {
      return
    }

    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [isLoading, isOpen, messages])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus()
    }, 30)

    return () => {
      window.clearTimeout(focusTimer)
    }
  }, [isOpen])

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) {
      return
    }

    input.style.height = 'auto'
    const contentHeight = draftInput ? input.scrollHeight + 2 : COMPOSER_MIN_HEIGHT
    input.style.height = `${Math.min(
      Math.max(contentHeight, COMPOSER_MIN_HEIGHT),
      COMPOSER_MAX_HEIGHT
    )}px`
    input.style.overflowY = contentHeight > COMPOSER_MAX_HEIGHT ? 'auto' : 'hidden'
  }, [draftInput])

  const applyStarterPrompt = (prompt: string) => {
    setDraftInput(prompt)
    window.setTimeout(() => inputRef.current?.focus(), 20)
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await sendDraft()
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229
    ) {
      return
    }

    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  return (
    <>
      {/* overscroll-contain on the real scroll container (the Radix Viewport):
          the panel is non-modal with no scroll lock, so without it wheel/touch
          at the transcript's edges chains to the page behind. [&>div]:!block
          overrides Radix's inline display:table content wrapper, which sizes
          to min-content — an unbreakable line (e.g. the weather card's nowrap
          location kicker) laid the whole transcript out wider than the
          viewport and clipped it at the right edge. */}
      <ScrollArea
        className="min-h-0 flex-1 bg-background/60 p-3 sm:p-4"
        viewportClassName="overscroll-contain [&>div]:!block"
        viewportStyle={{ overflowY: 'auto' }}
        // App-owned hook for the shell's touch-containment handler; keep it if
        // this ever moves off Radix ScrollArea, or touch scrolling dies.
        viewportAttrs={{ 'data-chat-scroll-viewport': 'true' }}
      >
        <div className="space-y-5" role="log" aria-live="polite" aria-relevant="additions text">
          {needsChallenge ? (
            <div className="space-y-5 px-3 py-8 text-center sm:px-5">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-600/10">
                <ShieldCheck className="h-7 w-7 text-blue-600" aria-hidden="true" />
              </div>
              {/* Single verify signal: the widget here + the disabled input's
                  placeholder below. No duplicate heading or status strip. */}
              <TurnstileChallengeSlot className="mx-auto w-full max-w-xs" />
            </div>
          ) : messages.length === 0 ? (
            <div className="space-y-6 px-3 py-8 text-center sm:px-5">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-600/10">
                <Bot className="h-7 w-7 text-blue-600 opacity-50" />
              </div>
              <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
                Ask me directly &mdash; I&apos;ll answer from documented experience and call out the
                gaps.
              </p>
              <div className="space-y-2.5 text-left">
                {resumeViewModel.starterPrompts.map((prompt) => (
                  <Button
                    key={prompt}
                    type="button"
                    variant="outline"
                    className="h-auto w-full whitespace-normal px-3 py-2.5 text-left text-xs leading-relaxed sm:text-sm"
                    onClick={() => applyStarterPrompt(prompt)}
                  >
                    {prompt}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((message) => {
            // Skip a contentless assistant turn (empty completion) unless it is
            // the one actively drafting — otherwise it renders as an empty bubble.
            const isDraftingLatest = message.id === latestAssistantMessageId && !chatErrored
            if (
              message.role === 'assistant' &&
              !isDraftingLatest &&
              getMessageText(message).trim() === '' &&
              getToolParts(message).length === 0
            ) {
              return null
            }

            return (
              <motion.div
                key={message.id}
                initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`flex max-w-[95%] gap-3 sm:max-w-[90%] ${
                    message.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                  }`}
                >
                  <div
                    className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border shadow-sm ${
                      message.role === 'user'
                        ? 'border-blue-500 bg-blue-600 text-white'
                        : 'border-slate-700 bg-slate-800 text-white'
                    }`}
                    aria-hidden="true"
                  >
                    {message.role === 'user' ? (
                      <User className="h-4 w-4" />
                    ) : (
                      <Bot className="h-4 w-4" />
                    )}
                  </div>
                  {/* min-w-0: the bubble is a flex item, so without it an
                      unbreakable line inside (the weather card's nowrap
                      location kicker) sets min-width:auto to its min-content
                      and pushes the bubble past max-w-[95%], clipping it at
                      the panel edge. min-w-0 lets truncate do its job. */}
                  <div
                    className={`min-w-0 rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                      message.role === 'user'
                        ? 'rounded-tr-none bg-blue-600 text-white'
                        : 'chat-bubble markdown-content rounded-tl-none border bg-secondary text-secondary-foreground'
                    }`}
                  >
                    {message.role === 'assistant' ? (
                      <AssistantMessageContent
                        message={message}
                        latestAssistantMessageId={latestAssistantMessageId}
                        isChatErrored={chatErrored}
                        {...toolRenderContext}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap">{getMessageText(message)}</p>
                    )}
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
        <div ref={scrollRef} className="h-0" />
      </ScrollArea>

      <div className="border-t bg-background p-3 sm:p-4">
        {statusMessage && statusTone === 'error' && !challengeErrorMessage && (
          <ChatStatusStrip
            tone="error"
            message={statusMessage}
            canRetry={canRetryBootstrap}
            onRetry={retryBootstrap}
          />
        )}

        <form onSubmit={onSubmit} className="flex items-end gap-2">
          <label htmlFor="resume-chat-input" className="sr-only">
            Ask a question about {resumeViewModel.firstName}&apos;s experience
          </label>
          <div className="relative flex-1">
            <Textarea
              id="resume-chat-input"
              ref={inputRef}
              rows={1}
              value={draftInput}
              onChange={(event) => setDraftInput(event.target.value)}
              onKeyDown={onInputKeyDown}
              disabled={needsChallenge || showBusyInput}
              placeholder={
                needsChallenge
                  ? challengeErrorMessage
                    ? ''
                    : 'Verify you’re human to start chatting.'
                  : showBusyInput
                    ? ''
                    : 'Ask about projects, experience, or fit...'
              }
              className="min-h-11 max-h-24 w-full resize-none bg-secondary/50 leading-relaxed md:text-base"
              autoComplete="off"
              enterKeyHint="send"
            />
            {/* Over the disabled input, so the layout never jogs: the
                connecting/preparing wait (role="status", info) and the
                verify-state failure (role="alert", red) each keep the
                announcement the status strip used to make. Mutually exclusive —
                busy needs !needsChallenge, the error needs needsChallenge. */}
            <AnimatePresence>
              {showBusyInput && (
                <motion.div
                  role="status"
                  initial={prefersReducedMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  // Exit instantly: a fade-out would let the re-enabled input's
                  // placeholder bleed through the overlay mid-transition.
                  exit={{ opacity: 0, transition: { duration: 0 } }}
                  transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
                  className="pointer-events-none absolute inset-y-0 left-0 right-0 flex items-center gap-2 rounded-md bg-secondary px-3 text-sm text-muted-foreground"
                >
                  <Loader2 aria-hidden className="h-4 w-4 animate-spin text-blue-600" />
                  <span>{busyMessage}</span>
                </motion.div>
              )}
              {challengeErrorMessage && (
                <motion.div
                  role="alert"
                  initial={prefersReducedMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
                  className="pointer-events-none absolute inset-y-0 left-0 right-0 flex items-center gap-2 rounded-md bg-secondary px-3 text-sm text-red-700 dark:text-red-200"
                >
                  <TriangleAlert aria-hidden className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">{challengeErrorMessage}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <Button
            type="submit"
            // isAwaitingToolInput: an unresolved contact form must be submitted
            // or cancelled before another message can be sent (the server
            // rejects a history with a dangling tool call).
            disabled={isLoading || !isChatReady || isAwaitingToolInput || !draftInput.trim()}
            className="btn-gradient h-11 min-w-11 shrink-0 rounded-xl px-3 shadow-lg !text-white hover:!text-white"
            aria-label="Send message"
            title="Send message"
          >
            <Send className="h-5 w-5" />
          </Button>
        </form>
      </div>
    </>
  )
}
