# AGENTS.md

> **First-time personalization + deploy: read and follow [`SETUP.md`](SETUP.md).** It is the
> agent-executable guide that turns this template into the owner's personalized, deployed portfolio.

## Purpose

- An AI-powered personal portfolio: a single-page site with an AI recruiter chat and a
  job-description fit-check, deployed on Cloudflare Workers.
- The site is personalized entirely through a **content seam** (`content/*`), not by editing app
  code.
- Treat this file as a map: use it to orient, find canonical files, and learn what must not break.

## Workflow rule

- Use Bun first: `bun install`, `bun run <script>`, `bunx <cli>`. Do not use `npm`/`npx` unless the
  repo explicitly requires it.
- When using `rg`/ripgrep in shell commands, do not put raw backticks inside the search string
  unless deliberately escaped; they break the shell command.

## Repo map

- `content/`: the content seam. `portfolio.yaml` (structured facts) + `prose/summary.md` (long-form
  summary) are the single source of resume/profile data.
- `src/`: React 19 single-page frontend (portfolio UI, chat surfaces, fit-check).
- `worker/`: Hono Worker: chat/AI routes, security, Durable Object runtime, contact handoff.
- `shared/`: shared prompts, models, contracts, and the generated resume data.
- `scripts/`: content codegen, predeploy validation, smoke and weather scripts.
- `docs/`: reference documentation (see [`docs/INDEX.md`](docs/INDEX.md)).
- `wrangler.jsonc`: Worker bindings, vars, and (optional) routes.
- `SETUP.md`: the interactive builder guide. `README.md`: product + command overview.
  `DEPLOYMENT.md`: the canonical deploy procedure.

## Sources of truth

Edit the canonical file for each concern, not a downstream copy.

| Concern                                    | Canonical file                                        | Note                                                                                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resume / profile facts                     | `content/portfolio.yaml` + `content/prose/summary.md` | Edit these, then run `bun run content:build`. It codegens the committed `shared/content.generated.ts`, consumed via `shared/resume-canonical.ts`. Never hand-edit the generated file. |
| Content schema + codegen                   | `scripts/build-content.ts`                            | Zod schema and deterministic emitter for the generated content.                                                                                                                       |
| Runtime prompts (chat + fit)               | `shared/ai-prompts.ts`                                | Recruiter chat prompt and fit-analysis prompt.                                                                                                                                        |
| Model order + fallback                     | `shared/models.ts`                                    | Shared chat/fit model order and fallback chain.                                                                                                                                       |
| Chat tool names + contact limits           | `shared/chat-tools.ts`                                | Shared tool identifiers; the live registry is `worker/chat-tools.ts`.                                                                                                                 |
| Contact handoff (relay message, phone)     | `shared/contact-handoff.ts`                           | Relay-message construction + strict E.164 normalization.                                                                                                                              |
| Chat route constants                       | `shared/chat.ts`                                      | `api/chat` route prefix.                                                                                                                                                              |
| App routes                                 | `worker/userRoutes.ts`                                | Add routes here; `worker/index.ts` wires global middleware and is off-limits for new routes.                                                                                          |
| Fit-assessment + health backend            | `worker/routes/ai-routes.ts`                          | `/api/analyze-fit` and `/api/health/ai`.                                                                                                                                              |
| SMS contact dispatch                       | `worker/contact-handoff.ts`                           | Validation + Twilio dispatch; keyed on `CONTACT_SMS_TO_NUMBER` + Twilio secrets.                                                                                                      |
| Security (tenant, Turnstile lease, limits) | `worker/security.ts`                                  | Admission, lease cookie, rate/size limits, origin policy.                                                                                                                             |
| Non-secret runtime config + bindings       | `wrangler.jsonc`                                      | Vars, Durable Object bindings, optional routes.                                                                                                                                       |

## Invariants

- Keep this an **evidence-first** interface: ground recruiter-facing claims in the content seam
  (`content/portfolio.yaml` + generated `shared/content.generated.ts`). Do not invent experience,
  metrics, or skills.
- Preserve **honest fit outcomes**: explicit gap reporting and a valid "Not a Fit" verdict.
- Keep sensitive contact values **server-side only**. Do not expose `CONTACT_SMS_TO_NUMBER` or
  Twilio credentials in UI, prompts, client-visible logs, or tool arguments.
- Do not **bypass the security gates** (tenant, origin, rate-limit, request-size, or Turnstile
  checks) around chat or AI endpoints.
- Prefer adding or changing app routes in `worker/userRoutes.ts`; do not repurpose
  `worker/index.ts`.
- Regenerate content via `bun run content:build` and commit `shared/content.generated.ts`; never
  hand-edit it.

## Validation

- Default checks after code changes:
  - `bun run content:build` (if you touched `content/*`)
  - `bun run check`
  - `bun run test`
  - `bun run build`
- If you change Worker bindings, env shape, or generated Worker types, also run `bun run cf-typegen`.
- If you change deployment/runtime config, also run `bun run predeploy:validate` (or
  `bun run deploy:dry-run`).

## Deeper context

- Interactive setup + deploy walkthrough: [`SETUP.md`](SETUP.md)
- Whole-system architecture map: [`docs/architecture.md`](docs/architecture.md)
- Product / command / env overview: [`README.md`](README.md), deploy detail: [`DEPLOYMENT.md`](DEPLOYMENT.md)
- SMS contact handoff behavior: [`docs/contact-outreach-flow.md`](docs/contact-outreach-flow.md)
- SDK layers, tool patterns, state lifecycle: [`docs/sdk-stack.md`](docs/sdk-stack.md)
- Full doc catalog: [`docs/INDEX.md`](docs/INDEX.md)

## Code simplicity

- The goal is the fewest lines of correct, readable code that get the job done. Every line should
  earn its place.
- Watch out for over-engineering. Do not introduce abstractions, guards, renames, wrapper
  components, or new files unless they solve a concrete problem today. A comment beats a defensive
  runtime check for a scenario that cannot currently happen; three similar lines beat a premature
  helper. If existing code is already clean and correct, leave it alone.
- When in doubt, ask: "does removing this make the code worse?" If the answer is no, remove it.
