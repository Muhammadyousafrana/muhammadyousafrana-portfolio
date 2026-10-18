/* eslint-disable import/no-unresolved */
import { describe, expect, it } from 'bun:test'
import {
  buildContactRelayMessage,
  formatContactPhoneForDisplay,
  isStrictE164Phone,
  normalizeContactPhoneInput,
  normalizeStrictE164Phone,
  sanitizeOptionalContactDetail,
} from './contact-handoff'

describe('sanitizeOptionalContactDetail', () => {
  it('drops placeholder recruiter-detail strings', () => {
    expect(sanitizeOptionalContactDetail('Optional recruiter name not provided')).toBeUndefined()
    expect(sanitizeOptionalContactDetail('Optional company not provided')).toBeUndefined()
    expect(sanitizeOptionalContactDetail('N/A')).toBeUndefined()
    expect(sanitizeOptionalContactDetail('N/A.')).toBeUndefined()
  })

  it('preserves real recruiter-detail values', () => {
    expect(sanitizeOptionalContactDetail('Jordan Lee')).toBe('Jordan Lee')
    expect(sanitizeOptionalContactDetail('Northwind Robotics')).toBe('Northwind Robotics')
    expect(sanitizeOptionalContactDetail('Northwind Robotics,')).toBe('Northwind Robotics')
  })
})

describe('normalizeContactPhoneInput', () => {
  it('normalizes 10-digit North American inputs to +1 format', () => {
    expect(normalizeContactPhoneInput('604-555-1234')).toBe('+16045551234')
  })

  it('preserves valid international inputs with common punctuation', () => {
    expect(normalizeContactPhoneInput('+1 (604) 555-1234')).toBe('+16045551234')
  })

  it('rejects malformed international inputs with extension markers', () => {
    expect(normalizeContactPhoneInput('+1 604 555 1234 ext 99')).toBeNull()
  })

  it('rejects malformed international inputs with duplicate plus signs', () => {
    expect(normalizeContactPhoneInput('++16045551234')).toBeNull()
  })
})

describe('normalizeStrictE164Phone', () => {
  it('accepts strict international inputs with common punctuation but no country inference', () => {
    expect(normalizeStrictE164Phone('+1 (604) 555-1234')).toBe('+16045551234')
  })

  it('rejects inputs that would require country-code inference', () => {
    expect(normalizeStrictE164Phone('604-555-1234')).toBeNull()
  })
})

describe('isStrictE164Phone', () => {
  it('accepts already-normalized E.164 values only', () => {
    expect(isStrictE164Phone('+16045551234')).toBe(true)
    expect(isStrictE164Phone('+1 (604) 555-1234')).toBe(false)
  })
})

describe('formatContactPhoneForDisplay', () => {
  it('formats normalized North American numbers for recruiter-facing UI', () => {
    expect(formatContactPhoneForDisplay('+16045551234')).toBe('604-555-1234')
  })
})

describe('buildContactRelayMessage', () => {
  it('uses the recruiter note when one is supplied', () => {
    expect(
      buildContactRelayMessage({
        contactPhone: '+16045551234',
        contactMessage: 'Please reach out about a robotics role.',
        contactName: 'Jordan Lee',
      })
    ).toBe('Please reach out about a robotics role.')
  })

  it('builds a default relay message when the recruiter note is blank', () => {
    expect(
      buildContactRelayMessage({
        contactPhone: '+16045551234',
        contactName: 'Jordan Lee',
        contactCompany: 'Northwind Robotics',
      })
    ).toBe(
      'Jordan Lee from Northwind Robotics would like to connect with you. Callback phone: 604-555-1234.'
    )
  })
})
