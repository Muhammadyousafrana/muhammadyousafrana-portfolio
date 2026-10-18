import { isToolUIPart, type UIMessage } from 'ai'

type MessagePart = UIMessage['parts'][number]

// A part carries content the model can consume once `convertToModelMessages`
// runs with no custom converters: a tool part past `input-streaming`, a `file`
// part, or a non-empty text/reasoning part. Assistant `source-*`, `step-start`,
// `data-*`, and still-`input-streaming` tool parts are dropped by the conversion,
// so an assistant made only of those converts to nothing — treat them as no
// content so normalization removes such a turn.
const partHasModelContent = (part: MessagePart): boolean => {
  if (isToolUIPart(part)) {
    // convertToModelMessages skips a tool call still in `input-streaming`, so an
    // assistant whose only tool part never finished streaming converts to empty.
    return part.state !== 'input-streaming'
  }
  if (part.type === 'text' || part.type === 'reasoning') {
    return typeof part.text === 'string' && part.text.trim().length > 0
  }
  return part.type === 'file'
}

// An assistant turn with nothing the model can consume — an "empty completion".
// It passes UI validation (the tool loop skips empty parts) but breaks
// convertToModelMessages on the next turn, which poisons the whole session, so
// it must never reach the model or persistence.
export const isContentlessAssistantMessage = (message: UIMessage): boolean =>
  message.role === 'assistant' && !message.parts.some(partHasModelContent)

const getText = (message: UIMessage): string =>
  message.parts
    .filter((part): part is Extract<MessagePart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('')

// Merge an earlier user turn into a later one, keeping the later id/metadata so
// the client's optimistic message still reconciles. Text is joined with a blank
// line; any non-text parts are preserved after it.
const mergeUserMessages = (earlier: UIMessage, later: UIMessage): UIMessage => {
  const mergedText = [getText(earlier), getText(later)]
    .filter((text) => text.trim().length > 0)
    .join('\n\n')
  const nonTextParts = [...earlier.parts, ...later.parts].filter((part) => part.type !== 'text')
  return {
    ...later,
    parts: [...(mergedText ? [{ type: 'text' as const, text: mergedText }] : []), ...nonTextParts],
  }
}

// Repair a chat history so it converts cleanly for the model: drop contentless
// assistant turns (empty completions), then coalesce the consecutive user turns
// that dropping can expose. The gateway serializes messages one-for-one and
// Gemini rejects non-alternating roles, so leaving consecutive users would swap
// one failure for another. A healthy history is returned with its element
// references intact.
export const normalizeChatHistoryForModel = (messages: UIMessage[]): UIMessage[] => {
  const result: UIMessage[] = []
  for (const message of messages) {
    if (isContentlessAssistantMessage(message)) {
      continue
    }

    const previous = result[result.length - 1]
    if (message.role === 'user' && previous?.role === 'user') {
      result[result.length - 1] = mergeUserMessages(previous, message)
      continue
    }

    result.push(message)
  }
  return result
}
