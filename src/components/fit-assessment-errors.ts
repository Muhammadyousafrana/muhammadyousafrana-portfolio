import { fitAssessmentErrorResponseSchema, type FitAssessmentErrorCode } from '@shared/fit-analysis'

export interface FitAssessmentErrorState {
  message: string
  canRetry: boolean
}

export const FALLBACK_FIT_ASSESSMENT_ERROR: FitAssessmentErrorState = {
  message: 'Unable to complete fit assessment right now.',
  canRetry: true,
}

const FIT_ASSESSMENT_ERROR_STATES: Record<FitAssessmentErrorCode, FitAssessmentErrorState> = {
  VERIFICATION_REQUIRED: {
    message: 'Complete the security check and try again.',
    canRetry: true,
  },
  VERIFICATION_FAILED: {
    message: 'Security verification failed. Please try again.',
    canRetry: true,
  },
  VERIFICATION_UNAVAILABLE: {
    message: 'Security check is unavailable right now. Please try again later.',
    canRetry: false,
  },
  RATE_LIMITED: {
    message: 'Fit assessment is temporarily rate limited. Please wait and try again.',
    canRetry: true,
  },
  REQUEST_TOO_LARGE: {
    message: 'This job description is too large. Shorten it and try again.',
    canRetry: false,
  },
  INVALID_REQUEST: {
    message: 'The fit assessment request was invalid. Refresh the page and try again.',
    canRetry: false,
  },
  MISSING_JOB_DESCRIPTION: {
    message: 'Paste a job description before running fit assessment.',
    canRetry: false,
  },
  ANALYSIS_UNAVAILABLE: {
    message: 'Fit assessment is unavailable right now. Please try again later.',
    canRetry: false,
  },
  ANALYSIS_FAILED: {
    message: 'Unable to complete fit assessment right now. Please try again.',
    canRetry: true,
  },
}

export const getFitAssessmentErrorState = (payload: unknown): FitAssessmentErrorState | null => {
  const parsed = fitAssessmentErrorResponseSchema.safeParse(payload)
  if (!parsed.success) {
    return null
  }

  return FIT_ASSESSMENT_ERROR_STATES[parsed.data.code]
}

// Network/client-side failures (fetch rejection, malformed payload) all map to
// the retryable fallback; Turnstile now gates before the request via the shared
// challenge, so it no longer surfaces here.
export const getFitAssessmentRequestErrorState = (): FitAssessmentErrorState => ({
  ...FALLBACK_FIT_ASSESSMENT_ERROR,
})
