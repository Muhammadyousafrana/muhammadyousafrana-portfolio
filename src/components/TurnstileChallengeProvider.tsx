import { Button } from '@/components/ui/button'
import {
  TurnstileChallengeContext,
  useTurnstileChallenge,
  useTurnstileChallengeController,
  type TurnstileChallengeValue,
} from '@/lib/turnstile'
import { Loader2, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// The widget + verifying/error/retry, shared by the inline and modal shells.
function ChallengeWidgetArea({ challenge }: { challenge: TurnstileChallengeValue }) {
  const { error, retry, setWidgetContainer } = challenge
  return (
    <div>
      {/* Reserve height so the auto/checkbox swap does not jog its container. The
          widget's own success state covers the brief verify-turnstile lease
          exchange; markVerified then unmounts this overlay. */}
      <div className="relative flex min-h-[72px] items-center justify-center">
        <div ref={setWidgetContainer} className="relative z-10" />
        {/* Slow-network skeleton. Cloudflare renders the widget inside a
            (closed) shadow DOM, so it can't be detected from here — instead the
            skeleton is sized to the widget's own box (~300x66, 2px radius) and
            sits behind it, and the opaque widget simply covers it once it paints. */}
        {!error && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <div className="flex h-[60px] w-[300px] -translate-y-[2px] items-center justify-center rounded-[2px] border border-dashed border-slate-300 dark:border-slate-700">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
      </div>
      {error && (
        <p className="mt-2 text-center text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
      {error && (
        <div className="mt-3 flex justify-center">
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  )
}

// Centered fallback used when no inline host is registered (fit).
function ChallengeModal({ challenge }: { challenge: TurnstileChallengeValue }) {
  const cardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    cardRef.current?.focus()
  }, [])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Human verification"
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        className="w-full max-w-sm rounded-2xl border bg-background p-6 shadow-2xl outline-none"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600/10">
            <ShieldCheck className="h-5 w-5 text-blue-600" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Quick human check</h2>
            <p className="text-xs text-muted-foreground">Verify once to use the AI features.</p>
          </div>
        </div>

        <div className="mt-4">
          <ChallengeWidgetArea challenge={challenge} />
        </div>

        <div className="mt-4 flex items-center justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={challenge.cancelChallenge}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}

// Inline shell: an unobtrusive labelled region (NOT a dialog / focus trap) that
// the surrounding surface — e.g. the chat window — supplies the heading for.
function ChallengeInline({ challenge }: { challenge: TurnstileChallengeValue }) {
  const regionRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    regionRef.current?.focus()
  }, [])

  return (
    <div
      ref={regionRef}
      role="region"
      aria-label="Human verification"
      tabIndex={-1}
      className="outline-none"
    >
      <ChallengeWidgetArea challenge={challenge} />
    </div>
  )
}

// One managed Turnstile widget for the whole app. When a surface registers an
// inline host (via TurnstileChallengeSlot) the widget renders there; otherwise it
// falls back to a centered modal. Verifying once unlocks chat and fit.
export function TurnstileChallengeProvider({ children }: { children: ReactNode }) {
  const challenge = useTurnstileChallengeController()
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setPortalRoot(document.body)
  }, [])

  const { isPrompting, hostElement } = challenge

  let overlay: ReactNode = null
  if (isPrompting) {
    if (hostElement) {
      overlay = createPortal(<ChallengeInline challenge={challenge} />, hostElement)
    } else if (portalRoot) {
      overlay = createPortal(<ChallengeModal challenge={challenge} />, portalRoot)
    }
  }

  return (
    <TurnstileChallengeContext.Provider value={challenge}>
      {children}
      {overlay}
    </TurnstileChallengeContext.Provider>
  )
}

// Marks where the shared managed widget should render inline. Registers its
// element on mount (via a callback ref, so the host exists before a passive
// effect requests the challenge) and unregisters on unmount.
export function TurnstileChallengeSlot({ className }: { className?: string }) {
  const { registerHost } = useTurnstileChallenge()
  const cleanupRef = useRef<(() => void) | null>(null)

  const hostRef = useCallback(
    (element: HTMLDivElement | null) => {
      cleanupRef.current?.()
      cleanupRef.current = null
      if (element) {
        cleanupRef.current = registerHost(element)
      }
    },
    [registerHost]
  )

  return <div ref={hostRef} className={className} />
}
