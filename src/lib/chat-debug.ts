// Flag-gated tracing for the chat bootstrap -> challenge -> connect lifecycle.
// No-op in production and silent by default in dev; enable in the browser with
// `localStorage.setItem('chatDebug', '1')` (and reload) to watch state
// transitions without adding noise for anyone else.
const DEBUG_STORAGE_KEY = 'chatDebug'

const isChatDebugEnabled = (): boolean => {
  if (!import.meta.env.DEV || typeof window === 'undefined') {
    return false
  }

  try {
    return window.localStorage.getItem(DEBUG_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export const chatDebug = (scope: string, message: string, data?: unknown): void => {
  if (!isChatDebugEnabled()) {
    return
  }

  if (data === undefined) {
    console.debug(`[chat:${scope}] ${message}`)
  } else {
    console.debug(`[chat:${scope}] ${message}`, data)
  }
}
