import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import {
  CHAT_TOOL_NAME,
  CONTACT_HANDOFF_COMPANY_MAX_LENGTH,
  CONTACT_HANDOFF_NAME_MAX_LENGTH,
  CONTACT_HANDOFF_STATUS,
  CONTACT_SMS_MAX_LENGTH,
} from '../shared/chat-tools'
import { normalizeContactPhoneInput } from '../shared/contact-handoff'
import { resumeIdentity } from '../shared/resume-canonical'
import { executeLocalTool, type ToolExecutionContext } from './tools'

const contactPhoneSchema = z.string().transform((value, ctx) => {
  const normalized = normalizeContactPhoneInput(value)
  if (normalized === null) {
    ctx.addIssue({
      code: 'custom',
      message: 'Callback phone must be a valid phone number.',
    })
    return z.NEVER
  }
  return normalized
})

const contactHandoffSubmissionSchema = z.object({
  contactName: z.string().min(1).max(CONTACT_HANDOFF_NAME_MAX_LENGTH),
  contactPhone: contactPhoneSchema,
  contactCompany: z.string().min(1).max(CONTACT_HANDOFF_COMPANY_MAX_LENGTH).optional(),
  contactMessage: z.string().max(CONTACT_SMS_MAX_LENGTH).optional(),
  answeredAt: z.string().min(1),
})

const contactHandoffCancelledOutputSchema = z.object({
  cancelled: z.literal(true),
  detail: z.string().optional(),
})

const contactHandoffResolutionShape = {
  status: z.enum(CONTACT_HANDOFF_STATUS),
  detail: z.string(),
  preview: z.string(),
  sid: z.string().optional(),
} satisfies z.ZodRawShape

const contactHandoffResolvedOutputSchema = z.object({
  contactName: contactHandoffSubmissionSchema.shape.contactName,
  contactPhone: contactHandoffSubmissionSchema.shape.contactPhone,
  contactCompany: contactHandoffSubmissionSchema.shape.contactCompany,
  contactMessage: contactHandoffSubmissionSchema.shape.contactMessage,
  answeredAt: contactHandoffSubmissionSchema.shape.answeredAt,
  ...contactHandoffResolutionShape,
})

const showContactFormToolOutputSchema = z.union([
  contactHandoffResolvedOutputSchema,
  contactHandoffSubmissionSchema,
  contactHandoffCancelledOutputSchema,
])

type BuildLocalChatToolsOptions = {
  toolExecutionContext: ToolExecutionContext
}

export function buildLocalChatTools(options: BuildLocalChatToolsOptions): ToolSet {
  // This registry is the only model-visible local tool surface. Re-adding web_search
  // means defining it here and keeping its name aligned with executeLocalTool.
  return {
    [CHAT_TOOL_NAME.getWeather]: tool({
      description:
        'Get current weather for a place. Pass a city name, keeping a state or country when it helps disambiguate ("Vancouver, WA", "Paris, France"), or a latitude+longitude pair. Omit the location to use the requester\'s own location.',
      inputSchema: z.object({
        location: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        use_request_location: z.boolean().optional(),
      }),
      execute: async (args) =>
        executeLocalTool(CHAT_TOOL_NAME.getWeather, args, options.toolExecutionContext),
    }),
    [CHAT_TOOL_NAME.showContactForm]: tool({
      description: `Render an in-chat contact form so the person can reach ${resumeIdentity.firstName}. The form collects a name and callback phone (required), plus an optional company and note, then the person submits or cancels. After the tool resolves, its result is authoritative: describe it literally and do not narrate further form steps.`,
      inputSchema: z.object({}),
      outputSchema: showContactFormToolOutputSchema,
      strict: true,
    }),
  }
}
