import { useSyncExternalStore } from 'react'

export type TemperatureUnit = 'C' | 'F'

const TEMPERATURE_UNIT_STORAGE_KEY = 'weather-temperature-unit'

const readStoredUnit = (): TemperatureUnit | null => {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(TEMPERATURE_UNIT_STORAGE_KEY)
    return raw === 'C' || raw === 'F' ? raw : null
  } catch {
    // Blocked storage (private mode, quota): fall through to the locale default.
    return null
  }
}

// °F only for the one locale that expects it; everyone else reads Celsius.
const localeDefaultUnit = (): TemperatureUnit =>
  typeof navigator !== 'undefined' && navigator.language?.toLowerCase() === 'en-us' ? 'F' : 'C'

const readInitialUnit = (): TemperatureUnit => readStoredUnit() ?? localeDefaultUnit()

// Module-level store (same pattern as chat-bootstrap.ts) so every weather card
// in the session shares one unit and re-renders when any card's toggle flips.
let temperatureUnit: TemperatureUnit = readInitialUnit()
const unitListeners = new Set<() => void>()

export const subscribeToTemperatureUnit = (listener: () => void) => {
  unitListeners.add(listener)
  return () => {
    unitListeners.delete(listener)
  }
}

export const getTemperatureUnit = (): TemperatureUnit => temperatureUnit

export const setTemperatureUnit = (next: TemperatureUnit): void => {
  if (next === temperatureUnit) {
    return
  }
  temperatureUnit = next
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(TEMPERATURE_UNIT_STORAGE_KEY, next)
    } catch {
      // Storage quota or access issues: the preference holds in memory only.
    }
  }
  for (const listener of unitListeners) {
    listener()
  }
}

// The same getter serves as the server snapshot so static rendering works.
export const useTemperatureUnit = (): TemperatureUnit =>
  useSyncExternalStore(subscribeToTemperatureUnit, getTemperatureUnit, getTemperatureUnit)

export const celsiusToFahrenheit = (celsius: number): number => (celsius * 9) / 5 + 32

/** Re-reads storage and locale, exactly like a fresh module load. */
export const resetTemperatureUnitStateForTests = (): void => {
  const next = readInitialUnit()
  if (next === temperatureUnit) {
    return
  }
  temperatureUnit = next
  // Notify: tests may reset while cards are still mounted, and a stale
  // useSyncExternalStore snapshot would tear.
  for (const listener of unitListeners) {
    listener()
  }
}
