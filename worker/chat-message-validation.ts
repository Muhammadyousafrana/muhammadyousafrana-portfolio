import { TypeValidationError } from '@ai-sdk/provider'
import { validateTypes } from '@ai-sdk/provider-utils'
import { getToolName, isToolUIPart, safeValidateUIMessages, type ToolSet, type UIMessage } from 'ai'

type SafeValidateChatMessagesResult =
  | {
      success: true
      data: UIMessage[]
    }
  | {
      success: false
      error: Error
    }

export const safeValidateChatMessages = async ({
  messages,
  tools,
}: {
  messages: UIMessage[]
  tools: ToolSet
}): Promise<SafeValidateChatMessagesResult> => {
  const validation = await safeValidateUIMessages({ messages })
  if (!validation.success) {
    return validation
  }

  try {
    for (const [messageIndex, message] of validation.data.entries()) {
      for (const [partIndex, part] of message.parts.entries()) {
        if (!isToolUIPart(part)) {
          continue
        }

        const toolName = getToolName(part)
        const tool = Object.prototype.hasOwnProperty.call(tools, toolName)
          ? tools[toolName]
          : undefined
        if (!tool) {
          // The usual cause here is a deployed tool-contract rename while an older chat tab
          // still has persisted tool parts. This app accepts that break because sessions are
          // ephemeral and users can recover by starting a fresh chat.
          throw new TypeValidationError({
            value: part.input,
            cause: `No tool schema found for tool part ${toolName}`,
            context: {
              field: `messages[${messageIndex}].parts[${partIndex}].input`,
              entityName: toolName,
              entityId: part.toolCallId,
            },
          })
        }

        if (
          part.state === 'input-available' ||
          part.state === 'output-available' ||
          (part.state === 'output-error' && part.input !== undefined)
        ) {
          await validateTypes({
            value: part.input,
            schema: tool.inputSchema,
            context: {
              field: `messages[${messageIndex}].parts[${partIndex}].input`,
              entityName: toolName,
              entityId: part.toolCallId,
            },
          })
        }

        if (part.state === 'output-available' && tool.outputSchema) {
          await validateTypes({
            value: part.output,
            schema: tool.outputSchema,
            context: {
              field: `messages[${messageIndex}].parts[${partIndex}].output`,
              entityName: toolName,
              entityId: part.toolCallId,
            },
          })
        }
      }
    }

    return validation
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}
