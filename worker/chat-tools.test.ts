/* eslint-disable import/no-unresolved */
import { convertToModelMessages, type UIMessage } from 'ai'
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

const tools = buildLocalChatTools({
  toolExecutionContext: {},
})

const toModelMessages = (messages: UIMessage[]) =>
  convertToModelMessages(
    messages.map(({ id: _id, ...message }) => message),
    { tools }
  )

describe('buildLocalChatTools', () => {
  it('exposes inputSchema for all chat tools', () => {
    expect(Object.keys(tools).sort()).toEqual([
      CHAT_TOOL_NAME.getWeather,
      CHAT_TOOL_NAME.showContactForm,
    ])

    for (const toolName of Object.keys(tools)) {
      const tool = tools[toolName as keyof typeof tools] as Record<string, unknown>
      expect('inputSchema' in tool).toBe(true)
      expect('parameters' in tool).toBe(false)
    }
  })

  it('keeps the contact tool description free of private-number internals', () => {
    const showContactForm = tools[CHAT_TOOL_NAME.showContactForm] as Record<string, unknown>

    expect(showContactForm.description).not.toContain('destination number')
    expect(showContactForm.description).not.toContain('Twilio')
    expect(showContactForm.description).not.toContain('CONTACT_SMS_TO_NUMBER')
  })

  it('describes contact-form lifecycle and drops the empty input-example trailer', () => {
    const showContactForm = tools[CHAT_TOOL_NAME.showContactForm] as Record<string, unknown>
    const description = String(showContactForm.description)

    expect(description).toContain('contact form')
    expect(description).toContain('submits or cancels')
    expect(description).toContain('describe it literally')
    // The empty-input tool carried `inputExamples`, which serialized a noisy
    // `Valid input examples: {}` trailer via addToolInputExamplesMiddleware.
    expect('inputExamples' in showContactForm).toBe(false)
    expect(description).not.toContain('Valid input examples')
  })
})

describe('show_contact_form UI messages', () => {
  it('validate and convert cleanly after the form returns a descriptive cancelled result', async () => {
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

    const modelMessages = await toModelMessages(messages)
    const serializedMessages = JSON.stringify(modelMessages)
    expect(serializedMessages).toContain('tool-result')
    expect(serializedMessages).toContain('No text was sent')
  })

  it('validate and convert cleanly after the handoff resolves with delivery status', async () => {
    const showContactForm = tools[CHAT_TOOL_NAME.showContactForm] as Record<string, unknown>
    const outputSchema = showContactForm.outputSchema as {
      safeParse: (value: unknown) => { success: boolean; data?: Record<string, unknown> }
    }
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
              answeredAt: '2026-03-09T12:00:00.000Z',
              status: 'simulated',
              detail: 'Simulated dispatch only.',
              preview: 'Jordan Lee from Northwind Robotics would like to connect with you.',
            },
          },
        ],
      },
    ] satisfies UIMessage[]

    const parsed = outputSchema.safeParse(messages[0].parts[0].output)
    expect(parsed.success).toBe(true)
    if (!parsed.success) {
      throw new Error('Expected resolved handoff output to parse')
    }

    expect(parsed.data.status).toBe('simulated')
    expect(parsed.data.detail).toBe('Simulated dispatch only.')
    expect(parsed.data.preview).toBe(
      'Jordan Lee from Northwind Robotics would like to connect with you.'
    )

    const modelMessages = await toModelMessages(messages)
    expect(JSON.stringify(modelMessages)).toContain('simulated')
  })

  it('rejects malformed recruiter phone values at the tool boundary', async () => {
    const showContactForm = tools[CHAT_TOOL_NAME.showContactForm] as Record<string, unknown>
    const outputSchema = showContactForm.outputSchema as {
      safeParse: (value: unknown) => { success: boolean }
    }

    const parsed = outputSchema.safeParse({
      contactName: 'Jordan Lee',
      contactPhone: '+1 604 555 1234 ext 99',
      answeredAt: '2026-03-09T12:00:00.000Z',
    })

    expect(parsed.success).toBe(false)
  })
})
