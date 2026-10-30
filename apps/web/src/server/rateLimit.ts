/**
 * Abuse limiting for the account/wallet routes: shared sliding-window limiters for device
 * linking (failures) and wallet sign-in (hits). The counts live in the database (the
 * `rate_limits` table, via @thoroughbred/db's rateLimit service), so every serverless
 * instance counts against the same quota — a limit of N per hour is N once, not N per
 * instance. The window is the standard two-window estimate: the current fixed window exact,
 * the previous one decayed linearly.
 *
 * If the database ever errors, every method fails OPEN (the request is allowed): a rate
 * limiter must never take the game down. The first error is logged, then the limiter stays
 * quiet until one succeeds again.
 */
import { rateLimitCount, rateLimitHit, type Db } from "@thoroughbred/db";

export interface SharedLimiter {
  /** Counts one attempt; true when the key is over the limit and must be answered 429. */
  hit(db: Db, key: string, now: number): Promise<boolean>;
  /** Counts one attempt without a verdict (e.g. a failed redemption). */
  fail(db: Db, key: string, now: number): Promise<void>;
  /** Attempts currently estimated inside the window (no attempt counted). */
  count(db: Db, key: string, now: number): Promise<number>;
}

export function sharedLimiter(opts: { name: string; limit: number; windowMs: number }): SharedLimiter {
  const keyed = (key: string) => `${opts.name}:${key}`;
  let dbBroken = false;
  /** Runs a counting query, failing OPEN (the fallback answer) if the database errors. */
  const open = async <T>(run: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      const out = await run();
      dbBroken = false;
      return out;
    } catch (err) {
      if (!dbBroken) {
        console.error(`rate limiter "${opts.name}" is failing; requests pass uncounted`, err);
        dbBroken = true;
      }
      return fallback;
    }
  };
  return {
    async hit(db, key, now) {
      const res = await open(
        () => rateLimitHit(db, { key: keyed(key), limit: opts.limit, windowMs: opts.windowMs, now }),
        { count: 0, limited: false },
      );
      return res.limited;
    },
    async fail(db, key, now) {
      // The verdict is discarded: this only counts the attempt.
      await open(
        () => rateLimitHit(db, { key: keyed(key), limit: opts.limit, windowMs: opts.windowMs, now }).then(() => undefined),
        undefined,
      );
    },
    async count(db, key, now) {
      return open(() => rateLimitCount(db, { key: keyed(key), windowMs: opts.windowMs, now }), 0);
    },
  };
}

/** The client's IP, for rate-limit keys only (never stored): Vercel's own header first, then the direct proxy, then the first hop of x-forwarded-for. */
export function clientIp(req: Request): string {
  const first = (name: string): string => (req.headers.get(name)?.split(",")[0] ?? "").trim();
  return first("x-vercel-forwarded-for") || first("x-real-ip") || first("x-forwarded-for") || "local";
}