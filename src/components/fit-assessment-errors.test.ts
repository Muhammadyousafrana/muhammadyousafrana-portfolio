/* eslint-disable import/no-unresolved */
import { describe, expect, it } from 'bun:test'
import {
  FALLBACK_FIT_ASSESSMENT_ERROR,
  getFitAssessmentErrorState,
  getFitAssessmentRequestErrorState,
} from './fit-assessment-errors'

describe('getFitAssessmentErrorState', () => {
  it('maps backend rate-limit errors to retryable recruiter copy', () => {
    expect(
      getFitAssessmentErrorState({
        success: false,
        code: 'RATE_LIMITED',
        error: 'Rate limit exceeded',
      })
    ).toEqual({
      message: 'Fit assessment is temporarily rate limited. Please wait and try again.',
      canRetry: true,
    })
  })

  it('maps oversized requests to non-retryable recruiter copy', () => {
    expect(
      getFitAssessmentErrorState({
        success: false,
        code: 'REQUEST_TOO_LARGE',
        error: 'Request body is too large',
      })
    ).toEqual({
      message: 'This job description is too large. Shorten it and try again.',
      canRetry: false,
    })
  })

  it('falls back cleanly when the backend payload is not a known error envelope', () => {
    expect(getFitAssessmentErrorState({ success: false, error: 'no code' })).toBeNull()
  })
})

describe('getFitAssessmentRequestErrorState', () => {
  it('maps network/client failures to the retryable fallback (Turnstile now gates upfront)', () => {
    expect(getFitAssessmentRequestErrorState()).toEqual(FALLBACK_FIT_ASSESSMENT_ERROR)
  })
})
