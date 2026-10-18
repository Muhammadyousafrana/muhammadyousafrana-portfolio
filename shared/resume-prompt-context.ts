import YAML from 'yaml'
import { resumeContact, resumeData } from './resume-canonical'

function createPromptEvidenceItem(
  title: string,
  organization: string,
  period: string,
  summary: string,
  bullets: readonly string[]
) {
  return {
    title,
    organization,
    period,
    summary,
    evidence: bullets,
  }
}

function createResumePromptPayload() {
  return {
    candidateProfile: {
      name: resumeData.name,
      headline: resumeData.title,
      summary: resumeData.summary,
      location: resumeContact.location,
    },
    publicContact: {
      email: resumeContact.email,
      linkedIn: resumeContact.linkedinUrl,
    },
    roleTargets: resumeData.targetRoles,
    education: resumeData.education.map((item) => ({
      school: item.school,
      degree: item.degree,
      relevantCoursework: item.coursework,
    })),
    experienceEvidence: resumeData.experience.map((item) =>
      createPromptEvidenceItem(item.role, item.company, item.period, item.description, item.bullets)
    ),
    projectEvidence: resumeData.projects.map((item) => ({
      name: item.name,
      period: item.period,
      summary: item.description,
      evidence: item.bullets,
    })),
    leadershipEvidence: resumeData.leadership.map((item) => ({
      title: item.role,
      organization: item.organization,
      period: item.period,
      evidence: item.highlights,
    })),
    certificationEvidence: resumeData.certifications.map((item) => ({
      title: item.name,
      issuer: item.issuer,
      period: item.period,
      evidence: item.highlights,
    })),
    awards: resumeData.awards.map((item) => ({
      title: item.name,
      period: item.period,
      detail: item.detail,
    })),
    skillsSnapshot: {
      strengths: resumeData.skills.strong,
      workingKnowledge: resumeData.skills.moderate,
      currentGaps: resumeData.skills.gaps,
    },
  }
}

function addBlankLinesBetweenTopLevelSections(yaml: string): string {
  const lines = yaml.trimEnd().split('\n')
  const formattedLines: string[] = []

  for (const line of lines) {
    const isTopLevelKey = /^[^\s][^:\n]*:/.test(line)

    if (
      isTopLevelKey &&
      formattedLines.length > 0 &&
      formattedLines[formattedLines.length - 1] !== ''
    ) {
      formattedLines.push('')
    }

    formattedLines.push(line)
  }

  return formattedLines.join('\n')
}

export function createResumePromptContext(): string {
  const resumeContent = addBlankLinesBetweenTopLevelSections(
    YAML.stringify(createResumePromptPayload(), { lineWidth: 0 })
  )

  return `<RESUME-CONTENT>\n${resumeContent}\n</RESUME-CONTENT>`
}
