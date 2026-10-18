export const AI_PROVIDER_IDS = ['workers-ai', 'google-gateway'] as const

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number]
export type ModelCandidates = readonly [string, ...string[]]

const DEFAULT_AI_PROVIDER: AiProviderId = 'workers-ai'

const MODEL_CHAINS = {
  'workers-ai': ['@cf/google/gemma-4-26b-a4b-it', '@cf/zai-org/glm-4.7-flash'],
  'google-gateway': [
    'google-ai-studio/gemini-3.1-flash-lite',
    'google-ai-studio/gemini-3-flash-preview',
  ],
} as const

export const parseAiProvider = (value?: string | null): AiProviderId | undefined => {
  const normalized = value?.trim() || DEFAULT_AI_PROVIDER
  return AI_PROVIDER_IDS.find((provider) => provider === normalized)
}

export const getModelIds = (provider: AiProviderId): ModelCandidates => MODEL_CHAINS[provider]
