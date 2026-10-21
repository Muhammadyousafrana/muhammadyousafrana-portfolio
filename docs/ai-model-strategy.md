# Gemini model setup

The deployed app uses Google AI Studio directly. Set `AI_PROVIDER=google-ai-studio` and provide the
server-side `GOOGLE_GENERATIVE_AI_API_KEY`; no Cloudflare AI Gateway or Workers AI binding is needed.

Chat, fit analysis, and the AI health check use the model configured in
[`../shared/models.ts`](../shared/models.ts). The provider and model selection are shared by all
three routes. Keep the API key out of the browser bundle and any `VITE_` environment variable.

## Related docs

- AI transport in the whole-system map: [architecture.md](./architecture.md)
- Fit-analysis contract: [structured-output-prompt-guidelines.md](./structured-output-prompt-guidelines.md)
