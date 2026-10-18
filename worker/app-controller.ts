import { DurableObject } from 'cloudflare:workers'
import type { Env } from './core-utils'

interface RateLimitRecord {
  count: number
  resetAt: number
}

const RATE_LIMIT_KEY_PREFIX = 'rate:'
const RATE_LIMIT_CLEANUP_NEXT_AT_KEY = 'meta:rate_cleanup_next_at'
const RATE_LIMIT_CLEANUP_CURSOR_KEY = 'meta:rate_cleanup_cursor'
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const RATE_LIMIT_CLEANUP_BATCH_SIZE = 128

const CONTACT_HANDOFF_KEY_PREFIX = 'handoff:'
// A pending claim older than this is treated as abandoned (the claimant's
// Twilio fetch self-bounds at 10s, so a live dispatch never legitimately takes
// this long) and becomes reclaimable, keeping failed sends retryable even when
// the claimant crashed between claim and settle.
export const CONTACT_HANDOFF_PENDING_TTL_MS = 30_000
// Completed records exist only to swallow duplicate submissions of the same
// tool call (client retries within a session). They carry contact PII, so they
// are actually deleted by the alarm sweep below rather than lingering.
const CONTACT_HANDOFF_COMPLETED_TTL_MS = 24 * 60 * 60 * 1000

type ContactHandoffDispatchRecord =
  | { state: 'pending'; claimId: string; claimedAt: number }
  | { state: 'completed'; result: unknown; expiresAt: number }

export type ContactHandoffClaimResult =
  | { kind: 'claimed'; claimId: string }
  | { kind: 'pending' }
  | { kind: 'completed'; result: unknown }

export class AppController extends DurableObject<Env> {
  private sanitizeKey(value: string, maxLength = 256): string {
    return value.trim().slice(0, maxLength)
  }

  private getRateLimitKey(key: string): string {
    return `${RATE_LIMIT_KEY_PREFIX}${this.sanitizeKey(key, 192)}`
  }

  private getContactHandoffKey(key: string): string {
    return `${CONTACT_HANDOFF_KEY_PREFIX}${this.sanitizeKey(key, 192)}`
  }

  private async maybeCleanupRateLimitKeys(now: number): Promise<void> {
    const nextAt = await this.ctx.storage.get<number>(RATE_LIMIT_CLEANUP_NEXT_AT_KEY)
    if (typeof nextAt === 'number' && now < nextAt) {
      return
    }

    const cursor = await this.ctx.storage.get<string>(RATE_LIMIT_CLEANUP_CURSOR_KEY)
    const options: DurableObjectListOptions = {
      prefix: RATE_LIMIT_KEY_PREFIX,
      limit: RATE_LIMIT_CLEANUP_BATCH_SIZE,
      ...(cursor ? { startAfter: cursor } : {}),
    }
    const batch = await this.ctx.storage.list<RateLimitRecord>(options)

    let lastKey: string | null = null
    for (const [key, record] of batch) {
      lastKey = key
      if (!record || now >= record.resetAt) {
        await this.ctx.storage.delete(key)
      }
    }

    if (batch.size === RATE_LIMIT_CLEANUP_BATCH_SIZE && lastKey) {
      await this.ctx.storage.put(RATE_LIMIT_CLEANUP_CURSOR_KEY, lastKey)
    } else {
      await this.ctx.storage.delete(RATE_LIMIT_CLEANUP_CURSOR_KEY)
    }

    await this.ctx.storage.put(RATE_LIMIT_CLEANUP_NEXT_AT_KEY, now + RATE_LIMIT_CLEANUP_INTERVAL_MS)
  }

  async consumeRateLimit(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1
    const safeWindowSeconds = Number.isFinite(windowSeconds)
      ? Math.max(1, Math.floor(windowSeconds))
      : 60
    const now = Date.now()
    await this.maybeCleanupRateLimitKeys(now)
    const storageKey = this.getRateLimitKey(key)
    const windowMs = safeWindowSeconds * 1000
    const current = await this.ctx.storage.get<RateLimitRecord>(storageKey)

    if (!current || now >= current.resetAt) {
      const next: RateLimitRecord = {
        count: 1,
        resetAt: now + windowMs,
      }
      await this.ctx.storage.put(storageKey, next)
      return {
        allowed: true,
        remaining: Math.max(0, safeLimit - 1),
        resetAt: next.resetAt,
      }
    }

    if (current.count >= safeLimit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: current.resetAt,
      }
    }

    const updated: RateLimitRecord = {
      count: current.count + 1,
      resetAt: current.resetAt,
    }
    await this.ctx.storage.put(storageKey, updated)

    return {
      allowed: true,
      remaining: Math.max(0, safeLimit - updated.count),
      resetAt: updated.resetAt,
    }
  }

  // Pulls the alarm earlier when needed. Always armed BEFORE the record it
  // covers is written: a spurious alarm over no record is a harmless no-op
  // sweep, whereas a record without an alarm would keep contact PII around
  // with no guaranteed deletion.
  private async armContactHandoffAlarm(at: number): Promise<void> {
    const currentAlarm = await this.ctx.storage.getAlarm()
    if (currentAlarm === null || at < currentAlarm) {
      await this.ctx.storage.setAlarm(at)
    }
  }

  // At-most-once guard for the contact-handoff SMS. Durable Object input gates
  // serialize this read-modify-write against every other event on this object,
  // so a duplicate POST can never race past the claim: exactly one caller gets
  // 'claimed' per pending window, duplicates of a finished send get the stored
  // result back, and a concurrent in-flight attempt is reported as 'pending'.
  async claimContactHandoffDispatch(key: string): Promise<ContactHandoffClaimResult> {
    const storageKey = this.getContactHandoffKey(key)
    const now = Date.now()
    const existing = await this.ctx.storage.get<ContactHandoffDispatchRecord>(storageKey)

    if (existing?.state === 'completed' && now < existing.expiresAt) {
      return { kind: 'completed', result: existing.result }
    }

    if (
      existing?.state === 'pending' &&
      now - existing.claimedAt < CONTACT_HANDOFF_PENDING_TTL_MS
    ) {
      return { kind: 'pending' }
    }

    // The claim's own alarm also backstops the completed record a successful
    // settle stores: even if the settle's re-arm is lost, this sweep runs, sees
    // the completed record, and re-arms for its expiry.
    await this.armContactHandoffAlarm(now + CONTACT_HANDOFF_PENDING_TTL_MS)
    const claimId = crypto.randomUUID()
    await this.ctx.storage.put<ContactHandoffDispatchRecord>(storageKey, {
      state: 'pending',
      claimId,
      claimedAt: now,
    })
    return { kind: 'claimed', claimId }
  }

  // `claimId` fences out stale claimants: if claimant A's pending claim expired
  // and B reclaimed (and possibly completed), A's late settle must not delete
  // or overwrite B's state. `result: null` releases the claim (failed send →
  // retryable); a non-null result stores the resolution for duplicate POSTs.
  async settleContactHandoffDispatch(
    key: string,
    claimId: string,
    result: unknown | null
  ): Promise<void> {
    const storageKey = this.getContactHandoffKey(key)
    const existing = await this.ctx.storage.get<ContactHandoffDispatchRecord>(storageKey)
    if (existing?.state !== 'pending' || existing.claimId !== claimId) {
      return
    }

    if (result === null) {
      await this.ctx.storage.delete(storageKey)
      return
    }

    const expiresAt = Date.now() + CONTACT_HANDOFF_COMPLETED_TTL_MS
    await this.armContactHandoffAlarm(expiresAt)
    await this.ctx.storage.put<ContactHandoffDispatchRecord>(storageKey, {
      state: 'completed',
      result,
      expiresAt,
    })
  }

  // Deletes expired contact-handoff records (they hold contact PII, so expiry
  // must be real deletion, not lazy masking) and re-arms for the earliest
  // survivor — including when the platform fires the alarm slightly early.
  // Only contact-handoff settles ever set an alarm, so rate-limit-only
  // controller instances never run this.
  async alarm(): Promise<void> {
    const now = Date.now()
    let nextAt: number | null = null
    const records = await this.ctx.storage.list<ContactHandoffDispatchRecord>({
      prefix: CONTACT_HANDOFF_KEY_PREFIX,
    })

    for (const [storageKey, record] of records) {
      const expiresAt =
        record.state === 'completed'
          ? record.expiresAt
          : record.claimedAt + CONTACT_HANDOFF_PENDING_TTL_MS
      if (expiresAt <= now) {
        await this.ctx.storage.delete(storageKey)
        continue
      }
      nextAt = nextAt === null ? expiresAt : Math.min(nextAt, expiresAt)
    }

    if (nextAt !== null) {
      await this.ctx.storage.setAlarm(nextAt)
    }
  }
}
