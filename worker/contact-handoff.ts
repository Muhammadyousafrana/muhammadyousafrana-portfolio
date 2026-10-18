import {
  CONTACT_HANDOFF_COMPANY_MAX_LENGTH,
  CONTACT_HANDOFF_NAME_MAX_LENGTH,
  CONTACT_SMS_MAX_LENGTH,
  type ContactHandoffResolution,
} from '../shared/chat-tools'
import {
  buildContactRelayMessage,
  normalizeContactPhoneInput,
  normalizeStrictE164Phone,
  sanitizeOptionalContactDetail,
} from '../shared/contact-handoff'
import { resumeData } from '../shared/resume-canonical'
import { isRecord, toText } from './value-utils'

// Contact-handoff validation and Twilio dispatch, ported from the Durable
// Object chat agent (worker/agent.ts) so the stateless POST /api/contact-handoff
// route can run the exact same logic without a DO. This module is
// transport-free: no UIMessage rewriting, no persistence — the route composes
// these steps around its own idempotency guard.

export type ContactHandoffEnv = {
  CONTACT_SMS_TO_NUMBER?: string
  TWILIO_ACCOUNT_SID?: string
  TWILIO_AUTH_TOKEN?: string
  TWILIO_FROM_NUMBER?: string
}

// Fields echoed back to the client alongside the resolution. All optional
// because a blocked validation can be missing/failing any of them.
export type ContactSubmissionFields = {
  contactName?: string
  contactPhone?: string
  contactCompany?: string
  contactMessage?: string
}

// Validated, dispatch-ready submission. `contactMessage` here is the RELAY
// message (the user's note, or a generated fallback line) — the SMS payload —
// while the echoed fields keep the user's original message.
export type NormalizedContactSubmission = {
  contactPhone: string
  contactMessage: string
  contactName: string
  contactCompany?: string
}

export type ContactHandoffValidationResult =
  | { ok: true; submission: NormalizedContactSubmission; fields: ContactSubmissionFields }
  | { ok: false; resolution: ContactHandoffResolution; fields: ContactSubmissionFields }

export type ContactSmsDispatchPlan =
  | { kind: 'resolved'; resolution: ContactHandoffResolution }
  | { kind: 'live'; endpoint: string; authorization: string; payload: string }

const TWILIO_MESSAGE_MAX_LENGTH = CONTACT_SMS_MAX_LENGTH
const TWILIO_FETCH_TIMEOUT_MS = 10_000

const truncatePreview = (value: string, maxLength = 120): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`

export const buildContactResolution = (
  input: ContactSubmissionFields,
  overrides: Omit<ContactHandoffResolution, 'preview'>
): ContactHandoffResolution => ({
  ...overrides,
  preview: truncatePreview(
    input.contactPhone
      ? buildContactRelayMessage({
          contactPhone: input.contactPhone,
          contactMessage: input.contactMessage,
          contactName: input.contactName,
          contactCompany: input.contactCompany,
        })
      : (input.contactMessage ?? '')
  ),
})

const buildSmsBody = (input: NormalizedContactSubmission): string => {
  const relayMessage = buildContactRelayMessage({
    contactPhone: input.contactPhone,
    contactMessage: input.contactMessage,
    contactName: input.contactName,
    contactCompany: input.contactCompany,
  })

  return [
    `Contact request for ${resumeData.name}`,
    input.contactName ? `Name: ${input.contactName}` : undefined,
    input.contactCompany ? `Company: ${input.contactCompany}` : undefined,
    `Callback phone: ${input.contactPhone}`,
    `Message: ${relayMessage}`,
  ]
    .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    .join('\n')
}

const blocked = (
  fields: ContactSubmissionFields,
  detail: string
): Extract<ContactHandoffValidationResult, { ok: false }> => ({
  ok: false,
  resolution: buildContactResolution(fields, { status: 'blocked', detail }),
  fields,
})

// The DO flow relied on the show_contact_form output zod schema having
// pre-screened submissions before executeContactHandoff ran. This endpoint
// takes raw client fields, so the same bounds (name/company/message length)
// are enforced here explicitly — otherwise an over-long field would come back
// inside a 'sent' resolution that then fails chat tool-output validation on
// the next turn.
export const validateContactHandoffSubmission = (args: unknown): ContactHandoffValidationResult => {
  const input = isRecord(args) ? args : {}
  const rawContactPhone = toText(input.contactPhone)
  const contactPhone = rawContactPhone ? normalizeContactPhoneInput(rawContactPhone) : null
  const contactMessage = toText(input.contactMessage)
  const contactName = sanitizeOptionalContactDetail(input.contactName)
  const contactCompany = sanitizeOptionalContactDetail(input.contactCompany)
  const rawFields: ContactSubmissionFields = {
    ...(rawContactPhone ? { contactPhone: rawContactPhone } : {}),
    ...(contactMessage ? { contactMessage } : {}),
    ...(contactName ? { contactName } : {}),
    ...(contactCompany ? { contactCompany } : {}),
  }

  if (!contactPhone) {
    return blocked(
      rawFields,
      'A valid callback phone is required before sending the contact request.'
    )
  }

  if (!contactName) {
    return blocked(rawFields, 'A name is required before sending the contact request.')
  }

  if (contactName.length > CONTACT_HANDOFF_NAME_MAX_LENGTH) {
    return blocked(
      rawFields,
      `The name must be at most ${CONTACT_HANDOFF_NAME_MAX_LENGTH} characters.`
    )
  }

  if (contactCompany && contactCompany.length > CONTACT_HANDOFF_COMPANY_MAX_LENGTH) {
    return blocked(
      rawFields,
      `The company must be at most ${CONTACT_HANDOFF_COMPANY_MAX_LENGTH} characters.`
    )
  }

  const relayMessage = buildContactRelayMessage({
    contactPhone,
    contactMessage,
    contactName,
    contactCompany,
  })
  const normalizedFields: ContactSubmissionFields = {
    contactName,
    contactPhone,
    ...(contactCompany ? { contactCompany } : {}),
    ...(contactMessage ? { contactMessage } : {}),
  }

  if (relayMessage.length > TWILIO_MESSAGE_MAX_LENGTH) {
    return blocked(
      { ...normalizedFields, contactMessage: relayMessage },
      `The message must be at most ${TWILIO_MESSAGE_MAX_LENGTH} characters.`
    )
  }

  return {
    ok: true,
    submission: {
      contactPhone,
      contactMessage: relayMessage,
      contactName,
      ...(contactCompany ? { contactCompany } : {}),
    },
    fields: normalizedFields,
  }
}

// Decide whether a real SMS will be attempted. `resolved` outcomes (simulation
// mode, invalid delivery config) never touch the idempotency store because no
// message was — or could be — sent.
export const planContactSmsDispatch = (
  env: ContactHandoffEnv,
  submission: NormalizedContactSubmission
): ContactSmsDispatchPlan => {
  const destinationNumber = env.CONTACT_SMS_TO_NUMBER?.trim()
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim()
  const authToken = env.TWILIO_AUTH_TOKEN?.trim()
  const fromNumber = env.TWILIO_FROM_NUMBER?.trim()

  if (!destinationNumber || !accountSid || !authToken || !fromNumber) {
    return {
      kind: 'resolved',
      resolution: buildContactResolution(submission, {
        status: 'simulated',
        detail: 'Text handoff ran in simulation mode. No live message was sent.',
      }),
    }
  }

  const normalizedDestinationNumber = normalizeStrictE164Phone(destinationNumber)
  if (!normalizedDestinationNumber) {
    console.error('[contact-handoff] Text delivery destination is invalid.')
    return {
      kind: 'resolved',
      resolution: buildContactResolution(submission, {
        status: 'error',
        detail: 'Text delivery is unavailable right now.',
      }),
    }
  }

  const normalizedFromNumber = normalizeStrictE164Phone(fromNumber)
  if (!normalizedFromNumber) {
    console.error('[contact-handoff] Text delivery sender is invalid.')
    return {
      kind: 'resolved',
      resolution: buildContactResolution(submission, {
        status: 'error',
        detail: 'Text delivery is unavailable right now.',
      }),
    }
  }

  return {
    kind: 'live',
    endpoint: `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
    payload: new URLSearchParams({
      To: normalizedDestinationNumber,
      From: normalizedFromNumber,
      Body: buildSmsBody(submission),
    }).toString(),
  }
}

export const sendContactSms = async (
  plan: Extract<ContactSmsDispatchPlan, { kind: 'live' }>,
  submission: NormalizedContactSubmission
): Promise<ContactHandoffResolution> => {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TWILIO_FETCH_TIMEOUT_MS)

    try {
      const response = await fetch(plan.endpoint, {
        method: 'POST',
        headers: {
          Authorization: plan.authorization,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: plan.payload,
        signal: controller.signal,
      })

      const data = (await response.json()) as Record<string, unknown>
      if (!response.ok) {
        const twilioMessage = toText(data.message) || `Twilio HTTP ${response.status}`
        console.error('[contact-handoff] Text delivery failed', {
          status: response.status,
          detail: twilioMessage,
        })
        return buildContactResolution(submission, {
          status: 'error',
          detail: 'Text delivery failed. Please try again later.',
        })
      }

      return buildContactResolution(submission, {
        status: 'sent',
        detail: 'Text sent successfully.',
        ...(typeof data.sid === 'string' ? { sid: data.sid } : {}),
      })
    } finally {
      clearTimeout(timeoutId)
    }
  } catch (error) {
    const detail =
      error instanceof Error && error.name === 'AbortError'
        ? `Twilio request timed out after ${TWILIO_FETCH_TIMEOUT_MS}ms`
        : error instanceof Error
          ? error.message
          : 'Unknown Twilio dispatch error'
    console.error('[contact-handoff] Text delivery threw an error', {
      detail,
    })
    return buildContactResolution(submission, {
      status: 'error',
      detail: 'Text delivery failed. Please try again later.',
    })
  }
}
