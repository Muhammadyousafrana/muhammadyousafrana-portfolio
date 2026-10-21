import type { ChatClearBridge } from '@/components/chat/ResumeChatDialog'
import { ResumeChatDialogShell } from '@/components/chat/ResumeChatDialogShell'
import { Button } from '@/components/ui/button'
import { resumeViewModel } from '@/data/resume'
import { motion, useReducedMotion } from 'framer-motion'
import { Bot, Loader2, Sparkles, Trash2 } from 'lucide-react'
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
  const [shouldRenderChat, setShouldRenderChat] = useState(false)
  const [hasUnread, setHasUnread] = useState(false)
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const openButtonRef = useRef<HTMLButtonElement>(null)
  const wasOpenRef = useRef(false)

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
        initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: prefersReducedMotion ? 0 : 0.35,
          delay: prefersReducedMotion ? 0 : 0.35,
        }}
        className={`fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-50 ${
          isOpen ? 'invisible pointer-events-none sm:visible sm:pointer-events-auto' : ''
        }`}
      >
        <Button
          ref={openButtonRef}
          onClick={openPanel}
          onPointerEnter={preloadDialog}
          onFocus={preloadDialog}
          className="btn-gradient relative h-11 sm:h-12 rounded-full border border-white/30 px-3.5 sm:px-4.5 shadow-xl !text-white hover:!text-white hover:shadow-blue-500/35 flex items-center gap-2 backdrop-blur-xl group cursor-pointer"
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
          {/* Active Status Pulse */}
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>

          <Bot className="size-4.5 text-white/95 transition-transform duration-300 group-hover:scale-110" />

          <span className="text-xs sm:text-sm font-semibold tracking-wide">
            Ask {resumeViewModel.assistantName || 'Robo-Yousaf'}
          </span>

          <Sparkles className="size-3 text-cyan-300 animate-pulse ml-0.5" />

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
