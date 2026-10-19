import { generatedContent } from './content.generated'

// Single source of resume/profile data is content/portfolio.yaml + content/prose/*.md,
// codegen'd into ./content.generated.ts. This module keeps the same exports and shapes
// downstream code already consumes; it only sources the values from generated content.
const content = generatedContent

// Evidence ids are the union of every experience and project id. Deriving the type from
// the RAW generated (`as const`) content keeps proof-point references compile-time safe: a
// sourceId that matches no experience/project id fails the assignment below (the codegen
// also enforces this at build time). This must read `content` (literal) and not the widened
// `resumeData` collections, or the literal union collapses to `string`.
type EvidenceId =
  | (typeof content.experience)[number]['id']
  | (typeof content.projects)[number]['id']

// Declared item types (rather than the deep-`readonly` literal tuple types) so that
// mapping over an EMPTY optional section stays typed as the item, not `never`. This is what
// lets a sparser persona omit leadership/certifications/awards and still typecheck.
type EducationItem = { school: string; degree: string; coursework: readonly string[] }
type EvidenceItem = {
  id: string
  company: string
  role: string
  period?: string
  description: string
  bullets: readonly string[]
  links: readonly { label: string; url: string }[]
}
type ProjectItem = {
  id: string
  name: string
  period?: string
  description: string
  bullets: readonly string[]
  links: readonly { label: string; url: string }[]
}
type LeadershipItem = {
  organization: string
  role: string
  period?: string
  highlights: readonly string[]
}
type CertificationItem = {
  name: string
  issuer: string
  period?: string
  url?: string
  highlights: readonly string[]
}
type AwardItem = { name: string; period?: string; detail: string }
type HomePageProofPoint = { sourceId: EvidenceId; title: string; detail: string }

type ResumeData = {
  name: string
  title: string
  contact: {
    email: string
    location: string
    linkedinPath: string
    profiles: readonly { label: string; url: string }[]
  }
  summary: string
  targetRoles: readonly string[]
  education: readonly EducationItem[]
  experience: readonly EvidenceItem[]
  projects: readonly ProjectItem[]
  leadership: readonly LeadershipItem[]
  certifications: readonly CertificationItem[]
  awards: readonly AwardItem[]
  skills: { strong: readonly string[]; moderate: readonly string[]; gaps: readonly string[] }
}

// Optional: unset in content -> undefined -> the header PDF button hides.
export const RESUME_PDF_PATH: string | undefined = content.resumePdfPath ?? undefined

export const resumeData: ResumeData = {
  name: content.name,
  title: content.title,
  contact: content.contact,
  summary: content.summary,
  targetRoles: content.targetRoles,
  // A list so multiple degrees are supported (at least one is guaranteed by the schema).
  education: content.education,
  experience: content.experience,
  projects: content.projects,
  leadership: content.leadership,
  certifications: content.certifications,
  awards: content.awards,
  skills: content.skills,
}

const linkedinPath = resumeData.contact.linkedinPath.replace(/^https?:\/\//, '').replace(/^\/+/, '')

export const resumeContact = {
  email: resumeData.contact.email,
  location: resumeData.contact.location,
  linkedinUrl: `https://${linkedinPath}`,
  profiles: [...resumeData.contact.profiles],
}

// Owner-facing identity strings consumed by the AI prompts, the worker SMS body,
// the chat UI, and email actions. `firstName` is the explicit content shortName
// (not a parse of `name`), so preferred/compound names stay correct.
export const resumeIdentity = {
  fullName: resumeData.name,
  firstName: content.shortName,
  assistantName: content.assistantName,
}

// SEO / social-card metadata injected into index.html by vite.config.ts.
export const resumeSeo = {
  title: content.seo.title,
  description: content.seo.description,
  ogTitle: content.seo.ogTitle,
  ogDescription: content.seo.ogDescription,
  themeColor: content.seo.themeColor,
}

// The `proofPoints` annotation both widens the type (so an empty list maps safely) and
// enforces at compile time that every sourceId is a real evidence id.
const resumeHomePage: {
  openToLabel: string
  roleFocus: string
  heroHeadline: string
  ctaHeadline: string
  ctaSubtext: string
  proofPoints: readonly HomePageProofPoint[]
} = {
  openToLabel: content.homepage.openToLabel,
  roleFocus: content.homepage.roleFocus,
  heroHeadline: content.homepage.heroHeadline,
  ctaHeadline: content.homepage.ctaHeadline,
  ctaSubtext: content.homepage.ctaSubtext,
  proofPoints: content.homepage.proofPoints,
}

const createFeedItem = (
  id: string,
  title: string,
  organization: string,
  period: string | undefined,
  summary: string,
  bullets: readonly string[],
  links: readonly { label: string; url: string }[] = []
) => ({
  id,
  title,
  organization,
  period,
  summary,
  bullets: [...bullets],
  links: [...links],
})

export const resumeViewModel = {
  name: resumeData.name,
  firstName: resumeIdentity.firstName,
  assistantName: resumeIdentity.assistantName,
  headerLabel: content.headerLabel,
  summary: resumeData.summary,
  contact: resumeContact,
  homepage: resumeHomePage,
  starterPrompts: [...content.starterPrompts],
  education: {
    // The compact homepage stat box surfaces the primary (first) degree.
    degree: resumeData.education[0].degree,
  },
  experience: resumeData.experience.map((item) =>
    createFeedItem(
      item.id,
      item.role,
      item.company,
      item.period,
      item.description,
      item.bullets,
      item.links
    )
  ),
  projects: resumeData.projects.map((item) =>
    createFeedItem(
      item.id,
      item.name,
      'Featured Project',
      item.period,
      item.description,
      item.bullets,
      item.links
    )
  ),
  leadership: resumeData.leadership.map((item) => ({
    title: item.role,
    organization: item.organization,
    period: item.period,
  })),
  certifications: resumeData.certifications.map((item) => ({
    title: item.name,
    organization: item.issuer,
    period: item.period,
    url: item.url,
  })),
  awards: resumeData.awards.map((item) => ({
    title: item.name,
    detail: item.detail,
    period: item.period,
  })),
  skills: {
    coreStrengths: [...resumeData.skills.strong],
    appliedAndDeveloping: [...resumeData.skills.moderate],
    currentLearningFocus: [...resumeData.skills.gaps],
  },
}
