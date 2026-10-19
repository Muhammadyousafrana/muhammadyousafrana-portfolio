#!/usr/bin/env bun

// Single-environment predeploy guardrail. Parses wrangler.jsonc and fails closed
// when the config is not deploy-ready: a required var is missing, the AI Gateway
// locator still carries its placeholder, or (when the deployer is authenticated)
// a required Wrangler secret is not set. Remote secret inspection is best-effort:
// with no CLOUDFLARE_API_TOKEN in the environment it is skipped, so `deploy:dry-run`
// works locally with no credentials.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnv } from 'vite'
import { AI_PROVIDER_IDS } from '../shared/models.ts'

// The wrangler.jsonc placeholder that must be replaced with a real account id +
// gateway slug when an AI Gateway-backed provider is selected.
const CF_AI_BASE_URL_SENTINEL = 'REPLACE_WITH_'
// The compat locator shape the runtime hard-requires (see resolveAiGatewayApiSettings
// in worker/model-utils.ts): /v1/<account-id>/<gateway-slug>/compat.
const CF_AI_BASE_URL_API_VERSION = 'v1'
const CF_AI_BASE_URL_TRANSPORT = 'compat'
const [AI_PROVIDER_WORKERS, AI_PROVIDER_GOOGLE_GATEWAY, AI_PROVIDER_GOOGLE_STUDIO] = AI_PROVIDER_IDS

const REQUIRED_VAR_NAMES = [
  'AI_PROVIDER',
  'SESSION_COOKIE_NAME',
  'SESSION_COOKIE_MAX_AGE_SECONDS',
  'RATE_LIMIT_WINDOW_SECONDS',
  'CHAT_RATE_LIMIT_PER_TENANT',
  'CHAT_RATE_LIMIT_PER_IP',
  'AI_RATE_LIMIT_PER_TENANT',
  'AI_RATE_LIMIT_PER_IP',
  'MAX_CHAT_REQUEST_BYTES',
  'MAX_FIT_ANALYZE_BYTES',
  'MAX_CLIENT_ERROR_BYTES',
  'CLIENT_ERROR_RATE_LIMIT_PER_IP',
  'REQUIRE_TURNSTILE',
]

// AI_HEALTH_TOKEN is intentionally NOT required: the health route reads it
// optionally (see worker/routes/ai-routes.ts), so a deploy without it is valid.
const REQUIRED_SECRET_NAMES = ['SECURITY_HMAC_SECRET']
const TURNSTILE_SECRET_NAME = 'TURNSTILE_SECRET_KEY'
const TURNSTILE_SITE_KEY_NAME = 'VITE_TURNSTILE_SITE_KEY'
const BUILD_ENV_MODE = 'production'

function toPlainObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {}
  }
  return input
}

function hasValue(value) {
  if (value === null || value === undefined) {
    return false
  }
  if (typeof value === 'string') {
    return value.trim().length > 0
  }
  return true
}

function isTruthyFlag(value) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(value ?? '')
      .trim()
      .toLowerCase()
  )
}

// Mirror worker/model-utils.ts resolveAiGatewayApiSettings: the runtime parses
// CF_AI_BASE_URL as a URL, splits the pathname into non-empty segments, and requires
// exactly /v1/<account-id>/<gateway-slug>/compat. Anything else is treated as an
// unconfigured gateway at runtime, so catch it here instead of at deploy time.
function isValidGatewayLocatorShape(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }
  const segments = url.pathname.split('/').filter(Boolean)
  const [apiVersion, accountId, gateway, transport] = segments
  return (
    segments.length === 4 &&
    apiVersion === CF_AI_BASE_URL_API_VERSION &&
    Boolean(accountId) &&
    Boolean(gateway) &&
    transport === CF_AI_BASE_URL_TRANSPORT
  )
}

function readTurnstileSiteKey() {
  const explicit = process.env[TURNSTILE_SITE_KEY_NAME]?.trim()
  if (explicit) {
    return explicit
  }
  return loadEnv(BUILD_ENV_MODE, process.cwd(), 'VITE_')[TURNSTILE_SITE_KEY_NAME]?.trim()
}

function runSecretList(configPath) {
  return spawnSync(
    'bunx',
    ['wrangler', 'secret', 'list', '--format', 'json', '--config', configPath],
    {
      encoding: 'utf8',
    }
  )
}

function extractSecretNames(secretListOutput) {
  const payload = JSON.parse(secretListOutput)
  if (!Array.isArray(payload)) {
    return []
  }
  return payload
    .map((entry) => (entry && typeof entry === 'object' ? entry.name : null))
    .filter((name) => typeof name === 'string')
}

function main() {
  const configPath = resolve(process.cwd(), 'wrangler.jsonc')

  console.log(`[predeploy] validating ${configPath}`)

  if (!existsSync(configPath)) {
    console.error(`[predeploy] missing config file: ${configPath}`)
    process.exit(1)
  }

  let config
  try {
    config = Bun.JSONC.parse(readFileSync(configPath, 'utf8'))
  } catch (error) {
    console.error('[predeploy] failed to parse wrangler config as JSONC')
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }

  const rootConfig = toPlainObject(config)
  const vars = toPlainObject(rootConfig.vars)
  const aiBinding = toPlainObject(rootConfig.ai)
  const workerName = typeof rootConfig.name === 'string' ? rootConfig.name : ''
  const failures = []

  if (!workerName) {
    failures.push('Missing top-level worker "name"')
  }

  if (Object.keys(vars).length === 0) {
    failures.push('No top-level vars defined')
  }

  const missingVars = REQUIRED_VAR_NAMES.filter((name) => !hasValue(vars[name]))
  if (missingVars.length > 0) {
    failures.push(`Missing required vars: ${missingVars.join(', ')}`)
  }

  const aiProvider = String(vars.AI_PROVIDER ?? '').trim()
  if (hasValue(aiProvider) && !AI_PROVIDER_IDS.includes(aiProvider)) {
    failures.push(`AI_PROVIDER must be one of: ${AI_PROVIDER_IDS.join(', ')}`)
  }
  if (aiProvider === AI_PROVIDER_WORKERS && aiBinding.binding !== 'AI') {
    failures.push('AI_PROVIDER=workers-ai requires the top-level AI binding named "AI"')
  }

  const usesAiGateway =
    aiProvider === AI_PROVIDER_WORKERS || aiProvider === AI_PROVIDER_GOOGLE_GATEWAY
  const cfAiBaseUrl = String(vars.CF_AI_BASE_URL ?? '').trim()
  if (usesAiGateway && !hasValue(cfAiBaseUrl)) {
    failures.push('CF_AI_BASE_URL is required for AI Gateway-backed providers')
  } else if (usesAiGateway && cfAiBaseUrl.includes(CF_AI_BASE_URL_SENTINEL)) {
    failures.push(
      `CF_AI_BASE_URL still contains the "${CF_AI_BASE_URL_SENTINEL}" placeholder. Replace it with your real Cloudflare AI Gateway locator (account id + gateway slug) before deploying.`
    )
  } else if (hasValue(cfAiBaseUrl) && !isValidGatewayLocatorShape(cfAiBaseUrl)) {
    // A non-empty, non-sentinel value that isn't the compat locator shape would pass
    // deploy but leave the gateway unconfigured at runtime — fail closed instead.
    failures.push(
      `CF_AI_BASE_URL is not a valid Cloudflare AI Gateway locator. It must be a URL with the compat shape /v1/<account-id>/<gateway-slug>/compat (keep the trailing "/compat"); the Worker treats any other shape as an unconfigured gateway at runtime.`
    )
  }

  const requireTurnstile = isTruthyFlag(vars.REQUIRE_TURNSTILE)
  const requiredSecretNames = [
    ...REQUIRED_SECRET_NAMES,
    ...(aiProvider === AI_PROVIDER_GOOGLE_GATEWAY ? ['CF_AI_GATEWAY_TOKEN'] : []),
    ...(aiProvider === AI_PROVIDER_GOOGLE_STUDIO ? ['GOOGLE_GENERATIVE_AI_API_KEY'] : []),
    ...(requireTurnstile ? [TURNSTILE_SECRET_NAME] : []),
  ]

  if (requireTurnstile && !readTurnstileSiteKey()) {
    failures.push(
      `${TURNSTILE_SITE_KEY_NAME} must be set in the Vite build environment (mode "${BUILD_ENV_MODE}") when REQUIRE_TURNSTILE is true`
    )
  }

  // Remote secret inspection is best-effort and gated on an API token so local
  // dry-runs never need credentials. A brand-new (not-yet-deployed) Worker makes
  // `wrangler secret list` error; that is a warn-and-skip, not a hard failure.
  let secretValidationSkipped = false
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    console.warn(
      '[predeploy] no CLOUDFLARE_API_TOKEN in the environment; skipping remote Wrangler secret validation'
    )
    secretValidationSkipped = true
  } else {
    const secretListResult = runSecretList(configPath)
    if (secretListResult.status !== 0) {
      const detail =
        secretListResult.stderr?.trim() || secretListResult.stdout?.trim() || 'unknown error'
      console.warn(
        '[predeploy] warning: unable to read `wrangler secret list`; skipping secret validation'
      )
      console.warn(`[predeploy] detail: ${detail}`)
      secretValidationSkipped = true
    } else {
      try {
        const configuredSecretNames = extractSecretNames(secretListResult.stdout ?? '')
        const missingSecrets = requiredSecretNames.filter(
          (name) => !configuredSecretNames.includes(name)
        )
        if (missingSecrets.length > 0) {
          failures.push(`Missing required Wrangler secrets: ${missingSecrets.join(', ')}`)
        }
      } catch (error) {
        console.warn(
          '[predeploy] warning: failed to parse `wrangler secret list` output; skipping secret validation'
        )
        console.warn(
          `[predeploy] detail: ${error instanceof Error ? error.message : String(error)}`
        )
        secretValidationSkipped = true
      }
    }
  }

  if (failures.length > 0) {
    console.error('[predeploy] validation failed')
    for (const failure of failures) {
      console.error(`- ${failure}`)
    }
    process.exit(1)
  }

  console.log('[predeploy] validation passed')
  if (secretValidationSkipped) {
    console.log('[predeploy] completed with warning: Wrangler secret names were not validated')
  }
}

main()
