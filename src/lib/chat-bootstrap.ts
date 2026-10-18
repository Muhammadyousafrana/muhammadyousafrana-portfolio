import { CHAT_BOOTSTRAP_ROUTE_PREFIX } from '@shared/chat'
import { useEffect, useSyncExternalStore } from 'react'

export type ChatBootstrapData = {
  requireTurnstile: boolean
  hasValidChallenge: boolean
  // Absolute expiry (epoch ms) of the current challenge lease, or null when none.
  challengeExpiresAt: number | null
}

export type ChatBootstrapState = 'idle' | 'loading' | 'ready' | 'error'

export type ChatBootstrapSnapshot = {
  status: ChatBootstrapState
  data: ChatBootstrapData | null
  error: Error | null
}

const INVALID_BOOTSTRAP_PAYLOAD_ERROR = 'Chat bootstrap returned an invalid payload'

let bootstrapPromise: Promise<ChatBootstrapData> | null = null
let bootstrapSnapshot: ChatBootstrapSnapshot = {
  status: 'idle',
  data: null,
  error: null,
}
const bootstrapListeners = new Set<() => void>()

const emitBootstrapChange = () => {
  for (const listener of bootstrapListeners) {
    listener()
  }
}

const setBootstrapSnapshot = (nextSnapshot: ChatBootstrapSnapshot) => {
  bootstrapSnapshot = nextSnapshot
  emitBootstrapChange()
}

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error('Chat bootstrap failed')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const parseBootstrapPayload = (payload: unknown): ChatBootstrapData => {
  if (!isRecord(payload) || payload.success !== true) {
    throw new Error(INVALID_BOOTSTRAP_PAYLOAD_ERROR)
  }

  const data = payload.data
  if (!isRecord(data)) {
    throw new Error(INVALID_BOOTSTRAP_PAYLOAD_ERROR)
  }

  const { requireTurnstile, hasValidChallenge, challengeExpiresAt } = data
  if (typeof requireTurnstile !== 'boolean' || typeof hasValidChallenge !== 'boolean') {
    throw new Error(INVALID_BOOTSTRAP_PAYLOAD_ERROR)
  }
  if (challengeExpiresAt !== null && typeof challengeExpiresAt !== 'number') {
    throw new Error(INVALID_BOOTSTRAP_PAYLOAD_ERROR)
  }

  // Guards above prove this is `number | null`; the index-signature source keeps
  // TS from narrowing the binding, so assert the validated shape.
  return {
    requireTurnstile,
    hasValidChallenge,
    challengeExpiresAt: challengeExpiresAt as number | null,
  }
}

const requestChatBootstrap = async (): Promise<ChatBootstrapData> => {
  const response = await fetch(`/${CHAT_BOOTSTRAP_ROUTE_PREFIX}/bootstrap`, {
    credentials: 'same-origin',
  })

  if (!response.ok) {
    throw new Error(`Chat bootstrap failed with status ${response.status}`)
  }

  return parseBootstrapPayload(await response.json())
}

const loadChatBootstrapInternal = (forceReload: boolean): Promise<ChatBootstrapData> => {
  if (!forceReload && bootstrapSnapshot.status === 'ready' && bootstrapSnapshot.data) {
    return Promise.resolve(bootstrapSnapshot.data)
  }

  if (bootstrapPromise) {
    return bootstrapPromise
  }

  setBootstrapSnapshot({
    status: 'loading',
    data: null,
    error: null,
  })

  bootstrapPromise = requestChatBootstrap()
    .then((data) => {
      setBootstrapSnapshot({
        status: 'ready',
        data,
        error: null,
      })
      return data
    })
    .catch((error) => {
      const resolvedError = toError(error)
      setBootstrapSnapshot({
        status: 'error',
        data: null,
        error: resolvedError,
      })
      throw resolvedError
    })
    .finally(() => {
      bootstrapPromise = null
    })

  return bootstrapPromise
}

export const subscribeToChatBootstrap = (listener: () => void) => {
  bootstrapListeners.add(listener)
  return () => {
    bootstrapListeners.delete(listener)
  }
}

export const getChatBootstrapSnapshot = (): ChatBootstrapSnapshot => bootstrapSnapshot

export const ensureChatBootstrapLoaded = (): Promise<ChatBootstrapData> =>
  loadChatBootstrapInternal(false)

export const retryChatBootstrap = (): Promise<ChatBootstrapData> => loadChatBootstrapInternal(true)

export const useChatBootstrap = (enabled: boolean) => {
  const snapshot = useSyncExternalStore(
    subscribeToChatBootstrap,
    getChatBootstrapSnapshot,
    getChatBootstrapSnapshot
  )

  useEffect(() => {
    if (!enabled || snapshot.status !== 'idle') {
      return
    }

    void ensureChatBootstrapLoaded().catch(() => {})
  }, [enabled, snapshot.status])

  return {
    ...snapshot,
    ensureLoaded: ensureChatBootstrapLoaded,
    retry: retryChatBootstrap,
  }
}

export const resetChatBootstrapStateForTests = () => {
  bootstrapPromise = null
  setBootstrapSnapshot({
    status: 'idle',
    data: null,
    error: null,
  })
}
