/**
 * Abuse limiting for the account/wallet routes: one process-local sliding-window limiter
 * shared by device linking (failures) and wallet sign-in (hits). Keys are emptied when their
 * window slides past, and the map is capped (oldest keys dropped) so a spray of spoofed
 * IPs can't grow it without bound. Serverless instances are interchangeable, so counts are
 * per-instance hints, not shared quotas.
 */
export interface SlidingWindowLimiter {
  /** Counts one attempt; true when the key is over the limit and must be answered 429. */
  hit(key: string, now: number): boolean;
  /** Counts one attempt without a verdict (e.g. a failed redemption). */
  fail(key: string, now: number): void;
  /** Attempts currently inside the window (expired entries dropped, empty keys evicted). */
  count(key: string, now: number): number;
  /** Test hook: forget everything counted. */
  reset(): void;
}

/** Oldest keys are dropped beyond this many, so spoofed IPs can't grow the map forever. */
const MAX_KEYS = 10_000;

export function slidingWindowLimiter(opts: { limit: number; windowMs: number }): SlidingWindowLimiter {
  const attempts = new Map<string, number[]>();
  const fresh = (key: string, now: number): number[] => {
    const list = (attempts.get(key) ?? []).filter((t) => now - t < opts.windowMs);
    if (list.length) attempts.set(key, list);
    else attempts.delete(key);
    return list;
  };
  const cap = (): void => {
    // Map keeps insertion order: the oldest keys go first.
    for (const key of attempts.keys()) {
      if (attempts.size <= MAX_KEYS) break;
      attempts.delete(key);
    }
  };
  return {
    hit(key, now) {
      const list = fresh(key, now);
      list.push(now);
      attempts.set(key, list);
      cap();
      return list.length > opts.limit;
    },
    fail(key, now) {
      const list = fresh(key, now);
      list.push(now);
      attempts.set(key, list);
      cap();
    },
    count(key, now) {
      return fresh(key, now).length;
    },
    reset() {
      attempts.clear();
    },
  };
}

/** The client's IP, for rate-limit keys only (never stored): Vercel's own header first, then the direct proxy, then the first hop of x-forwarded-for. */
export function clientIp(req: Request): string {
  const first = (name: string): string => (req.headers.get(name)?.split(",")[0] ?? "").trim();
  return first("x-vercel-forwarded-for") || first("x-real-ip") || first("x-forwarded-for") || "local";
}