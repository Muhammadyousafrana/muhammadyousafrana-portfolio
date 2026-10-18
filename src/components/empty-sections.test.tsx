/* eslint-disable import/no-unresolved */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CredentialHighlights } from './CredentialHighlights'
import { ExperienceFeed } from './ExperienceFeed'
import { SkillsMatrix } from './SkillsMatrix'

// These sections read `resumeViewModel` from '@/data/resume' at render time via a
// live import binding, so each case remocks that module with a controlled view
// model and renders. This keeps the assertions persona-agnostic: they verify the
// hide/show WIRING, not any one persona's data. The module mock is global and
// leaks across files unless restored, so a plain-object copy of the real module is
// captured before mocking and reinstalled in afterAll (bun's `mock.restore()` does
// not undo `mock.module`). bun runs test files sequentially, so this is safe.
const realResume = { ...(await import('@/data/resume')) }
afterAll(async () => {
  await mock.module('@/data/resume', () => realResume)
})

const emptyViewModel = {
  experience: [] as unknown[],
  projects: [] as unknown[],
  leadership: [] as unknown[],
  certifications: [] as unknown[],
  awards: [] as unknown[],
  skills: {
    coreStrengths: [] as string[],
    appliedAndDeveloping: [] as string[],
    currentLearningFocus: [] as string[],
  },
}

const leadershipItem = { title: 'Frontend Guild Lead', organization: 'Acme', period: '2020' }
const certItem = { title: 'AWS Certified', organization: 'Amazon', period: '2021' }
const awardItem = { title: 'Engineering Award', detail: 'For excellence', period: '2022' }
const expItem = {
  id: 'exp-1',
  title: 'Senior Engineer',
  organization: 'Acme',
  period: '2020 - Present',
  summary: 'Owned core services.',
  bullets: ['Shipped the platform.'],
}
const projItem = {
  id: 'proj-1',
  title: 'Open Toolkit',
  organization: 'Featured Project',
  period: '2021',
  summary: 'A toolkit.',
  bullets: ['Built adapters.'],
}

function useViewModel(overrides: Record<string, unknown>) {
  mock.module('@/data/resume', () => ({
    resumeViewModel: { ...emptyViewModel, ...overrides },
    RESUME_PDF_PATH: undefined,
  }))
}

beforeEach(() => {
  useViewModel({})
})

describe('CredentialHighlights empty-state hiding', () => {
  it('renders nothing when leadership, certifications, and awards are all empty', () => {
    expect(renderToStaticMarkup(<CredentialHighlights />)).toBe('')
  })

  it('renders the section but only the populated subsection', () => {
    useViewModel({ leadership: [leadershipItem] })
    const markup = renderToStaticMarkup(<CredentialHighlights />)
    expect(markup).toContain('Leadership And Credentials')
    expect(markup).toContain(leadershipItem.title)
    expect(markup).not.toContain('Certification')
    expect(markup).not.toContain('Award')
  })

  it('renders every subsection when all three are populated', () => {
    useViewModel({
      leadership: [leadershipItem],
      certifications: [certItem],
      awards: [awardItem],
    })
    const markup = renderToStaticMarkup(<CredentialHighlights />)
    expect(markup).toContain('Leadership')
    expect(markup).toContain('Certification')
    expect(markup).toContain('Award')
    expect(markup).toContain(certItem.title)
    expect(markup).toContain(awardItem.title)
  })
})

describe('SkillsMatrix empty-state hiding', () => {
  it('renders nothing when all three skill lists are empty', () => {
    expect(renderToStaticMarkup(<SkillsMatrix />)).toBe('')
  })

  it('renders the section but only the populated card', () => {
    useViewModel({ skills: { ...emptyViewModel.skills, coreStrengths: ['TypeScript'] } })
    const markup = renderToStaticMarkup(<SkillsMatrix />)
    expect(markup).toContain('Technical Competencies')
    expect(markup).toContain('Core Strengths')
    expect(markup).toContain('TypeScript')
    expect(markup).not.toContain('Applied / Developing')
    expect(markup).not.toContain('Growth Areas')
  })
})

describe('ExperienceFeed empty-state hiding', () => {
  it('renders nothing when both experience and projects are empty', () => {
    expect(renderToStaticMarkup(<ExperienceFeed />)).toBe('')
  })

  it('renders only the Experience block when there are no projects', () => {
    useViewModel({ experience: [expItem] })
    const markup = renderToStaticMarkup(<ExperienceFeed />)
    expect(markup).toContain('Professional Experience')
    expect(markup).toContain('id="experience"')
    expect(markup).not.toContain('Key Projects')
    expect(markup).not.toContain('id="projects"')
  })

  it('renders only the Projects block (with its anchor) when there is no experience', () => {
    useViewModel({ projects: [projItem] })
    const markup = renderToStaticMarkup(<ExperienceFeed />)
    expect(markup).toContain('Key Projects')
    expect(markup).toContain('id="projects"')
    expect(markup).not.toContain('Professional Experience')
    expect(markup).not.toContain('id="experience"')
  })

  it('renders both blocks with both anchors when populated', () => {
    useViewModel({ experience: [expItem], projects: [projItem] })
    const markup = renderToStaticMarkup(<ExperienceFeed />)
    expect(markup).toContain('id="experience"')
    expect(markup).toContain('id="projects"')
    expect(markup).toContain(expItem.title)
    expect(markup).toContain(projItem.title)
  })
})
