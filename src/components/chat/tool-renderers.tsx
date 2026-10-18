import { ToolChipBase, type ToolChipStatus } from '@/components/chat/tool-chips/ToolChipBase'
import { WeatherCard } from '@/components/chat/tool-chips/WeatherCard'
import { CHAT_TOOL_NAME, isKnownChatToolName, type ChatToolName } from '@shared/chat-tools'
import type { ReactNode } from 'react'
import {
  getToolPartName,
  getToolStatus,
  getToolTitle,
  isRecord,
  readNumber,
  readString,
  type ChatToolPart,
} from './chat-message-utils'

type ToolRendererOptions = {
  part: ChatToolPart
  args: Record<string, unknown>
  result?: Record<string, unknown>
  status: ToolChipStatus
  errorMessage?: string
}

type ToolRenderer = (options: ToolRendererOptions) => ReactNode

const TOOL_RENDERERS = {
  [CHAT_TOOL_NAME.getWeather]: ({ args, result, status, errorMessage }: ToolRendererOptions) => (
    <WeatherCard
      state={status === 'completed' ? 'done' : status}
      location={
        readString(result?.resolvedLocation) ??
        readString(result?.location) ??
        readString(args.location)
      }
      temperature={readNumber(result?.temperature)}
      condition={readString(result?.condition)}
      humidity={readNumber(result?.humidity)}
      errorMessage={errorMessage}
    />
  ),
} satisfies Partial<Record<ChatToolName, ToolRenderer>>

export function renderToolPart(part: ChatToolPart) {
  const toolName = getToolPartName(part)
  const args = isRecord(part.input) ? part.input : {}
  const result =
    part.state === 'output-available' && isRecord(part.output) ? part.output : undefined
  const status = getToolStatus(part)
  const approvalReason =
    'approval' in part && isRecord(part.approval) ? readString(part.approval.reason) : undefined
  const errorMessage =
    part.state === 'output-error'
      ? 'errorText' in part
        ? readString(part.errorText)
        : undefined
      : part.state === 'output-denied'
        ? (approvalReason ?? 'Execution denied')
        : result
          ? readString(result.error)
          : undefined

  if (isKnownChatToolName(toolName)) {
    const renderer = TOOL_RENDERERS[toolName]
    if (renderer) {
      return renderer({ part, args, result, status, errorMessage })
    }
  }

  const fallbackSummary =
    part.state !== 'output-available'
      ? `Running ${toolName}`
      : (errorMessage ?? `Completed ${toolName}`)

  return (
    <ToolChipBase
      title={getToolTitle(toolName)}
      status={status}
      summary={fallbackSummary}
      error={errorMessage}
    />
  )
}
