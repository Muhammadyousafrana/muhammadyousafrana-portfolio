import type { ToolChipStatus } from '@/components/chat/tool-chips/ToolChipBase'
import {
  CHAT_TOOL_NAME,
  CHAT_TOOL_UI,
  isContactHandoffStatus,
  isKnownChatToolName,
  type ContactHandoffStatus,
} from '@shared/chat-tools'
import { getToolName, isToolUIPart, type UIMessage } from 'ai'

type ChatTextPart = Extract<UIMessage['parts'][number], { type: 'text' }>

export type ChatToolPart = Extract<
  UIMessage['parts'][number],
  { toolCallId: string; state: string }
>

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const readString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

export const readNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

export const readContactHandoffStatus = (value: unknown): ContactHandoffStatus | undefined => {
  const status = readString(value)
  return status && isContactHandoffStatus(status) ? status : undefined
}

export const getMessageText = (message: UIMessage): string =>
  (message.parts ?? [])
    .filter((part): part is ChatTextPart => part.type === 'text')
    .map((part) => part.text)
    .join('')

export const getToolParts = (message: UIMessage): ChatToolPart[] =>
  (message.parts ?? []).filter((part): part is ChatToolPart => isToolUIPart(part))

export const getToolPartName = (part: ChatToolPart): string => getToolName(part)

export const isContactToolName = (toolName: string): boolean =>
  toolName === CHAT_TOOL_NAME.showContactForm

export const isContactToolPart = (part: ChatToolPart): boolean =>
  isContactToolName(getToolPartName(part))

export const getToolTitle = (toolName: string): string =>
  isKnownChatToolName(toolName) ? CHAT_TOOL_UI[toolName].title : toolName

export const getToolStatus = (part: ChatToolPart): ToolChipStatus => {
  if (part.state === 'output-error' || part.state === 'output-denied') {
    return 'error'
  }

  if (part.state !== 'output-available') {
    return 'running'
  }

  const output = isRecord(part.output) ? part.output : {}
  if (readString(output.error)) {
    return 'error'
  }

  if (getToolPartName(part) === CHAT_TOOL_NAME.showContactForm) {
    if (output.cancelled === true) {
      return 'completed'
    }

    const statusRaw = readString(output.status)
    if (!statusRaw) {
      return 'running'
    }

    const status = readContactHandoffStatus(statusRaw)
    if (!status) {
      return 'error'
    }

    if (status === 'blocked' || status === 'error') {
      return 'error'
    }
  }

  return 'completed'
}
