/* eslint-disable import/no-unresolved */
import type { UIMessage } from 'ai'
import { describe, expect, it, mock } from 'bun:test'
import { CHAT_TOOL_NAME } from '../shared/chat-tools'

mock.module('cloudflare:email', () => ({
  EmailMessage: class EmailMessage {},
}))

mock.module('cloudflare:workers', () => ({
  DurableObject: class DurableObject {},
  env: {},
}))

const { buildLocalChatTools } = await import('./chat-tools')
const { safeValidateChatMessages } = await import('./chat-message-validation')

const tools = buildLocalChatTools({
  toolExecutionContext: {},
})

describe('safeValidateChatMessages', () => {
  it('accepts a valid show_contact_form output at the runtime seam', async () => {
    const messages = [
      {
        id: 'msg-1',
        role: 'assistant' as const,
        parts: [
          {
            type: `tool-${CHAT_TOOL_NAME.showContactForm}`,
            toolCallId: 'tool-1',
            state: 'output-available' as const,
            input: {},
            output: {
              contactName: 'Jordan Lee',
              contactPhone: '+16045551234',
              contactCompany: 'Northwind Robotics',
              answeredAt: '2026-03-07T12:00:00.000Z',
            },
          },
        ],
      },
    ] satisfies UIMessage[]

    const result = await safeValidateChatMessages({ messages, tools })

    expect(result.success).toBe(true)
    if (result.success === false) {
      throw result.error
    }

    expect(result.data).toEqual(messages)
  })

  it('rejects malformed show_contact_form output before model conversion', async () => {
    const messages = [
      {
        id: 'msg-1',
        role: 'assistant' as const,
        parts: [
          {
            type: `tool-${CHAT_TOOL_NAME.showContactForm}`,
            toolCallId: 'tool-1',
            state: 'output-available' as const,
            input: {},
            output: {
              contactName: 'Jordan Lee',
              contactPhone: '+1 604 555 1234 ext 99',
              answeredAt: '2026-03-07T12:00:00.000Z',
            },
          },
        ],
      },
    ] satisfies UIMessage[]

    const result = await safeValidateChatMessages({ messages, tools })

    expect(result.success).toBe(false)
    if (result.success !== false) {
      throw new Error('Expected validation failure')
    }

    expect(result.error.message).toContain('Callback phone must be a valid phone number.')
  })

  it('accepts a descriptive cancelled show_contact_form output at the runtime seam', async () => {
    const messages = [
      {
        id: 'msg-1',
        role: 'assistant' as const,
        parts: [
          {
            type: `tool-${CHAT_TOOL_NAME.showContactForm}`,
            toolCallId: 'tool-1',
            state: 'output-available' as const,
            input: {},
            output: {
              cancelled: true,
              detail: 'Contact request cancelled. No text was sent.',
            },
          },
        ],
      },
    ] satisfies UIMessage[]

    const result = await safeValidateChatMessages({ messages, tools })

    expect(result.success).toBe(true)
  })

  it('keeps accepting legacy bare cancelled show_contact_form output at the runtime seam', async () => {
    const messages = [
      {
        id: 'msg-1',
        role: 'assistant' as const,
        parts: [
          {
            type: `tool-${CHAT_TOOL_NAME.showContactForm}`,
            toolCallId: 'tool-1',
            state: 'output-available' as const,
            input: {},
            output: {
              cancelled: true,
            },
          },
        ],
      },
    ] satisfies UIMessage[]

    const result = await safeValidateChatMessages({ messages, tools })

    expect(result.success).toBe(true)
  })

  it('rejects unknown tool parts when no runtime tool schema exists', async () => {
    const messages = [
      {
        id: 'msg-1',
        role: 'assistant' as const,
        parts: [
          {
            type: 'tool-unknown_tool',
            toolCallId: 'tool-1',
            state: 'input-available' as const,
            input: {},
          },
        ],
      },
    ] satisfies UIMessage[]

    const result = await safeValidateChatMessages({ messages, tools })

    expect(result.success).toBe(false)
    if (result.success !== false) {
      throw new Error('Expected validation failure')
    }

    expect(result.error.message).toContain('No tool schema found for tool part unknown_tool')
  })

  it('rejects prototype tool keys when no runtime tool schema exists', async () => {
    const messages = [
      {
        id: 'msg-1',
        role: 'assistant' as const,
        parts: [
          {
            type: 'tool-constructor',
            toolCallId: 'tool-1',
            state: 'output-error' as const,
            input: undefined,
            errorText: 'Tool execution failed.',
          },
        ],
      },
    ] satisfies UIMessage[]

    const result = await safeValidateChatMessages({ messages, tools })

    expect(result.success).toBe(false)
    if (result.success !== false) {
      throw new Error('Expected validation failure')
    }

    expect(result.error.message).toContain('No tool schema found for tool part constructor')
  })
})
