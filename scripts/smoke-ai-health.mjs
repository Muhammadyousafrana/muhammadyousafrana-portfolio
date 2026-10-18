#!/usr/bin/env bun

// Post-deploy smoke test: hit the DEPLOYED Worker's GET /api/health/ai and fail
// loudly (exit 1) if the selected AI runtime is not live. This is the guardrail
// that stops stale selected-runtime configuration from surviving a deploy silently. It cannot
// prevent a bad deploy, only surface it immediately after, with retries for edge
// propagation lag.
//
// Point it at your deployment with --url or the SMOKE_BASE_URL env var, e.g.
//   bun run smoke:ai -- --url https://ai-portfolio.<your-subdomain>.workers.dev

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ATTEMPTS = 5
const RETRY_DELAY_MS = 3000
const REQUEST_TIMEOUT_MS = 20_000

const parseArgs = (argv) => {
  const args = { url: undefined }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--url') args.url = argv[(i += 1)]
    else if (arg.startsWith('--url=')) args.url = arg.slice('--url='.length)
  }
  return args
}

const resolveBaseUrl = (args) => {
  const base = args.url ?? process.env.SMOKE_BASE_URL
  if (!base) {
    console.error(
      '[smoke:ai] Provide the deployment base URL via --url <base> or the SMOKE_BASE_URL env var, ' +
        'e.g. --url https://ai-portfolio.<your-subdomain>.workers.dev'
    )
    process.exit(2)
  }
  return base.replace(/\/$/, '')
}

// The health endpoint only needs a token when AI_HEALTH_TOKEN is configured on
// the Worker. Read it from the environment, falling back to .dev.vars so a local
// deploy "just works" without an extra export. When absent, send no bearer (fine
// for an ungated endpoint).
const resolveHealthToken = () => {
  const fromEnv = process.env.AI_HEALTH_TOKEN?.trim()
  if (fromEnv) return fromEnv

  const devVarsPath = resolve(process.cwd(), '.dev.vars')
  if (!existsSync(devVarsPath)) return undefined
  for (const line of readFileSync(devVarsPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*AI_HEALTH_TOKEN\s*=\s*(.*)\s*$/)
    if (match) return match[1].trim().replace(/^["']|["']$/g, '') || undefined
  }
  return undefined
}

// Point at the secret that actually failed, so a token mismatch isn't blamed on
// the gateway key (and vice versa).
const diagnoseFailure = (last) => {
  if (last?.status === 401) {
    return 'The endpoint rejected auth (401) — check AI_HEALTH_TOKEN matches the deployed secret.'
  }
  const code = typeof last?.body === 'object' ? last.body?.code : undefined
  if (code === 'AI_GATEWAY_AUTH_FAILURE') {
    return 'Gateway auth failed — likely a stale/invalid CF_AI_GATEWAY_TOKEN on the deployed Worker.'
  }
  if (code === 'AI_NOT_CONFIGURED') {
    return 'The selected AI runtime is missing required binding, locator, or authentication configuration.'
  }
  if (!last?.status) {
    return 'The endpoint was unreachable (network/DNS/propagation).'
  }
  return 'The AI gateway probe did not succeed.'
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const probeOnce = async (url, token) => {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  const text = await response.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = undefined
  }
  const ok = response.ok && parsed?.success === true && parsed?.data?.ok === true
  return { ok, status: response.status, body: parsed ?? text.slice(0, 300) }
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = resolveBaseUrl(args)
  const url = `${baseUrl}/api/health/ai`
  const token = resolveHealthToken()

  console.log(`[smoke:ai] Probing ${url} (${ATTEMPTS} attempts)...`)

  let last
  let attemptsUsed = 0
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    attemptsUsed = attempt
    try {
      last = await probeOnce(url, token)
    } catch (error) {
      last = { ok: false, status: 0, body: error instanceof Error ? error.message : String(error) }
    }

    if (last.ok) {
      const latency = last.body?.data?.latencyMs
      console.log(
        `[smoke:ai] OK — AI gateway is live${typeof latency === 'number' ? ` (${latency}ms)` : ''}.`
      )
      return
    }

    console.warn(
      `[smoke:ai] attempt ${attempt}/${ATTEMPTS} not ok (status ${last.status}): ${JSON.stringify(last.body)}`
    )
    if (last.status === 401) break
    if (attempt < ATTEMPTS) await sleep(RETRY_DELAY_MS)
  }

  const diagnosis = diagnoseFailure(last)
  console.error(
    `[smoke:ai] FAILED — ${url} did not report a live AI gateway after ${attemptsUsed} attempt${attemptsUsed === 1 ? '' : 's'}. ` +
      `Last: status ${last?.status}, body ${JSON.stringify(last?.body)}. ${diagnosis}`
  )
  process.exit(1)
}

await main()
