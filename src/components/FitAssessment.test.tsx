/* eslint-disable import/no-unresolved */
import { describe, expect, it } from 'bun:test'
import type { FitAssessmentResult } from '../../shared/fit-analysis'
import { getFitPresentation, getFitSections } from './fit-assessment-sections'

const makePartialFitResult = (fitScore: number): FitAssessmentResult => ({
  verdict: 'Partial Fit',
  fitScore,
  confidence: 'Medium',
  summary: 'Mixed fit with real strengths and explicit gaps.',
  matches: ['Documented embedded and hardware project overlap.'],
  keyGaps: ['No documented deployed robotics stack experience yet.'],
  disqualifiers: [],
  transferableStrengths: ['Hands-on prototyping experience transfers well.'],
  recommendation: 'Consider only if the team can support ramp-up on the missing stack.',
})

const strongFitResult: FitAssessmentResult = {
  verdict: 'Strong Fit',
  fitScore: 82,
  confidence: 'High',
  summary: 'Direct overlap across the role core and only minor interview validation risk.',
  matches: ['Documented platform and API ownership lines up with the role scope.'],
  keyGaps: ['Interview should still confirm production-scale ownership depth.'],
  disqualifiers: [],
  transferableStrengths: ['Cross-functional execution transfers cleanly.'],
  recommendation: 'Move this candidate into a recruiter screen.',
}

const notFitResult: FitAssessmentResult = {
  verdict: 'Not a Fit',
  fitScore: 18,
  confidence: 'High',
  summary: 'The role asks for a domain background the resume does not document.',
  matches: ['Some general systems thinking still transfers.'],
  keyGaps: ['No documented consumer mobile ownership.'],
  disqualifiers: ['No direct product leadership or consumer growth ownership is documented.'],
  transferableStrengths: ['Technical architecture judgment could transfer to adjacent roles.'],
  recommendation: 'Pass for this role and keep the candidate warm for platform-heavy openings.',
}

describe('getFitSections', () => {
  it('renders weak partial fits gap-first', () => {
    const sections = getFitSections(makePartialFitResult(49))

    expect(sections.map((section) => section.title)).toEqual([
      'Key Gaps',
      'What Matches',
      'Transferable Strengths',
      'Proceed Only with a Clear Plan',
    ])
  })

  it('keeps stronger partial fits match-first', () => {
    const sections = getFitSections(makePartialFitResult(50))

    expect(sections.map((section) => section.title)).toEqual([
      'What Matches',
      'Key Gaps',
      'Transferable Strengths',
      'What I Would Do Next',
    ])
  })
})

describe('getFitPresentation', () => {
  it('gives strong fits a deterministic recruiter-forward frame', () => {
    const presentation = getFitPresentation(strongFitResult)

    expect(presentation.band).toBe('strong')
    expect(presentation.tone).toBe('strong')
    expect(presentation.headline).toBe("Strong Fit: Let's Talk")
    expect(presentation.recommendation.title).toBe("Why I'd Take the Call")
  })

  it('treats low-score partial fits as stretch opportunities', () => {
    const presentation = getFitPresentation(makePartialFitResult(49))

    expect(presentation.band).toBe('stretch')
    expect(presentation.eyebrow).toBe('Tradeoff hire, not a clean match')
    expect(presentation.recommendationLabel).toBe('Proceed only with eyes open')
  })

  it('keeps not-fit framing tied to disqualifiers first', () => {
    const presentation = getFitPresentation(notFitResult)

    expect(presentation.band).toBe('not-fit')
    expect(presentation.headline).toBe('Probably Not Your Person')
    expect(presentation.sections.map((section) => section.title)).toEqual([
      'Disqualifiers',
      'What Matches',
      'What Still Transfers',
      'Additional Gaps',
    ])
  })
})
