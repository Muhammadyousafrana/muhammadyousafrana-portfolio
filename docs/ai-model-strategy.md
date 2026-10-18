# AI Model Strategy

The runtime source of truth for provider selection and model order is
[`../shared/models.ts`](../shared/models.ts). Set the non-secret `AI_PROVIDER` Worker var to switch
the whole app; chat, fit analysis, and health routes share the selected provider profile.

## Provider profiles

| `AI_PROVIDER`    | Model order                                                             | Runtime path                                   |
| ---------------- | ----------------------------------------------------------------------- | ---------------------------------------------- |
| `workers-ai`     | `@cf/google/gemma-4-26b-a4b-it`, then `@cf/zai-org/glm-4.7-flash`       | Workers AI `AI` binding through the Gateway ID |
| `google-gateway` | `google-ai-studio/gemini-3.1-flash-lite`, then `gemini-3-flash-preview` | Native Google through Cloudflare AI Gateway    |

Fallback never crosses providers. Workers chat falls back only when dispatch fails before returning
a stream; it never splices a second model into an established stream. Workers fit and health use
app-side fallback. Workers fit cancels with the incoming request and caps each of its two model
attempts at 30 seconds. Google keeps Gateway-native chat fallback and app-side fit fallback. To
change order or ids, edit `shared/models.ts`. Routes remain unchanged.

## Runtime seam

[`../worker/model-utils.ts`](../worker/model-utils.ts) resolves a discriminated runtime and exposes
provider-neutral text and structured-model helpers:

- Workers AI uses `workers-ai-provider` for streaming, tools, and structured output. The `AI`
  binding authorizes inference; `CF_AI_GATEWAY_TOKEN` is not used.
- Google chat uses the native Google wire to preserve Gemini thought signatures across tool
  continuations. Google fit analysis keeps the compat structured-output path.

Both profiles parse `CF_AI_BASE_URL` as a Gateway locator. `CF_AI_GATEWAY_TOKEN` is server-side and
required only for `google-gateway`.

## Related docs

- AI transport in the whole-system map: [architecture.md](./architecture.md)
- Fit-analysis contract: [structured-output-prompt-guidelines.md](./structured-output-prompt-guidelines.md)
