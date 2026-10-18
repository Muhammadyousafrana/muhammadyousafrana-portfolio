import { CHAT_TOOL_NAME, type ContactHandoffStatus } from '@shared/chat-tools'
import { buildContactRelayMessage, sanitizeOptionalContactDetail } from '@shared/contact-handoff'
import {
  getToolPartName,
  isRecord,
  readContactHandoffStatus,
  readString,
  type ChatToolPart,
} from './chat-message-utils'
import type {
  ContactHandoffFormErrors,
  ContactHandoffFormState,
  PendingToolContinuationAction,
} from './useResumeChat'

type ContactFlowStateContext = {
  contactHandoffInputs: Record<string, ContactHandoffFormState>
  contactHandoffInputErrors: Record<string, ContactHandoffFormErrors>
  // Whole-form submit notices (blocked resolution detail, in-flight retry hint)
  // that keep the form open rather than resolving the tool call.
  contactHandoffSubmitNotices: Record<string, string>
  pendingToolContinuations: Record<string, PendingToolContinuationAction>
}

export type ContactFlowActions = {
  setContactHandoffInput: (
    toolCallId: string,
    field: keyof ContactHandoffFormState,
    value: string
  ) => void
  completeContactHandoff: (toolCallId: string) => Promise<void>
  cancelContactHandoff: (toolCallId: string) => Promise<void>
}

export type ToolRenderContext = ContactFlowStateContext & ContactFlowActions

type ContactFlowDetails = {
  contactName?: string
  contactPhone?: string
  contactCompany?: string
  contactMessage?: string
  relayMessage?: string
}

type ContactFlowPhase =
  | 'collecting_details'
  | 'sending'
  | 'sent'
  | 'simulated'
  | 'cancelled'
  | 'failed'

export type ContactFlowState = {
  phase: ContactFlowPhase
  /** Failure detail passed through from the server; rendered only by the failed receipt. */
  summary?: string
  /** Which in-flight action the sending phase represents. */
  pendingAction?: 'submit' | 'cancel'
  requestPart?: ChatToolPart
  details: ContactFlowDetails
  formState: ContactHandoffFormState
  formErrors: ContactHandoffFormErrors
  submitNotice?: string
}

export const EMPTY_CONTACT_HANDOFF_FORM: ContactHandoffFormState = {
  contactName: '',
  contactPhone: '',
  contactCompany: '',
  contactMessage: '',
}

export const isTerminalContactFlowPhase = (phase: ContactFlowPhase): boolean =>
  phase === 'sent' || phase === 'simulated' || phase === 'cancelled' || phase === 'failed'

const getLatestRequestPart = (parts: ChatToolPart[]): ChatToolPart | undefined => {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (getToolPartName(part) === CHAT_TOOL_NAME.showContactForm) {
      return part
    }
  }

  return undefined
}

const getRequestResult = (part: ChatToolPart | undefined): Record<string, unknown> | undefined =>
  part?.state === 'output-available' && isRecord(part.output) ? part.output : undefined

const getPartErrorMessage = (part: ChatToolPart | undefined): string | undefined => {
  if (!part) {
    return undefined
  }

  if (part.state === 'output-error') {
    return 'errorText' in part ? readString(part.errorText) : undefined
  }

  const result = getRequestResult(part)
  return result ? readString(result.error) : undefined
}

type NormalizedContactFlow = {
  requestPart?: ChatToolPart
  details: ContactFlowDetails
  formState: ContactHandoffFormState
  formErrors: ContactHandoffFormErrors
  submitNotice?: string
  requestPendingAction?: PendingToolContinuationAction
  requestResult?: Record<string, unknown>
  requestResultStatus?: ContactHandoffStatus
  requestResultStatusRaw?: string
  requestResultDetail?: string
  requestErrorMessage?: string
}

const buildContactFlowDetails = (
  requestPart: ChatToolPart | undefined,
  requestResult: Record<string, unknown> | undefined,
  context: ContactFlowStateContext
): ContactFlowDetails => {
  const localFormState = requestPart
    ? (context.contactHandoffInputs[requestPart.toolCallId] ?? EMPTY_CONTACT_HANDOFF_FORM)
    : EMPTY_CONTACT_HANDOFF_FORM
  const contactPhone =
    readString(requestResult?.contactPhone) ?? readString(localFormState.contactPhone)
  const contactName = sanitizeOptionalContactDetail(
    readString(requestResult?.contactName) ?? readString(localFormState.contactName)
  )
  const contactCompany = sanitizeOptionalContactDetail(
    readString(requestResult?.contactCompany) ?? readString(localFormState.contactCompany)
  )
  const contactMessage =
    readString(requestResult?.contactMessage) ?? readString(localFormState.contactMessage)
  const relayMessage =
    readString(requestResult?.preview) ??
    (contactPhone
      ? buildContactRelayMessage({
          contactPhone,
          contactMessage,
          contactName,
          contactCompany,
        })
      : contactMessage)

  return {
    contactName,
    contactPhone,
    contactCompany,
    contactMessage,
    relayMessage,
  }
}

const normalizeContactFlow = (
  contactParts: ChatToolPart[],
  context: ContactFlowStateContext
): NormalizedContactFlow | null => {
  if (contactParts.length === 0) {
    return null
  }

  const requestPart = getLatestRequestPart(contactParts)
  const requestResult = getRequestResult(requestPart)

  return {
    requestPart,
    details: buildContactFlowDetails(requestPart, requestResult, context),
    formState: requestPart
      ? (context.contactHandoffInputs[requestPart.toolCallId] ?? EMPTY_CONTACT_HANDOFF_FORM)
      : EMPTY_CONTACT_HANDOFF_FORM,
    formErrors: requestPart
      ? (context.contactHandoffInputErrors[requestPart.toolCallId] ?? {})
      : {},
    submitNotice: requestPart
      ? context.contactHandoffSubmitNotices[requestPart.toolCallId]
      : undefined,
    requestPendingAction: requestPart
      ? context.pendingToolContinuations[requestPart.toolCallId]
      : undefined,
    requestResult,
    requestResultStatus: readContactHandoffStatus(requestResult?.status),
    requestResultStatusRaw: readString(requestResult?.status),
    requestResultDetail: readString(requestResult?.detail),
    requestErrorMessage: getPartErrorMessage(requestPart),
  }
}

const resolveContactFlowState = ({
  requestPart,
  details,
  formState,
  formErrors,
  submitNotice,
  requestPendingAction,
  requestResult,
  requestResultStatus,
  requestResultStatusRaw,
  requestResultDetail,
  requestErrorMessage,
}: NormalizedContactFlow): ContactFlowState => {
  const sharedState = {
    requestPart,
    details,
    formState,
    formErrors,
    ...(submitNotice ? { submitNotice } : {}),
  }

  if (requestPart?.state === 'output-error') {
    return {
      ...sharedState,
      phase: 'failed',
      summary: requestErrorMessage ?? "The message couldn't be delivered.",
    }
  }

  if (requestResult?.cancelled === true) {
    return {
      ...sharedState,
      phase: 'cancelled',
    }
  }

  if (requestResultStatus === 'sent') {
    return {
      ...sharedState,
      phase: 'sent',
    }
  }

  if (requestResultStatus === 'simulated') {
    return {
      ...sharedState,
      phase: 'simulated',
    }
  }

  if (requestResultStatus === 'blocked' || requestResultStatus === 'error') {
    return {
      ...sharedState,
      phase: 'failed',
      summary: requestResultDetail ?? requestErrorMessage ?? "The message couldn't be delivered.",
    }
  }

  if (requestPart?.state === 'output-available' && requestResultStatusRaw) {
    return {
      ...sharedState,
      phase: 'failed',
      summary:
        requestResultDetail ??
        requestErrorMessage ??
        'The contact request returned an unknown delivery status.',
    }
  }

  if (requestPendingAction === 'handoff-cancel') {
    return {
      ...sharedState,
      phase: 'sending',
      pendingAction: 'cancel',
    }
  }

  if (requestPendingAction === 'handoff-submit' || requestPart?.state === 'output-available') {
    return {
      ...sharedState,
      phase: 'sending',
      pendingAction: 'submit',
    }
  }

  return {
    ...sharedState,
    phase: 'collecting_details',
  }
}

export const deriveContactFlowState = (
  contactParts: ChatToolPart[],
  context: ToolRenderContext
): ContactFlowState | null => {
  const normalized = normalizeContactFlow(contactParts, context)
  return normalized ? resolveContactFlowState(normalized) : null
}
