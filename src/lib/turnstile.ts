import { ensureChatBootstrapLoaded, useChatBootstrap } from '@/lib/chat-bootstrap'
import { chatDebug } from '@/lib/chat-debug'
import { CHAT_BOOTSTRAP_ROUTE_PREFIX } from '@shared/chat'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

const TURNSTILE_SCRIPT_ID = 'cf-turnstile-script'
const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const TURNSTILE_SCRIPT_STATUS = 'data-status'
const TURNSTILE_SCRIPT_OWNER = 'data-managed-by'
const TURNSTILE_SCRIPT_OWNER_VALUE = 'resume-chat'
const TURNSTILE_CONFIG_ERROR_MESSAGE =
  'Security check is enabled, but this build is missing the Turnstile site key.'
const TURNSTILE_SCRIPT_ERROR_MESSAGE = 'Security check failed to load. Please try again.'
const TURNSTILE_VERIFY_ERROR_MESSAGE = 'Security verification failed. Please try again.'
const TURNSTILE_EXPIRED_MESSAGE = 'Security check expired. Please verify again.'

// Re-challenge this many ms before the server lease actually expires so a gated
// action never races a just-expired cookie.
const CHALLENGE_SAFETY_MARGIN_MS = 30 * 1000
// Fallback horizon when a verify response omits the expiry. This should not
// happen in practice (a missing signing secret 503s earlier), and 403 recovery
// covers it regardless.
const CHALLENGE_FALLBACK_TTL_MS = 60 * 1000

// Turns an absolute server expiry (epoch ms, or null) into the local horizon at
// which we proactively re-challenge.
const horizonFromExpiry = (expiresAt: number | null): number =>
  expiresAt === null
    ? Date.now() + CHALLENGE_FALLBACK_TTL_MS
    : expiresAt - CHALLENGE_SAFETY_MARGIN_MS

type TurnstileWidgetId = string
type TurnstileScriptStatus = 'loading' | 'loaded' | 'failed'
type TurnstileRenderOptions = {
  sitekey: string
  size?: 'normal' | 'flexible' | 'compact'
  theme?: 'auto' | 'light' | 'dark'
  callback: (token: string) => void
  'expired-callback': () => void
  'error-callback': () => void
}

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => TurnstileWidgetId
  reset: (widgetId: TurnstileWidgetId) => void
  remove: (widgetId: TurnstileWidgetId) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const readSiteKey = (): string | undefined => {
  const value = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim()
  return value && value.length > 0 ? value : undefined
}

const getTurnstileApi = (): TurnstileApi | undefined =>
  typeof window === 'undefined' ? undefined : window.turnstile

const removeTurnstileScript = (script: HTMLScriptElement | null) => {
  script?.parentNode?.removeChild(script)
}

const markScriptStatus = (script: HTMLScriptElement, status: TurnstileScriptStatus) => {
  script.setAttribute(TURNSTILE_SCRIPT_STATUS, status)
}

const readScriptStatus = (script: HTMLScriptElement | null): TurnstileScriptStatus | null => {
  const status = script?.getAttribute(TURNSTILE_SCRIPT_STATUS)
  return status === 'loading' || status === 'loaded' || status === 'failed' ? status : null
}

const isManagedTurnstileScript = (script: HTMLScriptElement | null) =>
  script?.getAttribute(TURNSTILE_SCRIPT_OWNER) === TURNSTILE_SCRIPT_OWNER_VALUE

const clearTurnstileContainer = (container: HTMLElement | null) => {
  container?.replaceChildren()
}

// Loads the Turnstile script once and calls back when the api is ready. Returns
// a cleanup that detaches the pending listeners.
const ensureTurnstileScript = (onReady: () => void, onError: () => void): (() => void) => {
  const existingScript = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null
  if (existingScript) {
    if (readScriptStatus(existingScript) === 'loaded' || getTurnstileApi()) {
      markScriptStatus(existingScript, 'loaded')
      onReady()
      return () => {}
    }

    if (
      isManagedTurnstileScript(existingScript) &&
      readScriptStatus(existingScript) === 'loading'
    ) {
      existingScript.addEventListener('load', onReady)
      existingScript.addEventListener('error', onError)
      return () => {
        existingScript.removeEventListener('load', onReady)
        existingScript.removeEventListener('error', onError)
      }
    }

    removeTurnstileScript(existingScript)
  }

  const script = document.createElement('script')
  script.id = TURNSTILE_SCRIPT_ID
  script.src = TURNSTILE_SCRIPT_SRC
  script.async = true
  script.defer = true
  script.setAttribute(TURNSTILE_SCRIPT_OWNER, TURNSTILE_SCRIPT_OWNER_VALUE)
  markScriptStatus(script, 'loading')

  const handleLoad = () => {
    markScriptStatus(script, 'loaded')
    onReady()
  }

  const handleError = () => {
    markScriptStatus(script, 'failed')
    removeTurnstileScript(script)
    onError()
  }

  script.addEventListener('load', handleLoad)
  script.addEventListener('error', handleError)
  document.head.appendChild(script)

  return () => {
    script.removeEventListener('load', handleLoad)
    script.removeEventListener('error', handleError)
  }
}

// Exchanges a solved managed-widget token for a signed challenge lease cookie and
// returns the lease expiry (epoch ms, or null if absent). The lease then admits
// chat + fit for its TTL (see worker/security.ts).
const exchangeTurnstileTokenForLease = async (token: string): Promise<number | null> => {
  const response = await fetch(`/${CHAT_BOOTSTRAP_ROUTE_PREFIX}/verify-turnstile`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'x-turnstile-token': token },
  })
  if (!response.ok) {
    throw new Error(`verify-turnstile failed with status ${response.status}`)
  }
  const payload: unknown = await response.json().catch(() => null)
  const expiresAt =
    payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: { challengeExpiresAt?: unknown } }).data?.challengeExpiresAt
      : undefined
  return typeof expiresAt === 'number' ? expiresAt : null
}

export type TurnstileChallengeValue = {
  requireTurnstile: boolean
  isConfigured: boolean
  isVerified: boolean
  needsChallenge: boolean
  isPrompting: boolean
  error: string | null
  // Element the widget is currently portaled into (a registered inline host, or
  // null for the centered fallback). Provider-facing.
  hostElement: HTMLElement | null
  // Opens the managed-widget prompt if needed and resolves true once a lease is
  // held (or immediately when already verified / not required). false if the
  // build is misconfigured or the user cancels.
  requestChallenge: () => Promise<boolean>
  cancelChallenge: () => void
  retry: () => void
  // A gated request came back verification-required: drop the local lease so the
  // next action re-challenges.
  reportChallengeRejected: () => void
  // Registers a DOM element as the inline host for the widget and returns an
  // unregister. Consumed via <TurnstileChallengeSlot />.
  registerHost: (element: HTMLElement | null) => () => void
  // Callback ref the provider uses to place the widget's container node.
  // Provider-facing.
  setWidgetContainer: (element: HTMLDivElement | null) => void
}

// Single source of truth for the shared challenge lease. Mounted once by
// TurnstileChallengeProvider; every AI surface consumes it via
// useTurnstileChallenge so one verification unlocks all of them.
export function useTurnstileChallengeController(): TurnstileChallengeValue {
  const siteKey = readSiteKey()
  const isConfigured = Boolean(siteKey)
  const { data: bootstrapData } = useChatBootstrap(true)
  const requireTurnstile = bootstrapData?.requireTurnstile === true
  const bootstrapExpiresAt = bootstrapData?.challengeExpiresAt ?? null

  const widgetIdRef = useRef<TurnstileWidgetId | null>(null)
  const pendingResolversRef = useRef<Array<(ok: boolean) => void>>([])
  // Bumped before each render and on teardown so late Turnstile callbacks from a
  // widget that has since been removed (e.g. after a host switch) are ignored.
  const widgetGenerationRef = useRef(0)

  const [verifiedUntil, setVerifiedUntil] = useState<number | null>(null)
  const [isPrompting, setIsPrompting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scriptReady, setScriptReady] = useState<boolean>(() =>
    Boolean(!siteKey || getTurnstileApi())
  )
  const [scriptRetryNonce, setScriptRetryNonce] = useState(0)
  // The widget's container node (callback-ref state) and the inline host it lives
  // in. Keying the render effect on the container node makes a host switch a real
  // re-render rather than relying on portal remount behavior.
  const [widgetContainer, setWidgetContainer] = useState<HTMLDivElement | null>(null)
  const [hostElement, setHostElement] = useState<HTMLElement | null>(null)
  const hostElementRef = useRef<HTMLElement | null>(null)

  // Mirror the horizon into a ref so async callers (requestChallenge) read the
  // current value after awaiting rather than a stale render snapshot.
  const verifiedUntilRef = useRef<number | null>(null)
  useEffect(() => {
    verifiedUntilRef.current = verifiedUntil
  }, [verifiedUntil])

  // Keep a synchronous mirror of isPrompting (updated inside setPrompting) so a
  // host unregister firing during commit — before a passive effect could run —
  // still sees whether a live prompt was relying on it.
  const isPromptingRef = useRef(false)
  const setPrompting = useCallback((value: boolean) => {
    isPromptingRef.current = value
    setIsPrompting(value)
  }, [])

  // Seed the local horizon from a lease minted on a previous page load (using its
  // real expiry) so a returning visitor skips the checkbox.
  useEffect(() => {
    if (requireTurnstile && bootstrapExpiresAt !== null) {
      setVerifiedUntil((current) => current ?? horizonFromExpiry(bootstrapExpiresAt))
    }
  }, [requireTurnstile, bootstrapExpiresAt])

  // Flip back to unverified when the local horizon lapses so the next action
  // re-challenges before the server lease expires.
  useEffect(() => {
    if (verifiedUntil === null) {
      return
    }

    const remaining = verifiedUntil - Date.now()
    if (remaining <= 0) {
      setVerifiedUntil(null)
      return
    }

    const timer = window.setTimeout(() => setVerifiedUntil(null), remaining)
    return () => window.clearTimeout(timer)
  }, [verifiedUntil])

  const isVerified = !requireTurnstile || (verifiedUntil !== null && Date.now() < verifiedUntil)
  const needsChallenge = requireTurnstile && isConfigured && !isVerified

  const resolvePending = useCallback((ok: boolean) => {
    const resolvers = pendingResolversRef.current
    pendingResolversRef.current = []
    for (const resolve of resolvers) {
      resolve(ok)
    }
  }, [])

  // Registers an inline host for the widget. The unregister clears the host only
  // if it is still the current one (safe under StrictMode double-mount / stale
  // unmounts). If the host disappears mid-prompt (e.g. the chat dialog closes),
  // cancel the prompt rather than teleporting it to the centered fallback.
  const registerHost = useCallback(
    (element: HTMLElement | null): (() => void) => {
      hostElementRef.current = element
      setHostElement(element)
      return () => {
        if (hostElementRef.current !== element) {
          return
        }
        hostElementRef.current = null
        setHostElement(null)
        if (isPromptingRef.current) {
          setPrompting(false)
          resolvePending(false)
        }
      }
    },
    [resolvePending, setPrompting]
  )

  const markVerified = useCallback(
    (expiresAt: number | null) => {
      chatDebug('turnstile', 'lease acquired', { expiresAt })
      setVerifiedUntil(horizonFromExpiry(expiresAt))
      setError(null)
      setPrompting(false)
      resolvePending(true)
    },
    [resolvePending, setPrompting]
  )

  // Load the script only when a prompt is actually needed. The retry nonce lets a
  // manual retry re-enter this loader after a prior load failure.
  useEffect(() => {
    if (!siteKey || !isPrompting || scriptReady) {
      return
    }

    return ensureTurnstileScript(
      () => setScriptReady(true),
      () => setError(TURNSTILE_SCRIPT_ERROR_MESSAGE)
    )
  }, [siteKey, isPrompting, scriptReady, scriptRetryNonce])

  // Render the managed widget while prompting, into whichever container node is
  // current. Keyed on `widgetContainer` so a host switch cleanly removes the old
  // widget and renders a fresh one into the new node.
  useEffect(() => {
    if (!siteKey || !isPrompting || !scriptReady || !widgetContainer || widgetIdRef.current) {
      return
    }

    const turnstile = getTurnstileApi()
    if (!turnstile) {
      return
    }

    const generation = (widgetGenerationRef.current += 1)
    const isCurrent = () => widgetGenerationRef.current === generation
    chatDebug('turnstile', 'render managed widget')
    widgetIdRef.current = turnstile.render(widgetContainer, {
      sitekey: siteKey,
      size: 'flexible',
      theme: 'auto',
      callback: (token) => {
        if (!isCurrent()) {
          return
        }
        // The widget shows its own success state while the lease exchange runs;
        // markVerified then unmounts the overlay, so no separate spinner is needed.
        setError(null)
        void exchangeTurnstileTokenForLease(token)
          .then((expiresAt) => {
            // The widget may have been torn down (host switch / cancel) while the
            // exchange was in flight; ignore its result if so.
            if (isCurrent()) {
              markVerified(expiresAt)
            }
          })
          .catch(() => {
            if (isCurrent()) {
              setError(TURNSTILE_VERIFY_ERROR_MESSAGE)
            }
          })
      },
      'expired-callback': () => {
        if (isCurrent()) {
          setError(TURNSTILE_EXPIRED_MESSAGE)
        }
      },
      'error-callback': () => {
        if (!isCurrent()) {
          return
        }
        setError(TURNSTILE_VERIFY_ERROR_MESSAGE)
      },
    })

    return () => {
      // Invalidate callbacks from the widget being torn down.
      widgetGenerationRef.current += 1
      const api = getTurnstileApi()
      if (api && widgetIdRef.current) {
        try {
          api.remove(widgetIdRef.current)
        } catch {
          // Best-effort teardown even if Cloudflare reports a stale handle.
        }
      }
      widgetIdRef.current = null
      clearTurnstileContainer(widgetContainer)
    }
  }, [siteKey, isPrompting, scriptReady, widgetContainer, scriptRetryNonce, markVerified])

  const requestChallenge = useCallback(async (): Promise<boolean> => {
    // Resolve the actual requirement before deciding: a fast click before
    // bootstrap loads must not be treated as "Turnstile not required".
    let data
    try {
      data = await ensureChatBootstrapLoaded()
    } catch {
      setError(TURNSTILE_SCRIPT_ERROR_MESSAGE)
      return false
    }

    if (!data.requireTurnstile) {
      return true
    }

    if (!isConfigured) {
      setError(TURNSTILE_CONFIG_ERROR_MESSAGE)
      return false
    }

    // A lease that bootstrap just proved valid admits immediately, even before
    // the seeding effect has synced the horizon (avoids a needless prompt flash
    // on fast auto-open for a returning visitor).
    if (data.challengeExpiresAt !== null) {
      const bootstrapHorizon = horizonFromExpiry(data.challengeExpiresAt)
      if (Date.now() < bootstrapHorizon) {
        setVerifiedUntil((current) => current ?? bootstrapHorizon)
        return true
      }
    }

    const horizon = verifiedUntilRef.current
    if (horizon !== null && Date.now() < horizon) {
      return true
    }

    chatDebug('turnstile', 'prompt requested')
    setError(null)
    setPrompting(true)
    return new Promise<boolean>((resolve) => {
      pendingResolversRef.current.push(resolve)
    })
  }, [isConfigured, setPrompting])

  const cancelChallenge = useCallback(() => {
    setPrompting(false)
    resolvePending(false)
  }, [resolvePending, setPrompting])

  const retry = useCallback(() => {
    setError(null)
    const turnstile = getTurnstileApi()
    if (turnstile && widgetIdRef.current) {
      try {
        turnstile.reset(widgetIdRef.current)
      } catch {
        // If reset fails, unmounting/remounting the prompt re-renders a fresh widget.
      }
      return
    }

    // No live widget means the script failed to load; re-enter the loader.
    setScriptReady(false)
    setScriptRetryNonce((nonce) => nonce + 1)
  }, [])

  const reportChallengeRejected = useCallback(() => {
    chatDebug('turnstile', 'lease rejected by server')
    setVerifiedUntil(null)
  }, [])

  return {
    requireTurnstile,
    isConfigured,
    isVerified,
    needsChallenge,
    isPrompting,
    error,
    hostElement,
    requestChallenge,
    cancelChallenge,
    retry,
    reportChallengeRejected,
    registerHost,
    setWidgetContainer,
  }
}

export const TurnstileChallengeContext = createContext<TurnstileChallengeValue | null>(null)

export function useTurnstileChallenge(): TurnstileChallengeValue {
  const value = useContext(TurnstileChallengeContext)
  if (!value) {
    throw new Error('useTurnstileChallenge must be used within a TurnstileChallengeProvider')
  }
  return value
}
