import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { resumeViewModel } from '@/data/resume'
import { motion, useReducedMotion } from 'framer-motion'
import { Bot, X } from 'lucide-react'
import { useEffect, type ReactNode, type RefObject } from 'react'

type ResumeChatDialogShellProps = {
  children: ReactNode
  dialogRef: RefObject<HTMLDivElement | null>
  headerActions?: ReactNode
  isOpen: boolean
  onClose: () => void
}

// Non-modal docked chat panel: the page behind stays fully interactive (no
// backdrop, no focus trap, no scroll lock). Hiding is pure CSS — the panel and
// the chat body inside it stay mounted, so an in-flight reply keeps streaming
// while hidden. Only the header close button and Escape-from-within hide it.
export function ResumeChatDialogShell({
  children,
  dialogRef,
  headerActions,
  isOpen,
  onClose,
}: ResumeChatDialogShellProps) {
  const prefersReducedMotion = useReducedMotion()

  // Native keydown listener rather than React onKeyDown: the Turnstile inline
  // UI is portaled in from the provider's React tree, so its synthetic events
  // bypass this shell — DOM bubbling still passes through the panel node.
  // Scoped to the panel, Escape only closes while focus is within it.
  useEffect(() => {
    const panel = dialogRef.current
    if (!isOpen || !panel) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    panel.addEventListener('keydown', onKeyDown)
    return () => panel.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose, dialogRef])

  // Scroll containment fallback: WebKit ignores overscroll-behavior on a
  // scroll container without overflowing content (bug 243452), so on iOS a
  // touch-drag on a short transcript — or on the header/input row — would
  // scroll the page behind the panel. While the gesture is on the panel, let
  // the transcript viewport consume what it can and preventDefault the rest.
  // Listeners are scoped to the panel (non-modal: page scrolling with the
  // pointer outside the panel must keep working) and non-passive, since
  // preventDefault is the whole point. The viewport is looked up per event
  // because the chat body can suspend and remount under this shell.
  useEffect(() => {
    const panel = dialogRef.current
    if (!isOpen || !panel) {
      return
    }

    // Matches the app-owned marker stamped in ResumeChatDialog first, so this
    // handler doesn't silently break if the transcript ever moves off Radix
    // ScrollArea; Radix's own attribute stays as a fallback.
    const viewportFor = (target: EventTarget | null) =>
      target instanceof Element
        ? target.closest('[data-chat-scroll-viewport], [data-radix-scroll-area-viewport]')
        : null

    // Touch: prevent only the moves the transcript cannot possibly consume —
    // touches outside it, or on a transcript with no overflow (the exact case
    // WebKit's overscroll-behavior bug leaks to the page). When the transcript
    // IS scrollable, leave touch alone: browsers decide touch scrolling per
    // gesture at the first touchmove, so preventing an edge overscroll there
    // would also kill a mid-gesture reversal that should scroll the chat.
    // Scrollable-edge containment is the CSS overscroll-contain's job, which
    // WebKit honors once the scroller has overflow.
    const onTouchMove = (event: TouchEvent) => {
      if (!event.cancelable || event.touches.length > 1) {
        return
      }
      const viewport = viewportFor(event.target)
      // The composer (a text control outside the transcript) owns its touch
      // moves while it has content — cursor drags, selection handles, panning
      // overflowing text — so composing stays usable on touch devices. Empty,
      // it has nothing to select or pan, and stays contained. Text controls
      // INSIDE the transcript (contact flow) keep the transcript's rule below.
      const target = event.target instanceof Element ? event.target : null
      const textControl = target?.closest<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
      if (!viewport && textControl && textControl.value !== '') {
        return
      }
      if (!viewport || viewport.scrollHeight <= viewport.clientHeight) {
        event.preventDefault()
      }
    }
    // Wheel events are discrete (no gesture latching), so here edge
    // overscroll is prevented directly. deltaY > 0 means scroll-down intent.
    const canConsume = (viewport: Element, deltaY: number) =>
      deltaY < 0
        ? viewport.scrollTop > 0
        : viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1
    const onWheel = (event: WheelEvent) => {
      // ctrlKey: trackpad pinch / ctrl+wheel zoom — never block zooming.
      if (!event.cancelable || event.ctrlKey) {
        return
      }
      const viewport = viewportFor(event.target)
      if (!viewport || (event.deltaY !== 0 && !canConsume(viewport, event.deltaY))) {
        event.preventDefault()
      }
    }

    panel.addEventListener('touchmove', onTouchMove, { passive: false })
    panel.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      panel.removeEventListener('touchmove', onTouchMove)
      panel.removeEventListener('wheel', onWheel)
    }
  }, [isOpen, dialogRef])

  return (
    <motion.div
      ref={dialogRef}
      tabIndex={-1}
      // Hidden means hidden: unfocusable and out of the accessibility tree,
      // while the DOM (and any in-flight stream) stays alive underneath.
      inert={!isOpen}
      initial={prefersReducedMotion ? false : { opacity: 0, y: 24, scale: 0.98 }}
      animate={
        isOpen
          ? { opacity: 1, y: 0, scale: 1, visibility: 'visible' }
          : {
              opacity: 0,
              y: prefersReducedMotion ? 0 : 24,
              scale: prefersReducedMotion ? 1 : 0.98,
              // Applied after the exit animation settles, so the panel fades
              // out visibly and only then stops painting.
              transitionEnd: { visibility: 'hidden' },
            }
      }
      transition={{ duration: prefersReducedMotion ? 0 : 0.16 }}
      // Mobile: bottom sheet covering most of the viewport (the page peeks at
      // the top; no outside-tap dismiss). Desktop: docked bottom-right, seated
      // above the launcher so the trigger stays visible while the panel is
      // open. The moment it closes: pointer-events-none so the exiting panel
      // never intercepts page clicks, and dropped below the z-50 launcher so
      // the still-fading sheet cannot obscure the freshly focused trigger.
      className={`fixed inset-x-0 bottom-0 h-[calc(100dvh-4rem)] focus:outline-none sm:inset-x-auto sm:bottom-24 sm:right-6 sm:h-[620px] sm:max-h-[82vh] sm:w-[460px] ${
        isOpen ? 'z-50' : 'z-40 pointer-events-none'
      }`}
      id="resume-chat-dialog"
      role="dialog"
      aria-labelledby="resume-chat-title"
      aria-describedby="resume-chat-description"
    >
      {/* overscroll-contain: the Card is overflow-hidden (a scroll container),
          so this stops wheel/touch over the header and input row — outside the
          transcript's scroll chain — from scrolling the page behind. */}
      <Card className="glass-darker flex h-full flex-col overflow-hidden overscroll-contain rounded-t-3xl border-2 shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b bg-primary p-4 text-primary-foreground">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 shadow-inner">
              <Bot className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h3
                id="resume-chat-title"
                className="truncate text-[11px] font-bold uppercase tracking-[0.12em]"
              >
                {resumeViewModel.assistantName}
              </h3>
              <p id="resume-chat-description" className="mt-1.5 text-xs leading-relaxed opacity-90">
                Ask me about my projects, technical decisions, strengths, gaps, and role fit.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {headerActions}
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8 text-primary-foreground hover:bg-white/10 hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
              title="Close chat"
              aria-label="Close chat"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {children}
      </Card>
    </motion.div>
  )
}
