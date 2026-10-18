/* eslint-disable import/no-unresolved */
import {
  getTemperatureUnit,
  resetTemperatureUnitStateForTests,
  setTemperatureUnit,
} from '@/lib/temperature-unit'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { WeatherCard } from './WeatherCard'

// ---------------------------------------------------------------------------
// The °F/°C toggle needs real clicks against a shared module-level store, so
// happy-dom is registered for this file only and unregistered afterwards (bun
// runs all test files in one process). happy-dom's navigator.language is
// "en-US", which doubles as the fixture for the locale-default branch.
// ---------------------------------------------------------------------------

let createRoot: typeof import('react-dom/client').createRoot

beforeAll(async () => {
  GlobalRegistrator.register()
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  // react-dom/client must be imported after the DOM globals exist.
  ;({ createRoot } = await import('react-dom/client'))
})

afterAll(async () => {
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT
  await GlobalRegistrator.unregister()
  // The store must not leak this file's unit into later test files.
  resetTemperatureUnitStateForTests()
})

let root: Root | null = null
let container: HTMLElement | null = null

const mount = async (ui: React.ReactNode) => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(ui)
  })
  return container
}

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount()
    })
    root = null
  }
  container?.remove()
  container = null
  window.localStorage.clear()
  resetTemperatureUnitStateForTests()
})

const DONE_PROPS = {
  state: 'done',
  location: 'Vancouver, BC',
  temperature: 28.7,
  condition: 'Clear sky, wind 14.3 km/h',
  humidity: 62,
} as const

const heroTexts = (el: HTMLElement) =>
  [...el.querySelectorAll('.text-5xl')].map((node) => node.textContent)

const pressedLabels = (el: HTMLElement) =>
  [...el.querySelectorAll('button[aria-pressed="true"]')].map((node) =>
    node.getAttribute('aria-label')
  )

describe('WeatherCard temperature unit', () => {
  it('defaults to Fahrenheit under an en-US locale with nothing persisted', () => {
    window.localStorage.clear()
    resetTemperatureUnitStateForTests()

    expect(navigator.language).toBe('en-US')
    expect(getTemperatureUnit()).toBe('F')
  })

  it('lets a persisted preference beat the locale default', () => {
    window.localStorage.setItem('weather-temperature-unit', 'C')
    resetTemperatureUnitStateForTests()

    expect(getTemperatureUnit()).toBe('C')
  })

  it('ignores a corrupted persisted value and falls back to the locale default', () => {
    window.localStorage.setItem('weather-temperature-unit', 'kelvin')
    resetTemperatureUnitStateForTests()

    expect(getTemperatureUnit()).toBe('F')
  })

  it('converts every mounted card on one click and persists the choice', async () => {
    setTemperatureUnit('C')
    const el = await mount(
      <>
        <WeatherCard {...DONE_PROPS} />
        <WeatherCard {...DONE_PROPS} location="Toronto, ON" temperature={-3.4} />
      </>
    )

    expect(heroTexts(el)).toEqual(['29°', '-3°'])
    expect(pressedLabels(el)).toEqual(['Celsius', 'Celsius'])

    const fahrenheitButton = el.querySelector<HTMLButtonElement>('button[aria-label="Fahrenheit"]')
    await act(async () => {
      fahrenheitButton?.click()
    })

    // One toggle drives both cards through the shared store.
    // 28.7°C → 83.66°F → 84°; -3.4°C → 25.88°F → 26°.
    expect(heroTexts(el)).toEqual(['84°', '26°'])
    expect(pressedLabels(el)).toEqual(['Fahrenheit', 'Fahrenheit'])
    expect(window.localStorage.getItem('weather-temperature-unit')).toBe('F')
  })

  it('re-renders the live screen-reader sentence in the active unit', async () => {
    setTemperatureUnit('C')
    const el = await mount(<WeatherCard {...DONE_PROPS} />)

    const srSentence = () => el.querySelector('[aria-live="polite"]')?.textContent ?? ''
    expect(srSentence()).toContain('28.7 degrees Celsius')

    await act(async () => {
      el.querySelector<HTMLButtonElement>('button[aria-label="Fahrenheit"]')?.click()
    })

    expect(srSentence()).toContain('83.7 degrees Fahrenheit')
    expect(srSentence()).not.toContain('Celsius')
  })

  it('keeps the numeral a bare degree and the toggle outside the aria-hidden layer', async () => {
    setTemperatureUnit('C')
    const el = await mount(<WeatherCard {...DONE_PROPS} />)

    expect(el.querySelector('.text-5xl')?.textContent).toBe('29°')
    // Interactive buttons hidden from AT would be a dead control.
    expect(el.querySelector('[aria-hidden="true"] button')).toBeNull()
    expect(el.querySelectorAll('button[aria-pressed]').length).toBe(2)
  })

  it('still flips the unit in memory when localStorage writes throw', async () => {
    setTemperatureUnit('C')
    const brokenStorage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {},
      clear: () => {},
    }
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', { value: brokenStorage, configurable: true })

    try {
      const el = await mount(<WeatherCard {...DONE_PROPS} />)
      await act(async () => {
        el.querySelector<HTMLButtonElement>('button[aria-label="Fahrenheit"]')?.click()
      })

      expect(heroTexts(el)).toEqual(['84°'])
      // And a fresh init with unreadable storage falls back to the locale default.
      resetTemperatureUnitStateForTests()
      expect(getTemperatureUnit()).toBe('F')
    } finally {
      if (descriptor) {
        Object.defineProperty(window, 'localStorage', descriptor)
      }
    }
  })

  it('shows the interactive toggle in the loading skeleton with the shimmer sweep', async () => {
    setTemperatureUnit('C')
    const el = await mount(<WeatherCard state="running" location="Vancouver" />)

    expect(el.querySelectorAll('button[aria-pressed]').length).toBe(2)
    // role="status" wraps only the checking text, never the buttons.
    expect(el.querySelector('[role="status"] button')).toBeNull()
    const shimmer = el.querySelector('.animate-shimmer')
    expect(shimmer).not.toBeNull()
    // Decorative, click-through, and removed entirely under reduced motion.
    expect(shimmer?.className).toContain('pointer-events-none')
    expect(shimmer?.className).toContain('motion-reduce:hidden')
    expect(shimmer?.getAttribute('aria-hidden')).toBe('true')
  })
})
