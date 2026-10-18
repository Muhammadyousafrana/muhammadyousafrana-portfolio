/* eslint-disable import/no-unresolved */
import { describe, expect, it } from 'bun:test'
import { collectPendingToolContinuationIds, validateContactHandoffInput } from './useResumeChat'

describe('collectPendingToolContinuationIds', () => {
  it('retains only input continuations until the tool reaches a terminal state', () => {
    const messages = [
      {
        role: 'assistant',
        parts: [
          { toolCallId: 'handoff-input', state: 'input-available' },
          { toolCallId: 'send-finished', state: 'output-available' },
        ],
      },
    ] as Parameters<typeof collectPendingToolContinuationIds>[0]

    expect([...collectPendingToolContinuationIds(messages)]).toEqual(['handoff-input'])
  })
})

describe('validateContactHandoffInput', () => {
  it('returns one structured output with normalized phone data', () => {
    expect(
      validateContactHandoffInput(
        {
          contactName: 'Jordan Lee',
          contactPhone: '(604) 555-1234',
          contactCompany: 'Northwind Robotics',
          contactMessage: '',
        },
        '2026-03-07T12:00:00.000Z'
      )
    ).toEqual({
      output: {
        contactName: 'Jordan Lee',
        contactPhone: '+16045551234',
        contactCompany: 'Northwind Robotics',
        answeredAt: '2026-03-07T12:00:00.000Z',
      },
    })
  })

  it('requires recruiter name and phone', () => {
    expect(
      validateContactHandoffInput(
        {
          contactName: '',
          contactPhone: '',
          contactCompany: '',
          contactMessage: '',
        },
        '2026-03-07T12:00:00.000Z'
      )
    ).toEqual({
      errors: {
        contactName: 'Name is required.',
        contactPhone: 'Phone number is required.',
      },
    })
  })

  it('rejects an overlong optional contact message', () => {
    expect(
      validateContactHandoffInput(
        {
          contactName: 'Jordan Lee',
          contactPhone: '604-555-1234',
          contactCompany: '',
          contactMessage: 'x'.repeat(481),
        },
        '2026-03-07T12:00:00.000Z'
      )
    ).toEqual({
      errors: {
        contactMessage: 'Keep the message under 480 characters.',
      },
    })
  })
})
