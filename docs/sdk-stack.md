# SDK Stack

The chat runtime uses one SDK layer over plain HTTP. Keeping the SDK contract separate from the repo's route/security code lets the repo change providers or transport details without rewriting the recruiter-facing product.

## The layers

| Layer           | What it owns                                                                                                    | Why it exists here                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ai`            | Model calls, tool definitions, `UIMessage` format, loop control, message conversion, base UI-message validation | This is the app-layer contract. Chat behavior, tool semantics, and provider swaps are all expressed here. |
| `@ai-sdk/react` | `useChat` client state and the `DefaultChatTransport` that POSTs each turn to `/api/chat`                       | The browser needs optimistic chat state and a streaming transport without hand-rolled protocol code.      |

The AI SDK does not replace the repo's HTTP/bootstrap/security routes. Those concerns stay in `worker/userRoutes.ts` and `worker/routes/chat-routes.ts`.

## High-Level Flow

1. The client calls `/api/chat/bootstrap` to learn whether Turnstile is required, then chats with `useChat` over `DefaultChatTransport` POSTs to `/api/chat`, sending the full client-held `UIMessage` history with each turn.
2. `worker/routes/chat-routes.ts` guards every chat and contact-handoff POST: tenant context, Turnstile lease (with a per-request token fallback), per-tenant/per-IP rate limits, and a bounded JSON body parse. `worker/userRoutes.ts` owns the bootstrap and verify-turnstile entry points.
3. The route sanitizes the untrusted client history (role filtering, file-part rejection, whole-message windowing), validates it, converts it for the model, and calls `streamText(...)`.
4. The assistant response streams back as a `UIMessage` stream; the client persists the transcript in `sessionStorage`. If a tool continuation is needed, the client resubmits the same history instead of starting a separate protocol.

## Validation Boundaries

- **Client validation**: the contact form validates required fields, phone normalization, and length limits before it sends tool output.
- **Transport and admission validation**: `worker/userRoutes.ts` gates the bootstrap entry points, and `worker/routes/chat-routes.ts` rechecks every chat and handoff POST so crafted requests do not bypass security.
- **Message and schema validation**: `worker/chat-message-validation.ts` runs `safeValidateChatMessages(...)` before model conversion. That repo wrapper first calls `safeValidateUIMessages(...)` for base `UIMessage` structure, then validates tool inputs and outputs against the Zod schemas from `worker/chat-tools.ts`.

## Tool Patterns In This Repo

- **Server-executed local tools**: tools like `get_weather` execute directly from the model-visible registry in `worker/chat-tools.ts`.
- **Client-side continuation tool**: `show_contact_form` has no `execute`. The model opens the form, the UI collects contact details, and the client sends the result back with `addToolOutput(...)`.
- **Server-side handoff resolution**: when the form is submitted, the client POSTs the details to `/api/contact-handoff`, which resolves the SMS dispatch server-side. Terminal outcomes (`sent`, `simulated`, or `error`) are fed back as the tool output via `addToolOutput(...)` and the model narrates them; a `blocked` validation result keeps the form open instead (no tool output). Cancelling the form resolves locally.
- **Same-turn re-entry**: the serialized tool list stays stable across steps (prompt-cache friendly), and the tool description plus prompt guidance steer the model away from reopening a form it already resolved this turn. This is best-effort steering, not a hard block.

## Tool Part Lifecycle

```text
input-streaming → input-available → output-available
                                  → output-error
```

## Where Security And Transport Sit

Security and admission are intentionally outside the SDK abstraction layer. The AI SDK helps express chat behavior after a request is admitted; it is not the repo's tenant isolation, origin policy, rate-limit, request-size, or Turnstile boundary.

That split matters because the product needs stable recruiter-facing chat behavior and strict admission rules at the same time. Provider migrations belong in the chat runtime layer, while security policy stays at the route boundary.
