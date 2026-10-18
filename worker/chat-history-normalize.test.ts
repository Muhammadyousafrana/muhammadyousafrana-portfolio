/* eslint-disable import/no-unresolved */
import { convertToModelMessages, type UIMessage } from 'ai'
import { describe, expect, it } from 'bun:test'
import { CHAT_TOOL_NAME } from '../shared/chat-tools'
import {
  isContentlessAssistantMessage,
  normalizeChatHistoryForModel,
} from './chat-history-normalize'

const userMessage = (id: string, text: string): UIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text }],
})

const emptyAssistant = (id: string): UIMessage => ({ id, role: 'assistant', parts: [] })

const assistantText = (id: string, text: string): UIMessage => ({
  id,
  role: 'assistant',
  parts: [{ type: 'text', text }],
})

const contactToolAssistant = (id: string): UIMessage => ({
  id,
  role: 'assistant',
  parts: [
    {
      type: `tool-${CHAT_TOOL_NAME.showContactForm}`,
      toolCallId: 'tool-1',
      state: 'input-available',
      input: {},
    },
  ],
})

describe('normalizeChatHistoryForModel', () => {
  it('drops an assistant whose only tool part is still input-streaming', () => {
    const streamingToolAssistant: UIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: `tool-${CHAT_TOOL_NAME.showContactForm}`,
          toolCallId: 'tool-1',
          state: 'input-streaming',
          input: undefined,
        },
      ],
    }
    // convertToModelMessages skips an input-streaming tool call, so this assistant
    // converts to nothing and must be treated as an empty completion.
    expect(normalizeChatHistoryForModel([streamingToolAssistant])).toEqual([])
  })

  it('drops contentless assistant completions', () => {
    const history = [userMessage('u1', 'hi'), emptyAssistant('a1')]
    const normalized = normalizeChatHistoryForModel(history)
    expect(normalized.map((m) => m.id)).toEqual(['u1'])
  })

  it('coalesces the consecutive users an empty assistant separated', () => {
    const history = [
      userMessage('u1', 'first question'),
      emptyAssistant('a1'),
      userMessage('u2', 'hi'),
    ]
    const normalized = normalizeChatHistoryForModel(history)
    expect(normalized).toHaveLength(1)
    // Keeps the latest turn's id so the client's optimistic message reconciles.
    expect(normalized[0].id).toBe('u2')
    expect(normalized[0].parts).toEqual([{ type: 'text', text: 'first question\n\nhi' }])
  })

  it('preserves a tool-bearing assistant even with no text', () => {
    const history = [userMessage('u1', 'get in touch'), contactToolAssistant('a1')]
    const normalized = normalizeChatHistoryForModel(history)
    expect(normalized.map((m) => m.id)).toEqual(['u1', 'a1'])
  })

  it('leaves a healthy alternating history untouched (same references)', () => {
    const history = [
      userMessage('u1', 'hi'),
      assistantText('a1', 'hello'),
      userMessage('u2', 'thanks'),
    ]
    const normalized = normalizeChatHistoryForModel(history)
    expect(normalized).toHaveLength(3)
    expect(normalized[0]).toBe(history[0])
    expect(normalized[1]).toBe(history[1])
    expect(normalized[2]).toBe(history[2])
  })

  it('drops an assistant whose only part is one convertToModelMessages ignores', () => {
    const sourceOnlyAssistant: UIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'source-url', sourceId: 's1', url: 'https://example.com' }],
    }
    const history = [userMessage('u1', 'q1'), sourceOnlyAssistant, userMessage('u2', 'q2')]
    const normalized = normalizeChatHistoryForModel(history)
    // The source-only assistant converts to nothing, so it must be dropped and
    // the users it separated coalesced — otherwise Gemini rejects the roles.
    expect(normalized).toHaveLength(1)
    expect(normalized[0].id).toBe('u2')
    expect(normalized[0].parts).toEqual([{ type: 'text', text: 'q1\n\nq2' }])
  })

  it('repairs a poisoned history so it converts with no empty or consecutive-user turns', async () => {
    const poisoned = [
      userMessage('u1', 'q1'),
      emptyAssistant('a1'),
      emptyAssistant('a2'),
      userMessage('u2', 'q2'),
      emptyAssistant('a3'),
      userMessage('u3', 'hi'),
    ]
    const normalized = normalizeChatHistoryForModel(poisoned)

    expect(normalized.every((m) => !isContentlessAssistantMessage(m))).toBe(true)
    // No two adjacent messages share a role.
    expect(normalized.every((m, i) => i === 0 || m.role !== normalized[i - 1].role)).toBe(true)
    // convertToModelMessages is async (the chat route awaits it), so await the
    // promise to assert the repaired history actually converts instead of rejecting.
    await expect(convertToModelMessages(normalized)).resolves.toBeDefined()
  })
})
