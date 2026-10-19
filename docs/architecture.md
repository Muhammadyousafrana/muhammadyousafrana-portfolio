# Architecture

One-screen map of the system. Each subsystem names its **canonical file**: start there when you
change it. This doc stays altitude-high on purpose; per-subsystem detail lives in the linked docs.

## Topology

```
content/portfolio.yaml + content/prose/summary.md
  │  bun run content:build  (Zod-validated codegen, scripts/build-content.ts)
  ▼
shared/content.generated.ts  (committed)  →  shared/resume-canonical.ts  (typed exports)
  │                                              │  consumed by app, worker, prompts, tests
  ▼                                              ▼
Browser — React 19 SPA (route: /)
  │  same-origin fetch (chat history lives client-side in sessionStorage)
  ▼
Cloudflare Worker — Hono app  (worker/index.ts → worker/userRoutes.ts)
  │  route-specific security gates (subsets of: origin · tenant identity · Turnstile lease · rate limits · body caps)  (worker/security.ts)
  ├─ GET  /api/health                  basic liveness
  ├─ GET  /api/health/ai               AI gateway health probe (optional bearer)
  ├─ GET  /api/chat/bootstrap          challenge state for the client
  ├─ POST /api/chat/verify-turnstile   solve → signed lease cookie
  ├─ POST /api/chat                    streaming chat turn (worker/routes/chat-routes.ts)
  ├─ POST /api/contact-handoff         idempotent SMS handoff (worker/routes/chat-routes.ts)
  ├─ POST /api/analyze-fit             one-shot JSON fit helper (worker/routes/ai-routes.ts)
  └─ POST /api/client-errors           client error sink (metered)
                             │  streamText + tools
                             ▼
       selected model runtime  (AI_PROVIDER → Workers AI or native Google)
                             ▼
               model order from shared/models.ts

  AppController (Durable Object) — sharded rate-limit + contact-handoff idempotency state
```

## Subsystems

**Content seam.** The site is personalized through two source files, `content/portfolio.yaml`
(structured facts) and `content/prose/summary.md` (long-form summary). `bun run content:build`
validates them with Zod and regenerates the committed `shared/content.generated.ts`, which
`shared/resume-canonical.ts` re-exports as the typed resume/profile data the app, worker, prompts,
and tests all read. `bun run content:check` (first step of `bun run check`) guards against drift.
_Canonical: [`scripts/build-content.ts`](../scripts/build-content.ts),
[`shared/resume-canonical.ts`](../shared/resume-canonical.ts). Schema reference:
[`../SETUP.md`](../SETUP.md#stage-4---write-the-content)._

**Frontend SPA.** React 19 + Vite, a single route (`/`) via `react-router`. The chat launcher
lazy-mounts a dialog that streams chat turns over HTTP using `useChat` (`@ai-sdk/react`) with a
`DefaultChatTransport` that POSTs to `/api/chat`. _Canonical: [`src/main.tsx`](../src/main.tsx),
[`src/components/chat/useResumeChat.ts`](../src/components/chat/useResumeChat.ts). Layers doc:
[`sdk-stack.md`](./sdk-stack.md)._

**Worker edge + routing.** A single Hono app is the entry point. New app routes go in
`userRoutes.ts`; `index.ts` only wires global middleware, Durable Object exports, and health/legacy
fallbacks, and is off-limits for new routes. Chat and AI endpoints run route-specific security gates
(origin, tenant, Turnstile lease, rate limit, body cap) before reaching a handler. _Canonical:
[`worker/userRoutes.ts`](../worker/userRoutes.ts) (entry
[`worker/index.ts`](../worker/index.ts) is off-limits by design)._

**Chat runtime.** Each chat turn is a stateless `POST /api/chat`: the client sends its full
`UIMessage` history (held in `sessionStorage` for same-tab refresh continuity), and the route
sanitizes/validates it, runs `streamText`, assembles the prompt, and exposes tools (`get_weather`,
`show_contact_form`). The SMS contact handoff dispatches through the dedicated idempotent
`POST /api/contact-handoff`. _Canonical: [`worker/routes/chat-routes.ts`](../worker/routes/chat-routes.ts);
tools [`worker/chat-tools.ts`](../worker/chat-tools.ts) +
[`shared/chat-tools.ts`](../shared/chat-tools.ts)._

**AI transport.** `AI_PROVIDER` selects a provider profile without changing routes. `workers-ai`
uses the Worker `AI` binding with Gemma primary and GLM fallback; `google-gateway` preserves the
native Google/compat split through Cloudflare; `google-ai-studio` uses the native Google SDK and a
server-side API key directly. Only the Gateway-backed profiles use `CF_AI_BASE_URL`. _Canonical:
[`worker/model-utils.ts`](../worker/model-utils.ts), [`shared/models.ts`](../shared/models.ts). Model
policy: [`ai-model-strategy.md`](./ai-model-strategy.md)._

**Helper route (fit).** `/api/analyze-fit` (one-shot provider-side `json_schema`, strict against the
shared fit schema) shares the model order with chat but keeps app-side fallback and `maxRetries: 0`.
_Canonical: [`worker/routes/ai-routes.ts`](../worker/routes/ai-routes.ts),
[`shared/fit-analysis.ts`](../shared/fit-analysis.ts)._

**Bot protection.** With `REQUIRE_TURNSTILE=true`, a solved managed-Turnstile token is exchanged once
(`/api/chat/verify-turnstile`) for a signed, tenant-bound `chat_turnstile` lease cookie; the
chat/handoff routes and the fit-analysis route admit on that lease, with a per-request
`x-turnstile-token` header as the direct-caller fallback. _Canonical:
[`worker/security.ts`](../worker/security.ts), [`src/lib/turnstile.ts`](../src/lib/turnstile.ts)._

**Security & tenancy.** A signed tenant cookie (`SECURITY_HMAC_SECRET`) identifies each visitor; the
Worker applies per-tenant/per-IP rate limits, request-size caps, and an origin policy as
route-specific subsets around the chat/AI endpoints (health and bootstrap-style routes use lighter
combinations). _Canonical: [`worker/security.ts`](../worker/security.ts)._

## Where to read more

- Personalize + deploy walkthrough: [`../SETUP.md`](../SETUP.md)
- Run / build / test / deploy: [`../README.md`](../README.md) and [`../DEPLOYMENT.md`](../DEPLOYMENT.md)
- Which file owns which concern: the source-of-truth table in [`../AGENTS.md`](../AGENTS.md)
- Non-secret runtime config, bindings, routes: [`../wrangler.jsonc`](../wrangler.jsonc)
- Full doc catalog: [`./INDEX.md`](./INDEX.md)
