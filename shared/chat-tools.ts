import { resumeIdentity } from './resume-canonical'

// Tool names are part of the chat-session wire contract because persisted UI messages
// reference them directly. Renaming a tool can invalidate an in-flight session after deploy.
// That tradeoff is acceptable here because chat sessions are ephemeral; do not add legacy
// aliasing unless the product later needs long-lived session continuity.
export const CHAT_TOOL_NAME = {
  getWeather: 'get_weather',
  showContactForm: 'show_contact_form',
} as const

export type ChatToolName = (typeof CHAT_TOOL_NAME)[keyof typeof CHAT_TOOL_NAME]

export const CONTACT_SMS_MAX_LENGTH = 480
export const CONTACT_HANDOFF_NAME_MAX_LENGTH = 120
export const CONTACT_HANDOFF_COMPANY_MAX_LENGTH = 160
export const CONTACT_HANDOFF_STATUS = ['sent', 'simulated', 'blocked', 'error'] as const

export type ContactHandoffStatus = (typeof CONTACT_HANDOFF_STATUS)[number]

export type ContactHandoffSubmission = {
  contactName: string
  contactPhone: string
  contactCompany?: string
  contactMessage?: string
  answeredAt: string
}

export type ContactHandoffResolution = {
  status: ContactHandoffStatus
  detail: string
  preview: string
  sid?: string
}

export const isContactHandoffStatus = (value: string): value is ContactHandoffStatus =>
  CONTACT_HANDOFF_STATUS.some((status) => status === value)

export const CHAT_TOOL_UI = {
  [CHAT_TOOL_NAME.getWeather]: {
    title: 'Weather',
  },
  [CHAT_TOOL_NAME.showContactForm]: {
    title: `Contact ${resumeIdentity.firstName}`,
  },
} as const satisfies Record<ChatToolName, { title: string }>

export const isKnownChatToolName = (value: string): value is ChatToolName =>
  Object.prototype.hasOwnProperty.call(CHAT_TOOL_UI, value)
