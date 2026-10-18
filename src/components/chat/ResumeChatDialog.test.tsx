/* eslint-disable import/no-unresolved */
import { resumeViewModel } from '@/data/resume'
import { CHAT_TOOL_NAME } from '@shared/chat-tools'
import { describe, expect, it, mock } from 'bun:test'
import type { ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AssistantMessageContent } from './ResumeChatDialog'

const createContext = (overrides?: Partial<ComponentProps<typeof AssistantMessageContent>>) => ({
  latestAssistantMessageId: null,
  isChatErrored: false,
  message: {
    id: 'msg-1',
    role: 'assistant' as const,
    parts: [],
  },
  contactHandoffInputs: {},
  contactHandoffInputErrors: {},
  contactHandoffSubmitNotices: {},
  pendingToolContinuations: {},
  setContactHandoffInput: mock(() => {}),
  completeContactHandoff: mock(async () => {}),
  cancelContactHandoff: mock(async () => {}),
  ...overrides,
})

describe('AssistantMessageContent', () => {
  it('renders assistant markdown even when contact tool parts exist on the same message', () => {
    const markup = renderToStaticMarkup(
      <AssistantMessageContent
        {...createContext({
          message: {
            id: 'msg-1',
            role: 'assistant',
            parts: [
              {
                type: `tool-${CHAT_TOOL_NAME.showContactForm}`,
                toolCallId: 'tool-2',
                state: 'output-available',
                input: {},
                output: {
                  contactName: 'Jordan Lee',
                  contactPhone: '+16045551234',
                  answeredAt: '2026-03-09T12:00:00.000Z',
                  status: 'simulated',
                  detail: 'Text handoff ran in simulation mode. No live message was sent.',
                  preview:
                    'Jordan Lee would like to connect with you. Callback phone: 604-555-1234.',
                },
              },
              {
                type: 'text',
                text: 'I also highlighted a likely fit gap around production firmware validation.',
              },
            ],
          },
        })}
      />
    )

    expect(markup).toContain('Simulated · demo mode, no real text was sent')
    expect(markup).toContain(
      'I also highlighted a likely fit gap around production firmware validation.'
    )
  })

  it('keeps the drafting indicator visible for a streaming assistant message that already has tool parts', () => {
    const markup = renderToStaticMarkup(
      <AssistantMessageContent
        {...createContext({
          latestAssistantMessageId: 'msg-1',
          message: {
            id: 'msg-1',
            role: 'assistant',
            metadata: {},
            parts: [
              {
                type: `tool-${CHAT_TOOL_NAME.showContactForm}`,
                toolCallId: 'tool-1',
                state: 'output-available',
                input: {},
                output: {
                  contactName: 'Jordan Lee',
                  contactPhone: '+16045551234',
                  answeredAt: '2026-03-07T12:00:00.000Z',
                },
              },
            ],
          },
        })}
      />
    )

    expect(markup).toContain(`Sending to ${resumeViewModel.firstName}`)
    expect(markup).toContain('Drafting response...')
    expect(markup).toContain('animate-spin')
  })

  it('renders a tool-only assistant bubble without a leading divider', () => {
    const markup = renderToStaticMarkup(
      <AssistantMessageContent
        {...createContext({
          message: {
            id: 'msg-1',
            role: 'assistant',
            parts: [
              {
                type: `tool-${CHAT_TOOL_NAME.getWeather}`,
                toolCallId: 'tool-w1',
                state: 'output-available',
                input: { location: 'Vancouver' },
                output: {
                  resolvedLocation: 'Vancouver, BC',
                  temperature: 12.3,
                  condition: 'Overcast, wind 8 km/h',
                  humidity: 70,
                },
              },
            ],
          },
        })}
      />
    )

    expect(markup).toContain('12°')
    expect(markup).not.toContain('border-t')
  })

  it('draws one divider before the cards, none above drafting, while a tool-only reply streams', () => {
    const markup = renderToStaticMarkup(
      <AssistantMessageContent
        {...createContext({
          latestAssistantMessageId: 'msg-1',
          message: {
            id: 'msg-1',
            role: 'assistant',
            parts: [
              {
                type: `tool-${CHAT_TOOL_NAME.getWeather}`,
                toolCallId: 'tool-w1',
                state: 'input-available',
                input: { location: 'Vancouver' },
              },
            ],
          },
        })}
      />
    )

    expect(markup).toContain('Drafting response...')
    expect((markup.match(/border-t/g) ?? []).length).toBe(1)
    // The drafting line opens the bubble; the divider belongs to the card below.
    expect(markup.indexOf('Drafting response...')).toBeLessThan(markup.indexOf('border-t'))
  })

  it('keeps the divider between message text and a following tool card', () => {
    const markup = renderToStaticMarkup(
      <AssistantMessageContent
        {...createContext({
          message: {
            id: 'msg-1',
            role: 'assistant',
            parts: [
              { type: 'text', text: 'Here is the current weather.' },
              {
                type: `tool-${CHAT_TOOL_NAME.getWeather}`,
                toolCallId: 'tool-w1',
                state: 'output-available',
                input: { location: 'Vancouver' },
                output: {
                  resolvedLocation: 'Vancouver, BC',
                  temperature: 12.3,
                  condition: 'Overcast, wind 8 km/h',
                  humidity: 70,
                },
              },
            ],
          },
        })}
      />
    )

    expect(markup).toContain('Here is the current weather.')
    expect(markup).toContain('border-t')
  })

  it('does not keep the drafting indicator after a terminal contact result', () => {
    const markup = renderToStaticMarkup(
      <AssistantMessageContent
        {...createContext({
          latestAssistantMessageId: 'msg-1',
          message: {
            id: 'msg-1',
            role: 'assistant',
            metadata: {},
            parts: [
              {
                type: `tool-${CHAT_TOOL_NAME.showContactForm}`,
                toolCallId: 'tool-2',
                state: 'output-available',
                input: {},
                output: {
                  contactName: 'Jordan Lee',
                  contactPhone: '+16045551234',
                  answeredAt: '2026-03-09T12:00:00.000Z',
                  status: 'simulated',
                  detail: 'Text handoff ran in simulation mode. No live message was sent.',
                  preview:
                    'Jordan Lee would like to connect with you. Callback phone: 604-555-1234.',
                },
              },
            ],
          },
        })}
      />
    )

    expect(markup).toContain('Simulated · demo mode, no real text was sent')
    expect(markup).not.toContain('Drafting response...')
  })
})
