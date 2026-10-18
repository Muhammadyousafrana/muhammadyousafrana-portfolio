/* eslint-disable import/no-unresolved */
import { describe, expect, it } from 'bun:test'
import type { Context } from 'hono'
import type { Env } from './core-utils'
import {
  __testUtils,
  evaluateOriginPolicy,
  hasValidChatChallengeLease,
  isTurnstileRequired,
  issueChatChallengeLease,
  readChatChallengeLeaseExpiry,
} from './security'

const makeEnv = (allowedOrigins?: string): Env => ({ ALLOWED_ORIGINS: allowedOrigins }) as Env

describe('evaluateOriginPolicy', () => {
  it('allows configured origins after canonicalizing paths and trailing slashes', () => {
    const decision = evaluateOriginPolicy(
      makeEnv(' https://app.example.com/ , https://jobs.example.com/recruiters?ref=fit '),
      new Request('https://portfolio.example.com/api/chat/bootstrap', {
        headers: { Origin: 'https://jobs.example.com' },
      })
    )

    expect(decision).toMatchObject({
      ok: true,
      headers: {
        Vary: 'Origin',
        'Access-Control-Allow-Origin': 'https://jobs.example.com',
      },
    })
  })

  it('skips invalid configured origins without broadening the allow list', () => {
    const blocked = evaluateOriginPolicy(
      makeEnv('not-a-url, https://app.example.com/path'),
      new Request('https://portfolio.example.com/api/chat/bootstrap', {
        headers: { Origin: 'https://evil.example.com' },
      })
    )
    const allowed = evaluateOriginPolicy(
      makeEnv('not-a-url, https://app.example.com/path'),
      new Request('https://portfolio.example.com/api/chat/bootstrap', {
        headers: { Origin: 'https://app.example.com' },
      })
    )

    expect(blocked).toEqual({
      ok: false,
      status: 403,
      error: 'Origin not allowed',
      headers: {
        Vary: 'Origin',
      },
    })
    expect(allowed).toMatchObject({
      ok: true,
      headers: {
        Vary: 'Origin',
        'Access-Control-Allow-Origin': 'https://app.example.com',
      },
    })
  })

  it('still emits Vary when the request has no Origin header', () => {
    const decision = evaluateOriginPolicy(
      makeEnv('https://app.example.com'),
      new Request('https://portfolio.example.com/api/health')
    )

    expect(decision).toEqual({
      ok: true,
      headers: {
        Vary: 'Origin',
      },
    })
  })
})

describe('isTurnstileRequired', () => {
  it('treats trimmed truthy env flags as enabled', () => {
    expect(isTurnstileRequired({ REQUIRE_TURNSTILE: ' true ' } as Env)).toBe(true)
    expect(isTurnstileRequired({ REQUIRE_TURNSTILE: ' yes ' } as Env)).toBe(true)
  })
})

// Minimal Hono-context stand-in for the challenge-lease helpers, which only read
// c.env, the Cookie header, and c.req.url, and write Set-Cookie via c.header().
const makeLeaseCtx = (env: Env, cookieHeader?: string) => {
  const setCookies: string[] = []
  const ctx = {
    env,
    req: {
      url: 'https://portfolio.example.com/api/chat/verify-turnstile',
      header: (name: string) => (name.toLowerCase() === 'cookie' ? cookieHeader : undefined),
    },
    header: (name: string, value: string) => {
      if (name === 'Set-Cookie') {
        setCookies.push(value)
      }
    },
  }
  return { ctx: ctx as unknown as Context<{ Bindings: Env }>, setCookies }
}

// Pull `chat_turnstile=...` back out of a Set-Cookie header for replay as a
// Cookie header.
const cookieHeaderFromSetCookie = (setCookie: string): string => setCookie.split(';')[0]

const LEASE_ENV = { SECURITY_HMAC_SECRET: 'lease-signing-secret' } as Env

describe('chat challenge lease', () => {
  it('issues a lease that validates for the same tenant', async () => {
    const issuer = makeLeaseCtx(LEASE_ENV)
    await issueChatChallengeLease(issuer.ctx, 'tenant-abc')

    expect(issuer.setCookies).toHaveLength(1)
    expect(issuer.setCookies[0]).toContain('chat_turnstile=')
    expect(issuer.setCookies[0]).toContain('HttpOnly')
    expect(issuer.setCookies[0]).toContain('SameSite=Lax')

    const cookieHeader = cookieHeaderFromSetCookie(issuer.setCookies[0]!)
    const reader = makeLeaseCtx(LEASE_ENV, cookieHeader)
    await expect(hasValidChatChallengeLease(reader.ctx, 'tenant-abc')).resolves.toBe(true)
  })

  it('rejects a lease presented by a different tenant', async () => {
    const issuer = makeLeaseCtx(LEASE_ENV)
    await issueChatChallengeLease(issuer.ctx, 'tenant-abc')
    const cookieHeader = cookieHeaderFromSetCookie(issuer.setCookies[0]!)

    const reader = makeLeaseCtx(LEASE_ENV, cookieHeader)
    await expect(hasValidChatChallengeLease(reader.ctx, 'tenant-xyz')).resolves.toBe(false)
  })

  it('rejects a tampered signature and a missing cookie', async () => {
    const issuer = makeLeaseCtx(LEASE_ENV)
    await issueChatChallengeLease(issuer.ctx, 'tenant-abc')
    const cookieHeader = cookieHeaderFromSetCookie(issuer.setCookies[0]!)

    const tampered = makeLeaseCtx(LEASE_ENV, `${cookieHeader}tampered`)
    await expect(hasValidChatChallengeLease(tampered.ctx, 'tenant-abc')).resolves.toBe(false)

    const missing = makeLeaseCtx(LEASE_ENV)
    await expect(hasValidChatChallengeLease(missing.ctx, 'tenant-abc')).resolves.toBe(false)
  })

  it('rejects any lease when no signing secret is configured', async () => {
    const issuer = makeLeaseCtx(LEASE_ENV)
    await issueChatChallengeLease(issuer.ctx, 'tenant-abc')
    const cookieHeader = cookieHeaderFromSetCookie(issuer.setCookies[0]!)

    const reader = makeLeaseCtx({} as Env, cookieHeader)
    await expect(hasValidChatChallengeLease(reader.ctx, 'tenant-abc')).resolves.toBe(false)
  })

  it('rejects a well-signed but expired lease and reports the expiry of a valid one', async () => {
    const secret = LEASE_ENV.SECURITY_HMAC_SECRET as string
    const nowSeconds = Math.floor(Date.now() / 1000)

    // Well-signed but already expired: signature verifies, expiry gate rejects.
    const pastExp = nowSeconds - 10
    const pastSig = await __testUtils.signChatChallengeLease('tenant-abc', pastExp, secret)
    const expired = makeLeaseCtx(LEASE_ENV, `chat_turnstile=${pastExp}.${pastSig}`)
    await expect(hasValidChatChallengeLease(expired.ctx, 'tenant-abc')).resolves.toBe(false)

    // A freshly issued lease reports a future expiry.
    const issuer = makeLeaseCtx(LEASE_ENV)
    const exp = await issueChatChallengeLease(issuer.ctx, 'tenant-abc')
    expect(exp).not.toBeNull()
    expect(exp!).toBeGreaterThan(nowSeconds)
    const cookieHeader = cookieHeaderFromSetCookie(issuer.setCookies[0]!)
    const reader = makeLeaseCtx(LEASE_ENV, cookieHeader)
    await expect(readChatChallengeLeaseExpiry(reader.ctx, 'tenant-abc')).resolves.toBe(exp)
  })
})
