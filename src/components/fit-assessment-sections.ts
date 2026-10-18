import type { FitAssessmentResult } from '../../shared/fit-analysis'

export interface FitAssessmentSection {
  title: string
  items: string[]
}

export type FitAssessmentTone = 'strong' | 'partial' | 'not-fit'
export type FitAssessmentPresentationBand = 'strong' | 'promising' | 'stretch' | 'not-fit'

export interface FitAssessmentPresentation {
  band: FitAssessmentPresentationBand
  tone: FitAssessmentTone
  eyebrow: string
  headline: string
  recommendationLabel: string
  sections: FitAssessmentSection[]
  recommendation: FitAssessmentSection
}

const pushFitSection = (sections: FitAssessmentSection[], title: string, items: string[]) => {
  if (items.length > 0) {
    sections.push({ title, items })
  }
}

export const getFitPresentation = (result: FitAssessmentResult): FitAssessmentPresentation => {
  const sections: FitAssessmentSection[] = []

  if (result.verdict === 'Strong Fit') {
    pushFitSection(sections, 'Why This Fits', result.matches)
    pushFitSection(sections, 'Risks to Validate', result.keyGaps)
    pushFitSection(sections, 'Transferable Strengths', result.transferableStrengths)

    return {
      band: 'strong',
      tone: 'strong',
      eyebrow: 'High-conviction recruiter read',
      headline: "Strong Fit: Let's Talk",
      recommendationLabel: 'Recommended next step',
      sections,
      recommendation: {
        title: "Why I'd Take the Call",
        items: [result.recommendation],
      },
    }
  }

  if (result.verdict === 'Partial Fit') {
    const isStretchFit = result.fitScore < 50

    if (isStretchFit) {
      pushFitSection(sections, 'Key Gaps', result.keyGaps)
      pushFitSection(sections, 'What Matches', result.matches)
    } else {
      pushFitSection(sections, 'What Matches', result.matches)
      pushFitSection(sections, 'Key Gaps', result.keyGaps)
    }

    pushFitSection(sections, 'Transferable Strengths', result.transferableStrengths)

    return {
      band: isStretchFit ? 'stretch' : 'promising',
      tone: 'partial',
      eyebrow: isStretchFit
        ? 'Tradeoff hire, not a clean match'
        : 'Promising overlap with gaps to validate',
      headline: isStretchFit ? 'Stretch Fit: Gaps Need a Plan' : 'Potential Fit: Validate the Gaps',
      recommendationLabel: isStretchFit ? 'Proceed only with eyes open' : 'What I would do next',
      sections,
      recommendation: {
        title: isStretchFit ? 'Proceed Only with a Clear Plan' : 'What I Would Do Next',
        items: [result.recommendation],
      },
    }
  }

  if (result.verdict === 'Not a Fit') {
    pushFitSection(sections, 'Disqualifiers', result.disqualifiers)
    pushFitSection(sections, 'What Matches', result.matches)
    pushFitSection(sections, 'What Still Transfers', result.transferableStrengths)
    pushFitSection(sections, 'Additional Gaps', result.keyGaps)

    return {
      band: 'not-fit',
      tone: 'not-fit',
      eyebrow: 'Honest recruiter pass',
      headline: 'Probably Not Your Person',
      recommendationLabel: 'Better next step',
      sections,
      recommendation: {
        title: "Why I'd Pass",
        items: [result.recommendation],
      },
    }
  }

  return {
    band: 'promising',
    tone: 'partial',
    eyebrow: 'Recruiter review',
    headline: 'Fit Assessment',
    recommendationLabel: 'Recommended next step',
    sections,
    recommendation: {
      title: 'Recommended Next Step',
      items: [result.recommendation],
    },
  }
}

export const getFitSections = (result: FitAssessmentResult): FitAssessmentSection[] => {
  const presentation = getFitPresentation(result)
  return [...presentation.sections, presentation.recommendation]
}
