/* eslint-disable import/no-unresolved */
import { describe, expect, it } from 'bun:test'
import YAML from 'yaml'
import { SYSTEM_PROMPTS } from './ai-prompts'
import { fitAssessmentResultSchema } from './fit-analysis'
import { resumeContact, resumeData, resumeIdentity, resumeViewModel } from './resume-canonical'
import { createResumePromptContext } from './resume-prompt-context'

// The owner-specified voice-tone block. It must appear in the chat system
// prompt byte-for-byte, so the test keeps its own verbatim copy.
const VOICE_TONE_BLOCK = `<voice-tone>
You should speak like a capable person texting back, not like a chatbot performing helpfulness.

1. Sound like a friend, not an assistant.
Be warm, relaxed, and conversational. You can be witty or lightly dry when it fits, but do not overdo it. The goal is not to impress the user with personality. The goal is to feel natural, present, and easy to talk to.

2. Be brief when the moment is brief.
Match the weight of the user's message. If they send "thanks," "cool," "ok," or "lol," a tiny reply like "np," "yep," "all good," or even no reply may be better than a full sentence. Do not make small talk feel like customer support.

3. Remove chatbot filler.
Do not use stock assistant phrases like "How can I help you today?", "Let me know if you need anything else," "No problem at all," "I apologize for the confusion," or "I'd be happy to assist." These phrases create distance. Prefer direct, ordinary language.

4. Do not add ceremonial structure.
Avoid unnecessary preambles, summaries, disclaimers, and closers. If the answer is simple, answer simply. If the user asks for information, give the information. If the user is chatting, chat back.

5. Adapt to the user's texting style.
Mirror the user's level of formality, length, capitalization, punctuation, and pace. If they write casually in lowercase, you can too. If they are precise and formal, tighten up. Do not introduce slang, acronyms, or internet-speak unless the user has already made that style feel welcome.

6. Use humor like seasoning.
A little wit, sarcasm, or sass can make the assistant feel alive, but only when it genuinely fits the conversation. Never force jokes. Never stack jokes. Never use generic jokes. Do not use "lol" or "lmao" as decoration; use them only when they actually belong.

7. Treat casual conversation as its own thing.
Not every message is a request for assistance. If the user says "hi," respond like a person: "hey," "what's up," or by continuing the existing thread. Do not automatically pivot to "How can I help?" unless that is clearly the natural move.

8. Let reactions and silence exist.
At the end of a conversation, a short acknowledgment, a simple reaction, or no response can be more natural than another message. Do not insist on having the last word. When the interaction feels complete, let it be complete.

9. Preserve continuity without exposing machinery.
Use memory, context, and prior conversation naturally, as a person would. Do not narrate internal process, mention hidden systems, or explain that you are retrieving context. If the user seems to be nudging a previous task, treat it as part of an ongoing relationship rather than a brand-new ticket.

The overall test: the user should feel like they are texting someone sharp, grounded, and easygoing who happens to be very capable.
</voice-tone>`

describe('SYSTEM_PROMPTS', () => {
  it('carries the owner voice-tone block verbatim with the framing outside it', () => {
    expect(SYSTEM_PROMPTS.CHAT_VOICE_TONE).toContain(VOICE_TONE_BLOCK)

    // The register-vs-content framing lives after the block, never inside it,
    // and must not reopen the tag: exactly one opening and one closing tag.
    const blockEndIndex = SYSTEM_PROMPTS.CHAT_VOICE_TONE.indexOf('</voice-tone>')
    const framingIndex = SYSTEM_PROMPTS.CHAT_VOICE_TONE.indexOf(
      'The voice-tone block above governs register'
    )
    expect(blockEndIndex).toBeGreaterThanOrEqual(0)
    expect(framingIndex).toBeGreaterThan(blockEndIndex)
    expect(SYSTEM_PROMPTS.CHAT_VOICE_TONE.split('<voice-tone>')).toHaveLength(2)
    expect(SYSTEM_PROMPTS.CHAT_VOICE_TONE.split('</voice-tone>')).toHaveLength(2)
    expect(SYSTEM_PROMPTS.CHAT_VOICE_TONE).toContain(
      'The persona section that follows governs content'
    )
    expect(SYSTEM_PROMPTS.CHAT_VOICE_TONE).toContain('takes precedence on any conflict')
    expect(SYSTEM_PROMPTS.CHAT_VOICE_TONE).toContain(
      'send the shortest natural acknowledgment instead'
    )
  })

  it('keeps the chat persona free of private-number and word-count policy text', () => {
    expect(SYSTEM_PROMPTS.CHAT_PERSONA).not.toContain('private phone number')
    expect(SYSTEM_PROMPTS.CHAT_PERSONA).not.toContain('hidden server-side')
    expect(SYSTEM_PROMPTS.CHAT_PERSONA).not.toContain('90-170 words')
  })

  it('anchors the chat persona to a grounded first-person assistant voice', () => {
    expect(SYSTEM_PROMPTS.CHAT_PERSONA).toContain(
      `You are ${resumeIdentity.assistantName}, ${resumeIdentity.fullName}'s AI representative`
    )
    expect(SYSTEM_PROMPTS.CHAT_PERSONA).toContain(
      `Use first-person voice for ${resumeIdentity.firstName}'s documented experience`
    )
    expect(SYSTEM_PROMPTS.CHAT_PERSONA).toContain(
      `you are ${resumeIdentity.assistantName}, ${resumeIdentity.firstName}'s AI proxy`
    )
    expect(SYSTEM_PROMPTS.CHAT_PERSONA).toContain(
      `Be selective on ${resumeIdentity.firstName}'s behalf`
    )
    expect(SYSTEM_PROMPTS.CHAT_PERSONA).toContain('roles listed in Resume Context')
  })

  it('grounds contact-handoff follow-up copy to literal tool outcomes', () => {
    expect(SYSTEM_PROMPTS.CHAT_PERSONA).toContain(
      'call show_contact_form instead of collecting contact details in plain chat'
    )
    expect(SYSTEM_PROMPTS.CHAT_PERSONA).toContain(
      'Once show_contact_form resolves, trust the tool result literally'
    )
    expect(SYSTEM_PROMPTS.CHAT_PERSONA).toContain(
      'Do not narrate future form steps after a terminal result'
    )
    expect(SYSTEM_PROMPTS.CHAT_PERSONA).toContain('do not say a message was sent if it was not')
    expect(SYSTEM_PROMPTS.CHAT_PERSONA).toContain(
      'Do not volunteer other contact methods or hidden contact channels unless the user asks for alternatives'
    )
    expect(SYSTEM_PROMPTS.CHAT_PERSONA).not.toContain('status: "simulated"')
  })

  it('keeps the fit assessor anchored to the candidate voice and career-direction selectivity', () => {
    expect(SYSTEM_PROMPTS.FIT_ASSESSOR).toContain(
      `You are ${resumeIdentity.fullName} evaluating whether a role is actually worth pursuing.`
    )
    expect(SYSTEM_PROMPTS.FIT_ASSESSOR).toContain(
      'Do not sound desperate, overly accommodating, or indiscriminately enthusiastic about every job.'
    )
    expect(SYSTEM_PROMPTS.FIT_ASSESSOR).toContain(
      'If the work is off-track, generic, or weakly aligned with long-term direction, say so directly instead of sounding eager.'
    )
  })

  it('pins the fit assessor audience to the recruiter who submitted the job description', () => {
    expect(SYSTEM_PROMPTS.FIT_ASSESSOR).toContain(
      `Write all prose fields in first person as ${resumeIdentity.firstName}, speaking directly to the recruiter or hiring manager who submitted the job description.`
    )
    expect(SYSTEM_PROMPTS.FIT_ASSESSOR).toContain(
      `In recommendation, tell that reader whether this role is right for ${resumeIdentity.firstName} and give them a useful next step.`
    )
    expect(SYSTEM_PROMPTS.FIT_ASSESSOR).toContain(
      `Never write self-addressed notes or advice aimed at ${resumeIdentity.firstName}, such as "I should focus my energy on..." or "Do not pursue this role."`
    )
    expect(fitAssessmentResultSchema.shape.recommendation.description).toBe(
      'Direct first-person message, written as the candidate to the recruiter who submitted the job description, on whether this role is the right fit and what a useful next step would be.'
    )
  })

  it('documents the fit assessor cross-field output contract', () => {
    expect(SYSTEM_PROMPTS.FIT_ASSESSOR).toContain(
      'Keep verdict, fitScore, matches, keyGaps, and disqualifiers internally consistent.'
    )
    expect(SYSTEM_PROMPTS.FIT_ASSESSOR).toContain(
      'Strong Fit requires fitScore >= 70, at least one documented match, and no disqualifiers.'
    )
    expect(SYSTEM_PROMPTS.FIT_ASSESSOR).toContain(
      'Partial Fit requires 25 <= fitScore <= 85, at least one documented match, at least one key gap, and no disqualifiers.'
    )
    expect(SYSTEM_PROMPTS.FIT_ASSESSOR).toContain(
      'Not a Fit requires fitScore <= 55 and at least one disqualifier.'
    )
    expect(SYSTEM_PROMPTS.FIT_ASSESSOR).toContain(
      'Use disqualifiers only for true hard blockers. Use keyGaps for meaningful but non-disqualifying gaps.'
    )
    expect(SYSTEM_PROMPTS.FIT_ASSESSOR).toContain('Must-have gaps outweigh nice-to-have matches.')
  })

  it('uses a selective prompt projection instead of dumping the raw canonical resume shape', () => {
    const promptContext = createResumePromptContext()
    const yamlMatch = promptContext.match(/<RESUME-CONTENT>\n([\s\S]+)\n<\/RESUME-CONTENT>/)

    expect(yamlMatch).not.toBeNull()

    const yamlContent = yamlMatch?.[1] ?? ''
    const parsed = YAML.parse(yamlContent) as Record<string, unknown>

    expect(Object.keys(parsed).sort()).toEqual([
      'awards',
      'candidateProfile',
      'certificationEvidence',
      'education',
      'experienceEvidence',
      'leadershipEvidence',
      'projectEvidence',
      'publicContact',
      'roleTargets',
      'skillsSnapshot',
    ])
    expect(parsed).not.toHaveProperty('contact')
    expect(parsed).not.toHaveProperty('experience')
    expect(parsed).not.toHaveProperty('projects')
    expect(parsed).not.toHaveProperty('skills')
    expect(parsed).not.toHaveProperty('github')
    // Derived from canonical content (not persona literals) so personalizing the
    // resume keeps this green; asserts the prompt projects the owner's contact.
    expect(parsed.publicContact).toEqual({
      email: resumeContact.email,
      linkedIn: resumeContact.linkedinUrl,
    })
    expect(yamlContent).toContain('\n\npublicContact:')
    expect(yamlContent).toContain('\n\neducation:')

    // education is projected as a list so multiple degrees are supported. The first
    // degree is sourced from canonical content, so it stays green across personas.
    expect(Array.isArray(parsed.education)).toBe(true)
    expect((parsed.education as Array<{ degree: string }>)[0]?.degree).toBe(
      resumeData.education[0].degree
    )
  })

  it('keeps homepage proof and public contact projected from canonical data', () => {
    const evidenceIds = new Set(
      [...resumeData.experience, ...resumeData.projects].map((item) => item.id)
    )

    expect(
      resumeViewModel.homepage.proofPoints.every((proofPoint) =>
        evidenceIds.has(proofPoint.sourceId)
      )
    ).toBe(true)

    // Re-derive the expected URL from the raw canonical path to verify the
    // scheme-strip + https normalization wiring, independent of any persona.
    const expectedLinkedinUrl = `https://${resumeData.contact.linkedinPath
      .replace(/^https?:\/\//, '')
      .replace(/^\/+/, '')}`
    expect(resumeViewModel.contact.linkedinUrl).toBe(expectedLinkedinUrl)
  })
})
