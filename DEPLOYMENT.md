# Deployment Guide

This repo ships a Vite frontend plus a Cloudflare Worker from one codebase, deployed as a **single
Worker** to `https://<name>.<subdomain>.workers.dev`. A custom domain is optional.

For an agent-guided first-time deploy, follow
[`SETUP.md`](SETUP.md#stage-7---deploy-to-cloudflare). This document is the canonical manual
reference.

Mental model:

- non-secret runtime config lives in `wrangler.jsonc`,
- secret runtime config lives in Wrangler secrets (and `.dev.vars` locally),
- local Vite build-time values live in `.env.local` (or the shell),
- `predeploy:validate` reads `VITE_TURNSTILE_SITE_KEY` from the shell env or from Vite env files
  (`.env` / `.env.local`), so an exported shell value or `.env.local` both satisfy it.

## Quick start

### Local development

```bash
bun install
cp .dev.vars.example .dev.vars   # fill in local values
bun run dev
```

- `.dev.vars` (gitignored) holds local Worker runtime values and secrets.
- `.env.local` holds local Vite-only values such as `VITE_TURNSTILE_SITE_KEY`.

### First deploy (fresh account)

```bash
# 1. Set your Worker `name`. Replace the CF_AI_BASE_URL sentinel only if using
#    workers-ai or google-gateway; google-ai-studio calls Gemini directly.
bunx wrangler login

# 2. First publish (creates the Worker; secrets not set yet).
bun run deploy:init

# 3. Set the required secret (you run this interactively; the value is entered at the
#    Wrangler prompt, not stored in the repo).
bunx wrangler secret put SECURITY_HMAC_SECRET

# 4. Confirm the required secret exists (predeploy skips remote secret checks under
#    `wrangler login`, so verify by hand), then do the real deploy in the same terminal.
bunx wrangler secret list   # expect SECURITY_HMAC_SECRET + selected provider secret
SMOKE_BASE_URL=https://<name>.<subdomain>.workers.dev bun run deploy
```

`deploy:init` publishes the Worker before `SECURITY_HMAC_SECRET` exists, so protected AI surfaces are
non-functional until step 3 (the static page still renders). It is a one-time bootstrap. After that,
`bun run deploy` is your normal loop. Also set `CF_AI_GATEWAY_TOKEN` for `google-gateway`, or
`GOOGLE_GENERATIVE_AI_API_KEY` for direct `google-ai-studio`.

### Normal deploy

```bash
bun run deploy:dry-run   # validate + build, no publish
# `bun run deploy` runs the post-deploy smoke check, so give it your URL:
SMOKE_BASE_URL=https://<name>.<subdomain>.workers.dev bun run deploy
```

## Deploy commands

- `bun run predeploy:validate` - parses `wrangler.jsonc` and fails closed if a required var is
  missing, if an AI Gateway-backed provider's `CF_AI_BASE_URL` still contains the `REPLACE_WITH_` sentinel, or (when
  `CLOUDFLARE_API_TOKEN` is set and the Worker already exists) if a required Wrangler secret is
  missing. With no `CLOUDFLARE_API_TOKEN`, remote secret inspection is skipped, so local dry-runs
  need no credentials.
- `bun run deploy:dry-run` - `predeploy:validate` + build + `wrangler deploy --dry-run --strict`.
- `bun run deploy:init` - one-time fresh-account bootstrap: `predeploy:validate` + build +
  `wrangler deploy --strict`, then prints the secret-setup instructions and runs a best-effort smoke
  check. Use once to create the Worker; use `bun run deploy` thereafter.
- `bun run deploy` - `predeploy:validate` + build + `wrangler deploy --strict` + `smoke:ai`.
- `bun run smoke:ai` - probes `GET /api/health/ai` on the deployed Worker and fails loudly if the
  selected AI runtime is not live. Point it with `--url <base>` or `SMOKE_BASE_URL`.
- `bun run smoke:ai:online` - opt-in live verification of health, chat streaming, Workers tool
  continuation, and structured fit output. It skips unless `SMOKE_BASE_URL` and `AI_HEALTH_TOKEN`
  are provided.

## AI Gateway setup

The Worker can route through Cloudflare AI Gateway or call Google AI Studio directly.

1. For `workers-ai` or `google-gateway`, create an **AI Gateway** in Cloudflare. Note its **account id** and **gateway
   slug**.
2. The default `workers-ai` provider uses the Worker `AI` binding and needs no provider API key.
   Workers AI usage is billed to the Cloudflare account.
3. For the optional `google-gateway` provider, ensure inference is funded: either
   [Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/) credits,
   or a stored provider key via
   [Bring Your Own Keys](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/).
   Its models are `google-ai-studio/*`, so a BYOK key must be a **Google AI Studio** key. To configure
   BYOK:
   1. Create the key at [Google AI Studio](https://aistudio.google.com/api-keys).
   2. In Cloudflare, go to **AI > AI Gateway > select the gateway > Provider Keys > Add API Key**.
   3. Choose **Google AI Studio**, paste the Google key, and save it.

   This Google provider key stays in Cloudflare and is not an application environment variable.

4. For `google-gateway`, create an
   [Authenticated Gateway](https://developers.cloudflare.com/ai-gateway/configuration/authentication/)
   token. This separate Cloudflare token is what you set as the `CF_AI_GATEWAY_TOKEN` secret; do not
   put the Google AI Studio key in `CF_AI_GATEWAY_TOKEN`.
5. In `wrangler.jsonc`, replace the sentinel segments of `CF_AI_BASE_URL`
   (`REPLACE_WITH_ACCOUNT_ID` / `REPLACE_WITH_GATEWAY_SLUG`) with your account id and gateway slug.
   Keep the trailing `/compat`; the Worker parses this compat-shaped locator for the ids and
   `predeploy:validate` refuses to deploy while the sentinel is present.

## Direct Google AI Studio

For local testing without an AI Gateway, set `AI_PROVIDER=google-ai-studio` in `.dev.vars` and add
`GOOGLE_GENERATIVE_AI_API_KEY` there. Create a key in [Google AI Studio](https://aistudio.google.com/api-keys).
The key is read only by the Worker and must never use a `VITE_` prefix. For deployment, set
`AI_PROVIDER=google-ai-studio` in `wrangler.jsonc` and add the key interactively with
`bunx wrangler secret put GOOGLE_GENERATIVE_AI_API_KEY`. The selected model is
`gemini-3.5-flash-lite`; verify current eligibility, free quotas, and data handling in Google's
[model list](https://ai.google.dev/gemini-api/docs/models) and [pricing page](https://ai.google.dev/gemini-api/docs/pricing).

## Online AI verification

For a live integration check, use a dedicated test deployment with Turnstile configured, set the
optional `AI_HEALTH_TOKEN` Worker secret, and run:

```bash
SMOKE_BASE_URL=https://<name>.<subdomain>.workers.dev \
AI_HEALTH_TOKEN=<matching-health-token> \
AI_PROVIDER=workers-ai \
bun run smoke:ai:online
```

The script skips without both URL and health token. It verifies authenticated health, a real chat
stream with no reasoning events, a Workers weather-tool continuation, and schema-valid fit output.
Set `AI_PROVIDER=google-gateway` or `google-ai-studio` to verify Google health, chat, and fit. For
direct AI Studio, the online test uses the deployed Worker secret. To test Google BYOK, use a
dedicated gateway without Unified Billing: the check should fail before its Google provider key is
stored and pass after adding the key under **AI > AI Gateway > Provider Keys**; no Worker redeploy is
required.

## What lives where

| Variable                                                                             | Where it lives                            | When it is needed                           | Notes                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_PROVIDER`                                                                        | `wrangler.jsonc`; `.dev.vars` locally     | Required runtime var                        | `workers-ai` (default), `google-gateway`, or direct `google-ai-studio`. Model chains live in `shared/models.ts`.                                                                            |
| `CF_AI_BASE_URL`                                                                     | `wrangler.jsonc`; `.dev.vars` locally     | Gateway providers only                      | AI Gateway locator. Keep the `/compat` suffix.                                                                                                                                              |
| `SESSION_COOKIE_NAME`, `SESSION_COOKIE_MAX_AGE_SECONDS`                              | `wrangler.jsonc`                          | Required runtime vars                       | Source-controlled Worker vars.                                                                                                                                                              |
| `RATE_LIMIT_WINDOW_SECONDS`, `CHAT_RATE_LIMIT_PER_TENANT`, `CHAT_RATE_LIMIT_PER_IP`  | `wrangler.jsonc`                          | Required runtime vars                       | Rate-limit tuning. Change here, then redeploy.                                                                                                                                              |
| `AI_RATE_LIMIT_PER_TENANT`, `AI_RATE_LIMIT_PER_IP`, `CLIENT_ERROR_RATE_LIMIT_PER_IP` | `wrangler.jsonc`                          | Required runtime vars                       | Rate-limit tuning.                                                                                                                                                                          |
| `MAX_CHAT_REQUEST_BYTES`, `MAX_FIT_ANALYZE_BYTES`, `MAX_CLIENT_ERROR_BYTES`          | `wrangler.jsonc`                          | Required runtime vars                       | Request-size caps.                                                                                                                                                                          |
| `REQUIRE_TURNSTILE`                                                                  | `wrangler.jsonc`                          | Required runtime var                        | Must be `"true"`/`"false"`. Set `"true"` only when both the server secret and frontend site key are ready.                                                                                  |
| `ALLOWED_ORIGINS`                                                                    | `wrangler.jsonc` (optional)               | Optional runtime var                        | Only needed for split-host / custom-domain cross-origin access. Same-origin `workers.dev` does not need it.                                                                                 |
| `CF_AI_GATEWAY_TOKEN`                                                                | Wrangler secret; `.dev.vars` locally      | Only for `AI_PROVIDER=google-gateway`       | The Authenticated Gateway token. Workers AI uses the `AI` binding instead.                                                                                                                  |
| `GOOGLE_GENERATIVE_AI_API_KEY`                                                       | Wrangler secret; `.dev.vars` locally      | Only for `AI_PROVIDER=google-ai-studio`     | Google AI Studio key; server-side only.                                                                                                                                                     |
| `SECURITY_HMAC_SECRET`                                                               | Wrangler secret; `.dev.vars` locally      | Required runtime secret                     | Signs tenant cookie identity and challenge leases. Use a long random string.                                                                                                                |
| `VITE_TURNSTILE_SITE_KEY`                                                            | Shell/CI or `.env.local` (Vite build env) | Required only when `REQUIRE_TURNSTILE=true` | Build-time only, baked into the frontend bundle. `predeploy:validate` requires a non-empty value; it does not distinguish real from test keys, so set your production key for real deploys. |
| `TURNSTILE_SECRET_KEY`                                                               | Wrangler secret; `.dev.vars` locally      | Required only when `REQUIRE_TURNSTILE=true` | Server-side Turnstile secret.                                                                                                                                                               |
| `CONTACT_SMS_TO_NUMBER`                                                              | Wrangler secret; `.dev.vars` locally      | Optional (SMS handoff)                      | The owner's destination number (E.164). Keep server-side only; never expose in UI or prompts.                                                                                               |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`                      | Wrangler secret; `.dev.vars` locally      | Optional (SMS handoff)                      | Required together for live SMS. If any is missing, the handoff runs in simulation mode.                                                                                                     |
| `AI_HEALTH_TOKEN`                                                                    | Wrangler secret; `.dev.vars` locally      | Optional                                    | When set, `GET /api/health/ai` requires `Authorization: Bearer <token>`. Export the same value for `smoke:ai`.                                                                              |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`                                      | Shell / CI                                | Deploy authentication                       | Not runtime bindings. Let Wrangler authenticate non-interactively (or use `bunx wrangler login`).                                                                                           |

## Secret setup

You set production secrets yourself with `wrangler secret put` (the values are entered at the prompt
and stored in Cloudflare, never in the repo or `wrangler.jsonc`). For local development, the same
values go in the gitignored `.dev.vars`.

```bash
# Required
bunx wrangler secret put SECURITY_HMAC_SECRET

# Only for AI_PROVIDER=google-gateway
bunx wrangler secret put CF_AI_GATEWAY_TOKEN

# Only for AI_PROVIDER=google-ai-studio
bunx wrangler secret put GOOGLE_GENERATIVE_AI_API_KEY

# Turnstile (only if REQUIRE_TURNSTILE=true)
bunx wrangler secret put TURNSTILE_SECRET_KEY

# SMS contact handoff (all four, or leave all unset to run in simulation mode)
bunx wrangler secret put CONTACT_SMS_TO_NUMBER
bunx wrangler secret put TWILIO_ACCOUNT_SID
bunx wrangler secret put TWILIO_AUTH_TOKEN
bunx wrangler secret put TWILIO_FROM_NUMBER

# Optional health-probe bearer
bunx wrangler secret put AI_HEALTH_TOKEN
```

If SMS handoff is intentionally simulated, skip the `CONTACT_SMS_TO_NUMBER` and Twilio secrets. If
Turnstile is disabled, skip `TURNSTILE_SECRET_KEY`.

## Turnstile (required for production)

Production requires Turnstile by default (`REQUIRE_TURNSTILE: "true"`). Configure it before
exposing the AI endpoints:

1. Create a Turnstile widget in Cloudflare and note its site key and secret key.
2. Keep `REQUIRE_TURNSTILE: "true"` in `wrangler.jsonc` for production. The gitignored local
   `.dev.vars` example disables it only for local testing.
3. Set the `TURNSTILE_SECRET_KEY` Worker secret before enabling public AI traffic.
4. Provide your production `VITE_TURNSTILE_SITE_KEY` in the shell/CI or `.env.local` so `bun run build`
   bakes it into the bundle. `predeploy:validate` requires this value to be present when
   `REQUIRE_TURNSTILE=true` (it checks presence, not whether the key is real), so make sure it is your
   production key for real deploys.

Because the site key is build-time only, changing it requires a rebuild and redeploy. For local
testing, Cloudflare dummy/test keys work and can live in `.env.local`.

## Custom domain (optional)

The default `workers.dev` URL needs no DNS. To serve a custom domain:

1. Add the zone to your Cloudflare account.
2. Add a `routes` block to `wrangler.jsonc`, for example:

   ```jsonc
   "routes": [{ "pattern": "example.com", "custom_domain": true }]
   ```

3. Redeploy with `bun run deploy`. Cloudflare provisions the DNS record and TLS certificate for the
   custom domain (briefly pending on first publish).

If the site is then served cross-origin from another host, set `ALLOWED_ORIGINS` in `wrangler.jsonc`.

## Common questions

**Why does `predeploy:validate` skip secret validation, and why can `bun run deploy` then succeed
even though chat is broken?** `predeploy:validate` only inspects remote secrets when
`CLOUDFLARE_API_TOKEN` is set (CI). With no token, or when the Worker does not exist yet,
`wrangler secret list` cannot run, so the validator warns and skips the remote secret check rather
than failing — expected for local dry-runs and the first `deploy:init`. The tradeoff is that under
`wrangler login` a missing required secret (e.g. `SECURITY_HMAC_SECRET`) is not caught, so a deploy
can succeed while the AI chat stays broken. Confirm required secrets with `bunx wrangler secret list`
before deploying.

**Why does deploy validation fail on Turnstile?** When `REQUIRE_TURNSTILE=true`, `predeploy:validate`
fails if `VITE_TURNSTILE_SITE_KEY` is absent from the Vite build env. It checks presence only; it does
not tell a real key from a Cloudflare test key, so make sure you supply your production key for real
deploys.

**Where do I change runtime defaults like rate limits or request-size caps?** In `wrangler.jsonc`,
then redeploy.

**Where do sensitive values go?** In Wrangler secrets for production and `.dev.vars` for local dev.
Never put secrets in `wrangler.jsonc`, frontend env files, or anything sent to the client.

## File roles

- `wrangler.jsonc` - source of truth for non-secret Worker vars, Durable Object bindings, and
  (optionally) routes.
- `.dev.vars` - local Worker runtime secrets and vars for `bun run dev`.
- `.env.local` - local Vite env, for build-time values like `VITE_TURNSTILE_SITE_KEY`.
- `scripts/predeploy-validate.mjs` - the validator that enforces deploy rules before
  `wrangler deploy`.
- `package.json` - the canonical deploy command entrypoints.
