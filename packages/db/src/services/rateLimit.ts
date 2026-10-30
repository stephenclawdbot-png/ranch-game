/**
 * Shared rate-limit counters (the `rate_limits` table). The web layer's limiter
 * (apps/web/src/server/rateLimit.ts) keeps counts here instead of in instance memory, so
 * every serverless instance enforces the same quota.
 *
 * Estimation is the standard sliding-window-over-fixed-windows one: the current fixed
 * window is counted exactly, and the previous window contributes the share of its count
 * that is still inside the sliding window:
 *   estimate = current + floor(previous x (windowMs - elapsed) / windowMs)
 * with elapsed = now - windowStart. The estimate is only ever within one window of exact —
 * that is the accepted cost of two rows per key instead of a row per attempt.
 */
import { and, eq, lt, sql } from "drizzle-orm";
import { rateLimits } from "../schema";
import type { Executor } from "../types";

export interface RateLimitResult {
  count: number;
  limited: boolean;
}

/** Keys are opaque strings; callers can't store huge ones. */
const MAX_KEY_CHARS = 200;

/** Counts one attempt for `key` and returns the estimated count in the last `windowMs` (this one included). */
export async function rateLimitHit(
  ex: Executor,
  input: { key: string; limit: number; windowMs: number; now: number },
): Promise<RateLimitResult> {
  const key = input.key.slice(0, MAX_KEY_CHARS);
  const windowStart = input.now - (input.now % input.windowMs);
  // One atomic statement: concurrent hits on the same key all increment the same row.
  const [row] = await ex
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });
  const current = row?.count ?? 1;
  const previous = await windowCount(ex, key, windowStart - input.windowMs);
  const count = estimate(current, previous, input.windowMs, input.now, windowStart);
  return { count, limited: count > input.limit };
}

/** Estimated attempts in the last `windowMs` without counting one. */
export async function rateLimitCount(ex: Executor, input: { key: string; windowMs: number; now: number }): Promise<number> {
  const key = input.key.slice(0, MAX_KEY_CHARS);
  const windowStart = input.now - (input.now % input.windowMs);
  const current = await windowCount(ex, key, windowStart);
  const previous = await windowCount(ex, key, windowStart - input.windowMs);
  return estimate(current, previous, input.windowMs, input.now, windowStart);
}

/** Deletes counters older than two windows of the longest limit; returns rows removed. */
export async function pruneRateLimits(ex: Executor, input: { olderThanMs: number; now: number }): Promise<number> {
  const rows = await ex
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, input.now - input.olderThanMs))
    .returning({ key: rateLimits.key });
  return rows.length;
}

/** Count of one fixed window (0 when the key has no row in it). */
async function windowCount(ex: Executor, key: string, windowStart: number): Promise<number> {
  const [row] = await ex
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(and(eq(rateLimits.key, key), eq(rateLimits.windowStart, windowStart)));
  return row?.count ?? 0;
}

/** The two-window sliding estimate: this window exact, the previous one decayed linearly. */
function estimate(current: number, previous: number, windowMs: number, now: number, windowStart: number): number {
  return current + Math.floor((previous * (windowMs - (now - windowStart))) / windowMs);
}