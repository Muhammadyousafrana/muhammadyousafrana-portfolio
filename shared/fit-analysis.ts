import { z } from 'zod'

const FIT_ASSESSMENT_BULLET_MAX_LENGTH = 320
export const FIT_SCORE_MIN_FOR_STRONG_FIT = 70
export const FIT_SCORE_MIN_FOR_PARTIAL_FIT = 25
export const FIT_SCORE_MAX_FOR_PARTIAL_FIT = 85
export const FIT_SCORE_MAX_FOR_NOT_A_FIT = 55

const fitAssessmentBulletSchema = z.string().trim().min(1).max(FIT_ASSESSMENT_BULLET_MAX_LENGTH)

export const fitVerdictSchema = z.enum(['Strong Fit', 'Partial Fit', 'Not a Fit'])
export const fitConfidenceSchema = z.enum(['High', 'Medium', 'Low'])

export const FIT_ANALYSIS_RESPONSE_SCHEMA_NAME = 'fit_assessment_result'

export const fitAssessmentResultSchema = z
  .object({
    verdict: fitVerdictSchema.describe(
      'Overall classification. Use "Not a Fit" when must-have gaps or disqualifiers outweigh the matches.'
    ),
    fitScore: z
      .number()
      .int()
      .min(0)
      .max(100)
      .describe(
        'Integer fit score from 0 to 100 that stays internally consistent with the verdict and documented evidence.'
      ),
    confidence: fitConfidenceSchema.describe(
      'Confidence in the assessment based on how explicit and complete the documented evidence is.'
    ),
    summary: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe(
        'One or two first-person sentences, written as the candidate, summarizing whether this role is genuinely a fit.'
      ),
    matches: z
      .array(fitAssessmentBulletSchema)
      .max(6)
      .describe(
        'Best documented requirement-to-evidence matches. Use an empty array when there are no meaningful matches.'
      ),
    keyGaps: z
      .array(fitAssessmentBulletSchema)
      .max(6)
      .describe(
        'Material gaps, missing evidence, or validation risks that do not independently make this a hard no-fit.'
      ),
    disqualifiers: z
      .array(fitAssessmentBulletSchema)
      .max(4)
      .describe(
        'Hard blockers that justify a "Not a Fit" verdict. Keep empty unless the role is a true no-fit.'
      ),
    transferableStrengths: z
      .array(fitAssessmentBulletSchema)
      .max(6)
      .describe('Relevant strengths that still transfer even when the fit is partial or negative.'),
    recommendation: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe(
        'Direct first-person message, written as the candidate to the recruiter who submitted the job description, on whether this role is the right fit and what a useful next step would be.'
      ),
  })
  .superRefine((result, ctx) => {
    if (result.verdict === 'Strong Fit') {
      if (result.fitScore < FIT_SCORE_MIN_FOR_STRONG_FIT) {
        ctx.addIssue({
          code: 'custom',
          path: ['fitScore'],
          message: `Strong Fit results must have fitScore >= ${FIT_SCORE_MIN_FOR_STRONG_FIT}.`,
        })
      }

      if (result.disqualifiers.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['disqualifiers'],
          message: 'Strong Fit results cannot include disqualifiers.',
        })
      }

      if (result.matches.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['matches'],
          message: 'Strong Fit results must include at least one documented match.',
        })
      }
    }

    if (result.verdict === 'Partial Fit') {
      if (
        result.fitScore < FIT_SCORE_MIN_FOR_PARTIAL_FIT ||
        result.fitScore > FIT_SCORE_MAX_FOR_PARTIAL_FIT
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['fitScore'],
          message: `Partial Fit results must have ${FIT_SCORE_MIN_FOR_PARTIAL_FIT} <= fitScore <= ${FIT_SCORE_MAX_FOR_PARTIAL_FIT}.`,
        })
      }

      if (result.disqualifiers.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['disqualifiers'],
          message: 'Partial Fit results cannot include disqualifiers.',
        })
      }

      if (result.matches.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['matches'],
          message: 'Partial Fit results must include at least one documented match.',
        })
      }

      if (result.keyGaps.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['keyGaps'],
          message: 'Partial Fit results must include at least one key gap.',
        })
      }
    }

    if (result.verdict === 'Not a Fit') {
      if (result.fitScore > FIT_SCORE_MAX_FOR_NOT_A_FIT) {
        ctx.addIssue({
          code: 'custom',
          path: ['fitScore'],
          message: `Not a Fit results must have fitScore <= ${FIT_SCORE_MAX_FOR_NOT_A_FIT}.`,
        })
      }

      if (result.disqualifiers.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['disqualifiers'],
          message: 'Not a Fit results must include at least one disqualifier.',
        })
      }
    }
  })

export const fitAssessmentSuccessResponseSchema = z.object({
  success: z.literal(true),
  data: fitAssessmentResultSchema,
})

export const fitAssessmentErrorCodeSchema = z.enum([
  'VERIFICATION_REQUIRED',
  'VERIFICATION_FAILED',
  'VERIFICATION_UNAVAILABLE',
  'RATE_LIMITED',
  'REQUEST_TOO_LARGE',
  'INVALID_REQUEST',
  'MISSING_JOB_DESCRIPTION',
  'ANALYSIS_UNAVAILABLE',
  'ANALYSIS_FAILED',
])

export const fitAssessmentErrorResponseSchema = z.object({
  success: z.literal(false),
  code: fitAssessmentErrorCodeSchema,
  error: z.string().trim().min(1),
})

export type FitVerdict = z.infer<typeof fitVerdictSchema>
export type FitConfidence = z.infer<typeof fitConfidenceSchema>
export type FitAssessmentResult = z.infer<typeof fitAssessmentResultSchema>
export type FitAssessmentSuccessResponse = z.infer<typeof fitAssessmentSuccessResponseSchema>
export type FitAssessmentErrorCode = z.infer<typeof fitAssessmentErrorCodeSchema>
export type FitAssessmentErrorResponse = z.infer<typeof fitAssessmentErrorResponseSchema>
