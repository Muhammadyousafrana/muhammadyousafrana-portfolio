/* eslint-disable import/no-unresolved */
import { resumeViewModel } from '@/data/resume'
import { resetTemperatureUnitStateForTests, setTemperatureUnit } from '@/lib/temperature-unit'
import { CHAT_TOOL_NAME } from '@shared/chat-tools'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ContactFlowCard } from './ContactFlowCard'
import type { ChatToolPart } from './chat-message-utils'
import { deriveContactFlowState, type ToolRenderContext } from './contact-flow'
import { renderToolPart } from './tool-renderers'

const createContext = (overrides?: Partial<ToolRenderContext>) => ({
  contactHandoffInputs: {},
  contactHandoffInputErrors: {},
  contactHandoffSubmitNotices: {},
  pendingToolContinuations: {},
  setContactHandoffInput: mock(() => {}),
  completeContactHandoff: mock(async () => {}),
  cancelContactHandoff: mock(async () => {}),
  ...overrides,
})

const renderContactFlow = (contactParts: ChatToolPart[], context: ToolRenderContext) => {
  const state = deriveContactFlowState(contactParts, context)
  if (!state) {
    throw new Error('Expected contact flow state')
  }

  return renderToStaticMarkup(
    <div>
      <ContactFlowCard
        state={state}
        setContactHandoffInput={context.setContactHandoffInput}
        completeContactHandoff={context.completeContactHandoff}
        cancelContactHandoff={context.cancelContactHandoff}
      />
    </div>
  )
}

describe('renderContactFlow', () => {
  const contactPart = (overrides: Partial<ChatToolPart>): ChatToolPart =>
    ({
      type: `tool-${CHAT_TOOL_NAME.showContactForm}`,
      toolCallId: 'tool-1',
      state: 'input-available',
      input: {},
      ...overrides,
    }) as ChatToolPart

  it('renders labeled full-width form controls with associated validation errors', () => {
    const context = createContext({
      contactHandoffInputErrors: {
        'tool-1': {
          contactPhone: 'Enter a valid callback phone number.',
        },
      },
    })

    const markup = renderContactFlow([contactPart({})], context)

    expect(markup).toContain(`Send ${resumeViewModel.firstName} a text`)
    expect(markup).toContain('>Name</label>')
    expect(markup).toContain('>Phone</label>')
    expect(markup).toContain('Company · optional')
    expect(markup).toContain('Note · optional')
    expect(markup).toContain('+1 555 000 0123')
    expect(markup).toContain('Blank is fine')
    expect(markup).toContain('Send text')
    expect(markup).toContain('Cancel')
    expect(markup).toContain('tool-1-contact-phone-error')
    expect(markup).toContain('Enter a valid callback phone number.')
    expect(markup).toContain('aria-invalid="true"')
    // The empty preview slot holds its structure with the dashed ghost bubble.
    expect(markup).toContain('Your text shows up here as you type.')
    expect(markup).toContain('border-dashed')
    expect(markup).toContain('Sending is immediate.')
    // The old grid that wrapped the phone label is gone.
    expect(markup).not.toContain('sm:grid-cols-2')
    expect(markup).not.toContain('international numbers valid')
  })

  it('keeps every text-entry control at 16px on mobile so iOS Safari never zooms on focus', () => {
    const markup = renderContactFlow([contactPart({})], createContext())

    const classAttrs = [...markup.matchAll(/<(?:input|textarea)\b[^>]*\bclass="([^"]*)"/g)].map(
      (match) => match[1]
    )

    // 3 inputs (name/phone/company) + the note textarea.
    expect(classAttrs.length).toBe(4)
    for (const classAttr of classAttrs) {
      const classes = classAttr.split(/\s+/)
      // Mobile base size must be >= 16px, or iOS Safari zooms the page on focus.
      expect(classes).toContain('text-base')
      // No unprefixed sub-16px override (responsive md:text-sm etc. stays allowed).
      expect(classes).not.toContain('text-xs')
      expect(classes).not.toContain('text-sm')
    }
  })

  it('previews the live relay message in the green SMS bubble as details arrive', () => {
    const context = createContext({
      contactHandoffInputs: {
        'tool-1': {
          contactName: 'Jordan Lee',
          contactPhone: '+16045551234',
          contactCompany: 'Northwind Robotics',
          contactMessage: '',
        },
      },
    })

    const markup = renderContactFlow([contactPart({})], context)

    expect(markup).toContain('bg-green-700')
    // The SMS-green bubble carries the phone glyph in its bottom-right corner.
    expect(markup).toContain('lucide-phone')
    expect(markup).toContain(
      'Jordan Lee from Northwind Robotics would like to connect with you. Callback phone: 604-555-1234.'
    )
    expect(markup).not.toContain('Your text shows up here as you type.')
  })

  it('keeps the blocked/409 submit notice inside the still-open form', () => {
    const context = createContext({
      contactHandoffSubmitNotices: {
        'tool-1':
          'This contact request is already being sent. Give it about 45 seconds, then submit again.',
      },
    })

    const markup = renderContactFlow([contactPart({})], context)

    expect(markup).toContain('role="alert"')
    expect(markup).toContain(
      'This contact request is already being sent. Give it about 45 seconds, then submit again.'
    )
    // The form stays open and editable.
    expect(markup).toContain('Send text')
    expect(markup).toContain('tool-1-contact-phone')
  })

  it('keeps the contact flow in sending after form submission until delivery resolves', () => {
    const context = createContext()
    const contactParts = [
      contactPart({
        state: 'output-available',
        output: {
          contactName: 'Jordan Lee',
          contactPhone: '+16045551234',
          contactCompany: 'Northwind Robotics',
          answeredAt: '2026-03-09T12:00:00.000Z',
        },
      }),
    ]

    expect(deriveContactFlowState(contactParts, context)?.phase).toBe('sending')

    const markup = renderContactFlow(contactParts, context)

    expect(markup).toContain(`Sending to ${resumeViewModel.firstName}`)
    expect(markup).toContain('animate-spin')
    expect(markup).toContain('bg-green-700')
    expect(markup).toContain(
      'Jordan Lee from Northwind Robotics would like to connect with you. Callback phone: 604-555-1234.'
    )
  })

  it('renders the cancelled state as exactly one bare line', () => {
    const context = createContext()
    const contactParts = [
      contactPart({
        state: 'output-available',
        output: {
          cancelled: true,
          detail: 'Contact request cancelled. No text was sent.',
        },
      }),
    ]

    expect(deriveContactFlowState(contactParts, context)?.phase).toBe('cancelled')

    const markup = renderContactFlow(contactParts, context)

    expect(markup).toContain('Contact request cancelled — nothing was sent.')
    expect((markup.match(/<p\b/g) ?? []).length).toBe(1)
    // No card chrome, no bubble, no spinner.
    expect(markup).not.toContain('rounded-xl')
    expect(markup).not.toContain('bg-green-700')
    expect(markup).not.toContain('animate-spin')
  })

  it('renders the cancelling state as one busy line', () => {
    const context = createContext({
      pendingToolContinuations: { 'tool-1': 'handoff-cancel' },
    })
    const contactParts = [contactPart({})]

    const state = deriveContactFlowState(contactParts, context)
    expect(state?.phase).toBe('sending')
    expect(state?.pendingAction).toBe('cancel')

    const markup = renderContactFlow(contactParts, context)

    expect(markup).toContain('Cancelling…')
    expect(markup).toContain('animate-spin')
    expect((markup.match(/<p\b/g) ?? []).length).toBe(1)
    expect(markup).not.toContain('rounded-xl')
  })

  it('shows the delivery receipt with the formatted callback phone once sent', () => {
    const context = createContext()
    const contactParts = [
      contactPart({
        state: 'output-available',
        output: {
          contactName: 'Jordan Lee',
          contactPhone: '+16045551234',
          answeredAt: '2026-03-09T12:00:00.000Z',
          status: 'sent',
          detail: 'Text sent.',
          preview: 'Jordan Lee would like to connect with you. Callback phone: 604-555-1234.',
        },
      }),
    ]

    expect(deriveContactFlowState(contactParts, context)?.phase).toBe('sent')

    const markup = renderContactFlow(contactParts, context)

    expect(markup).toContain(
      `Delivered · ${resumeViewModel.firstName} will text or call you back at 604-555-1234`
    )
    expect(markup).toContain('text-emerald-700')
    expect(markup).toContain('dark:text-emerald-400')
    expect(markup).toContain('bg-green-700')
    expect(markup).toContain(
      'Jordan Lee would like to connect with you. Callback phone: 604-555-1234.'
    )
    expect(markup).not.toContain('animate-spin')
  })

  it('ends on an explicit simulated terminal state with the preview intact', () => {
    const context = createContext()
    const contactParts = [
      contactPart({
        state: 'output-available',
        output: {
          contactName: 'James',
          contactPhone: '+11234567890',
          contactCompany: 'Hi',
          answeredAt: '2026-03-09T12:00:00.000Z',
          status: 'simulated',
          detail: 'Text handoff ran in simulation mode. No live message was sent.',
          preview: 'James from Hi would like to connect with you. Callback phone: 123-456-7890.',
        },
      }),
    ]

    expect(deriveContactFlowState(contactParts, context)?.phase).toBe('simulated')

    const markup = renderContactFlow(contactParts, context)

    expect(markup).toContain('Simulated · demo mode, no real text was sent')
    expect(markup).toContain(
      'James from Hi would like to connect with you. Callback phone: 123-456-7890.'
    )
    expect(markup).toContain('text-emerald-700')
  })

  it('renders blocked delivery as the failed receipt under the same bubble anatomy', () => {
    const context = createContext()
    const contactParts = [
      contactPart({
        state: 'output-available',
        output: {
          contactName: 'James',
          contactPhone: '+11234567890',
          answeredAt: '2026-03-09T12:00:00.000Z',
          status: 'blocked',
          detail: 'Callback phone must be a valid phone number.',
          preview: 'James would like to connect with you. Callback phone: 123-456-7890.',
        },
      }),
    ]

    expect(deriveContactFlowState(contactParts, context)?.phase).toBe('failed')

    const markup = renderContactFlow(contactParts, context)

    // Same bubble anatomy as sending/sent, one destructive receipt line.
    expect(markup).toContain('bg-green-700')
    expect(markup).toContain('James would like to connect with you. Callback phone: 123-456-7890.')
    expect(markup).toContain(
      'send · Callback phone must be a valid phone number. Ask me to try again.'
    )
    expect(markup).toContain('text-destructive')
    expect(markup).toContain('role="alert"')
  })

  it('treats unknown delivery status as failed instead of leaving the flow busy', () => {
    const context = createContext()
    const contactParts = [
      contactPart({
        state: 'output-available',
        output: {
          contactName: 'James',
          contactPhone: '+11234567890',
          answeredAt: '2026-03-09T12:00:00.000Z',
          status: 'queued',
          preview: 'James would like to connect with you. Callback phone: 123-456-7890.',
        },
      }),
    ]

    expect(deriveContactFlowState(contactParts, context)?.phase).toBe('failed')

    const markup = renderContactFlow(contactParts, context)

    expect(markup).toContain('send · The contact request returned an unknown delivery status.')
    expect(markup).toContain('role="alert"')
    expect(markup).not.toContain('animate-spin')
  })

  it('keeps the failed anatomy when the relay message is unavailable after rehydration', () => {
    // A rehydrated output-error part has no output and the local form inputs
    // are gone, so there is no relay message to show in the bubble.
    const context = createContext()
    const contactParts = [
      contactPart({
        state: 'output-error',
        errorText: 'The SMS bridge rejected the request.',
      }),
    ]

    expect(deriveContactFlowState(contactParts, context)?.phase).toBe('failed')

    const markup = renderContactFlow(contactParts, context)

    expect(markup).toContain('Message unavailable.')
    expect(markup).not.toContain('Your text shows up here as you type.')
    expect(markup).toContain('send · The SMS bridge rejected the request. Ask me to try again.')
    expect(markup).toContain('role="alert"')
  })
})

describe('renderToolPart — weather', () => {
  const weatherPart = (overrides: Partial<ChatToolPart>): ChatToolPart =>
    ({
      type: `tool-${CHAT_TOOL_NAME.getWeather}`,
      toolCallId: 'tool-3',
      state: 'output-available',
      input: { location: 'Vancouver' },
      ...overrides,
    }) as ChatToolPart

  const renderWeather = (overrides: Partial<ChatToolPart>) =>
    renderToStaticMarkup(<div>{renderToolPart(weatherPart(overrides))}</div>)

  // The unit store is module-level and shared across test files (bun runs one
  // process); re-derive it (no storage, no en-US locale here → °C) every test.
  beforeEach(() => {
    resetTemperatureUnitStateForTests()
  })

  it('renders the bare-degree hero with wind and humidity unpacked from the condition', () => {
    const markup = renderWeather({
      output: {
        resolvedLocation: 'Vancouver, BC',
        temperature: 28.7,
        condition: 'Clear sky, wind 14.3 km/h',
        humidity: 62,
      },
    })

    expect(markup).toContain('Vancouver, BC')
    expect(markup).toContain('text-5xl')
    // Bare degree: no unit letter glued to the numeral — the unit lives in the toggle.
    expect(markup).toContain('29°</p>')
    expect(markup).toContain('Clear sky')
    expect(markup).toContain('Wind 14 km/h · Humidity 62%')
    // No header chrome: no tool title, no status pill.
    expect(markup).not.toContain('>Weather<')
    expect(markup).not.toContain('Done')
  })

  it('renders the °F/°C toggle as real buttons with the active unit pressed', () => {
    const markup = renderWeather({
      output: {
        resolvedLocation: 'Vancouver, BC',
        temperature: 28.7,
        condition: 'Clear sky, wind 14.3 km/h',
        humidity: 62,
      },
    })

    expect(markup).toContain('aria-label="Temperature unit"')
    expect(markup).toContain('°F')
    expect(markup).toContain('°C')
    // Active segment: pressed + primary-filled (a luminance change, not
    // color-only); inactive stays unpressed.
    expect(markup).toContain('aria-pressed="true" aria-label="Celsius"')
    expect(markup).toContain('aria-pressed="false" aria-label="Fahrenheit"')
    expect(markup).toContain('bg-primary')
    // (WeatherCard.test.tsx asserts in a real DOM that the toggle sits outside
    // the aria-hidden visual layer.)
  })

  it('converts the whole card to Fahrenheit when that unit is active', () => {
    setTemperatureUnit('F')

    const markup = renderWeather({
      output: {
        resolvedLocation: 'Vancouver, BC',
        temperature: 28.7,
        condition: 'Clear sky, wind 14.3 km/h',
        humidity: 62,
      },
    })

    // 28.7°C = 83.66°F → 84° at whole-degree rounding, 83.7 for the sr reading.
    expect(markup).toContain('84°</p>')
    expect(markup).not.toContain('29°')
    expect(markup).toContain('83.7 degrees Fahrenheit')
    expect(markup).toContain('aria-pressed="true" aria-label="Fahrenheit"')
    expect(markup).toContain('aria-pressed="false" aria-label="Celsius"')
  })

  it('keeps the exact values in the live screen-reader sentence while the visual layer rounds', () => {
    const markup = renderWeather({
      output: {
        resolvedLocation: 'Vancouver, BC',
        temperature: 28.7,
        condition: 'Clear sky, wind 14.3 km/h',
        humidity: 62,
      },
    })

    expect(markup).toContain(
      'Current weather in Vancouver, BC: 28.7 degrees Celsius, Clear sky, wind 14.3 kilometres per hour, humidity 62 percent.'
    )
    expect(markup).toContain('sr-only')
    // A unit flip re-renders the sentence in the new unit and announces it.
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('aria-atomic="true"')
    expect(markup).toContain('aria-hidden="true"')
  })

  it('speaks whole-number temperatures with an explicit decimal in either unit', () => {
    const output = {
      resolvedLocation: 'Vancouver, BC',
      temperature: 10,
      condition: 'Overcast, wind 8 km/h',
      humidity: 70,
    }

    expect(renderWeather({ output })).toContain('10.0 degrees Celsius')

    setTemperatureUnit('F')
    // 10°C is exactly 50°F; the spoken value keeps the fixed decimal.
    expect(renderWeather({ output })).toContain('50.0 degrees Fahrenheit')
  })

  it.each([
    ['Clear sky', 'lucide-sun ', 'text-amber-500', 'dark:text-amber-400', 'from-amber-500/15'],
    [
      'Mainly clear',
      'lucide-cloud-sun',
      'text-amber-500',
      'dark:text-amber-400',
      'from-amber-500/15',
    ],
    [
      'Partly cloudy',
      'lucide-cloud-sun',
      'text-amber-500',
      'dark:text-amber-400',
      'from-amber-500/15',
    ],
    // Overcast is chromatic indigo on purpose: a gray wash on the gray chat
    // background was invisible.
    ['Overcast', 'lucide-cloud ', 'text-indigo-500', 'dark:text-indigo-400', 'from-indigo-500/10'],
    ['Fog', 'lucide-cloud-fog', 'text-slate-500', 'dark:text-slate-400', 'from-slate-500/10'],
    ['Slight rain', 'lucide-cloud-rain', 'text-sky-600', 'dark:text-sky-400', 'from-sky-600/10'],
    // Order matters: snow showers must not fall through to the rain glyph.
    [
      'Slight snow showers',
      'lucide-cloud-snow',
      'text-sky-500',
      'dark:text-sky-300',
      'from-sky-500/10',
    ],
    [
      'Thunderstorm',
      'lucide-cloud-lightning',
      'text-violet-600',
      'dark:text-violet-400',
      'from-violet-600/10',
    ],
  ])(
    'renders the tinted glyph and wash for %s',
    (condition, glyphClass, tintClass, darkClass, washClass) => {
      const markup = renderWeather({
        output: {
          resolvedLocation: 'Somewhere',
          temperature: 3.2,
          condition: `${condition}, wind 6 km/h`,
          humidity: 80,
        },
      })

      expect(markup).toContain(glyphClass)
      expect(markup).toContain(tintClass)
      expect(markup).toContain(darkClass)
      // The condition wash is a corner gradient over bg-card, dark-paired, never a scene.
      expect(markup).toContain('bg-gradient-to-bl')
      expect(markup).toContain(washClass)
      expect(markup).toContain('dark:from-')
    }
  )

  it('omits the provenance suffix for resolved locations', () => {
    const markup = renderWeather({
      output: {
        resolvedLocation: 'Vancouver, BC',
        temperature: 12.1,
        condition: 'Overcast, wind 8 km/h',
        humidity: 70,
        source: 'location',
      },
    })

    expect(markup).not.toContain('· default')
  })

  it('mirrors the success anatomy while the lookup runs, with a shimmer sweep', () => {
    const markup = renderWeather({ state: 'input-available' })

    expect(markup).toContain('Checking — Vancouver')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('––°')
    // Same slots as the final card: unit toggle, glyph placeholder, condition
    // and meta bars — data lands without a layout jump.
    expect(markup).toContain('aria-label="Temperature unit"')
    expect(markup).toContain('h-9 w-9')
    // Shimmer sweep: decorative, click-through, gone under reduced motion.
    expect(markup).toContain('animate-shimmer')
    expect(markup).toContain('motion-reduce:hidden')
    expect(markup).toContain('pointer-events-none')
    expect(markup).not.toContain('animate-pulse')
  })

  it('renders the error state for a failed lookup, showing the message verbatim', () => {
    const markup = renderWeather({
      state: 'output-error',
      errorText: 'Weather lookup failed.',
    })

    expect(markup).toContain('get the weather')
    expect(markup).toContain('text-destructive')
    expect(markup).toContain('Weather lookup failed.')
    // The card no longer bolts a blanket "ask again" onto every failure.
    expect(markup).not.toContain('Ask again in a moment.')
  })

  it('renders the error state when the result carries an error field', () => {
    const markup = renderWeather({
      output: { error: 'Weather data is unavailable for that location right now.' },
    })

    expect(markup).toContain('get the weather')
    expect(markup).toContain('Weather data is unavailable for that location right now.')
  })

  it('shows a lookup-miss message as-is without appending bogus retry advice', () => {
    const missCopy =
      'Couldn’t find weather for “Atlantisburg”. Try a nearby city, or add the country (e.g. “Paris, France”).'
    const markup = renderWeather({ output: { error: missCopy } })

    expect(markup).toContain('Try a nearby city')
    expect(markup).not.toContain('Ask again in a moment.')
    expect(markup).not.toContain('try again')
  })

  it('falls back to a complete, self-punctuated line when no message is present', () => {
    const markup = renderWeather({ output: {} })

    expect(markup).toContain('get the weather')
    expect(markup).toContain('The weather service didn’t answer. Please try again in a moment.')
    expect(markup).not.toContain('answer. Please try again in a moment. Ask again')
  })

  it('renders the error state for a denied execution', () => {
    const markup = renderWeather({ state: 'output-denied' })

    expect(markup).toContain('get the weather')
    expect(markup).toContain('Execution denied')
  })

  it('degrades a done result with no temperature to the error layout instead of 0°', () => {
    const markup = renderWeather({
      output: { resolvedLocation: 'Vancouver, BC' },
    })

    expect(markup).toContain('get the weather')
    expect(markup).not.toContain('0°')
  })
})

describe('renderToolPart — unknown tools', () => {
  it('renders unknown tools through the generic chip', () => {
    const part = {
      type: 'tool-mystery_tool',
      toolCallId: 'tool-9',
      state: 'output-available',
      input: {},
      output: {},
    } as ChatToolPart

    const markup = renderToStaticMarkup(<div>{renderToolPart(part)}</div>)

    expect(markup).toContain('mystery_tool')
    expect(markup).toContain('Completed mystery_tool')
    expect(markup).toContain('Done')
  })
})
