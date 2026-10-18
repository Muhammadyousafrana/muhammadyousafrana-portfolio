import type { ChatClearBridge } from '@/components/chat/ResumeChatDialog'
import { ResumeChatDialogShell } from '@/components/chat/ResumeChatDialogShell'
import { Button } from '@/components/ui/button'
import { motion, useReducedMotion } from 'framer-motion'
import { Loader2, MessageSquare, Trash2 } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

let resumeChatDialogPromise: Promise<typeof import('@/components/chat/ResumeChatDialog')> | null =
  null

const loadResumeChatDialog = () => {
  if (!resumeChatDialogPromise) {
    resumeChatDialogPromise = import('@/components/chat/ResumeChatDialog')
  }

  return resumeChatDialogPromise
}

const LazyResumeChatDialogBody = lazy(loadResumeChatDialog)

export function ResumeChat() {
  const prefersReducedMotion = useReducedMotion()
  const [isOpen, setIsOpen] = useState(false)
  // Sticky after the first open: the chat mounts lazily once, then only ever
  // hides via CSS (see ResumeChatDialogShell) so an in-flight reply keeps
  // streaming while the panel is hidden.
  const [shouldRenderChat, setShouldRenderChat] = useState(false)
  // Assistant content arrived while the panel was hidden; cleared on open.
  const [hasUnread, setHasUnread] = useState(false)
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const openButtonRef = useRef<HTMLButtonElement>(null)
  const wasOpenRef = useRef(false)

  // The Clear button lives in the persistent shell header (which never
  // remounts), but its handler + disabled state come from the lazy body, which
  // may suspend. Keep the handler in a ref (avoids per-render parent churn) and
  // mirror only ready/disabled into state for the button.
  const clearHandlerRef = useRef<(() => void) | null>(null)
  const [clearReady, setClearReady] = useState(false)
  const [clearDisabled, setClearDisabled] = useState(true)
  const clearBridge = useMemo<ChatClearBridge>(
    () => ({
      setHandler: (handler) => {
        clearHandlerRef.current = handler
      },
      setDisabled: setClearDisabled,
      register: () => {
        setClearReady(true)
        return () => {
          setClearReady(false)
          setClearDisabled(true)
          clearHandlerRef.current = null
        }
      },
    }),
    []
  )

  useEffect(() => {
    setPortalContainer(document.body)
  }, [])

  // Non-modal focus management: on open, move focus into the panel unless the
  // body already claimed it (it focuses the input once loaded — the fallback
  // here covers the lazy/Suspense window and a security-gated disabled input).
  // On close-from-within (close button / Escape), return focus to the trigger.
  useEffect(() => {
    if (!isOpen) {
      if (wasOpenRef.current) {
        openButtonRef.current?.focus()
      }

      wasOpenRef.current = false
      return
    }

    wasOpenRef.current = true
    const focusTimer = window.setTimeout(() => {
      const panel = dialogRef.current
      if (panel && !panel.contains(document.activeElement)) {
        panel.focus()
      }
    }, 30)

    return () => window.clearTimeout(focusTimer)
  }, [isOpen])

  const preloadDialog = () => {
    void loadResumeChatDialog()
  }

  const openPanel = () => {
    setShouldRenderChat(true)
    setHasUnread(false)
    preloadDialog()
    if (isOpen) {
      // Already open (desktop keeps the trigger visible beside the panel):
      // the trigger acts as a focus shortcut instead of a toggle — only the
      // close button and Escape hide the panel.
      dialogRef.current?.focus()
      return
    }

    setIsOpen(true)
  }

  const closePanel = useCallback(() => setIsOpen(false), [])
  const markUnread = useCallback(() => setHasUnread(true), [])

  return (
    <>
      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: prefersReducedMotion ? 0 : 0.35,
          delay: prefersReducedMotion ? 0 : 0.35,
        }}
        // Stays mounted while the panel is open (stable aria-expanded target +
        // focus-return target). On mobile the open bottom sheet would cover
        // it, so hide it there rather than leaving a focusable control under
        // the panel; on desktop the panel docks above it and it stays usable.
        className={`fixed bottom-4 left-4 right-4 z-50 sm:left-auto sm:right-6 sm:w-auto ${
          isOpen ? 'invisible pointer-events-none sm:visible sm:pointer-events-auto' : ''
        }`}
      >
        <Button
          ref={openButtonRef}
          onClick={openPanel}
          onPointerEnter={preloadDialog}
          onFocus={preloadDialog}
          className="btn-gradient relative h-12 w-full rounded-2xl border-2 border-white/20 px-4 shadow-2xl !text-white hover:!text-white hover:shadow-blue-600/20 sm:h-14 sm:w-auto sm:rounded-full sm:px-5"
          aria-label={
            isOpen
              ? 'Focus portfolio AI chat'
              : hasUnread
                ? 'Open portfolio AI chat (new reply)'
                : 'Open portfolio AI chat'
          }
          aria-controls="resume-chat-dialog"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
        >
          <motion.span
            animate={
              prefersReducedMotion ? undefined : { scale: [1, 1.08, 1], opacity: [1, 0.9, 1] }
            }
            transition={
              prefersReducedMotion
                ? undefined
                : { duration: 2.8, repeat: Infinity, repeatDelay: 1.6, ease: 'easeInOut' }
            }
            className="inline-flex"
          >
            <MessageSquare className="h-5 w-5 sm:h-6 sm:w-6" />
          </motion.span>
          <span className="text-xs font-semibold sm:text-sm">Ask my AI about my experience</span>
          {hasUnread && (
            <span aria-hidden="true" className="absolute -right-1 -top-1 flex h-3 w-3">
              {!prefersReducedMotion && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              )}
              <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500 ring-2 ring-white" />
            </span>
          )}
        </Button>
      </motion.div>

      {shouldRenderChat &&
        portalContainer &&
        createPortal(
          <ResumeChatDialogShell
            dialogRef={dialogRef}
            isOpen={isOpen}
            onClose={closePanel}
            headerActions={
              <Button
                variant="ghost"
                size="icon"
                onClick={() => clearHandlerRef.current?.()}
                className="h-8 w-8 text-primary-foreground hover:bg-white/10 hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
                title="Clear chat history"
                aria-label="Clear chat history"
                disabled={!clearReady || clearDisabled}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            }
          >
            {/* Only the body's initial code-split load suspends here (useChat
                itself never suspends); the shell above stays mounted, so its
                enter animation runs once. */}
            <Suspense
              fallback={
                <div className="flex flex-1 items-center justify-center bg-background/60 p-6">
                  <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    Loading chat...
                  </span>
                </div>
              }
            >
              <LazyResumeChatDialogBody
                isOpen={isOpen}
                clearBridge={clearBridge}
                onUnreadActivity={markUnread}
              />
            </Suspense>
          </ResumeChatDialogShell>,
          portalContainer
        )}
    </>
  )
}
