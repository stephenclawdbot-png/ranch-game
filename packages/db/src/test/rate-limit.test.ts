import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { clearRateLimits, pruneRateLimits, rateLimitCount, rateLimitHit } from "../services/rateLimit";
import { DAY, MIN, T0, at, memoryDb } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

// T0 is minute-aligned, so at(0) is the start of a fixed window.
const HOUR = 60 * MIN;

describe("shared rate-limit counters", () => {
  it("counts per key and goes limited exactly after the limit is spent", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await rateLimitHit(h.db, { key: "wallet-auth:1.2.3.4", limit: 5, windowMs: HOUR, now: at(i).getTime() });
      expect(r.count).toBe(i + 1);
      expect(r.limited).toBe(false);
    }
    const over = await rateLimitHit(h.db, { key: "wallet-auth:1.2.3.4", limit: 5, windowMs: HOUR, now: at(5).getTime() });
    expect(over).toEqual({ count: 6, limited: true });
    expect(await rateLimitCount(h.db, { key: "wallet-auth:1.2.3.4", windowMs: HOUR, now: at(5).getTime() })).toBe(6);
  });

  it("separate keys don't interfere", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await rateLimitHit(h.db, { key: "link-failures:a", limit: 3, windowMs: HOUR, now: at(i).getTime() })).limited).toBe(false);
    }
    expect(await rateLimitCount(h.db, { key: "link-failures:b", windowMs: HOUR, now: at(3).getTime() })).toBe(0);
    const b = await rateLimitHit(h.db, { key: "link-failures:b", limit: 3, windowMs: HOUR, now: at(3).getTime() });
    expect(b).toEqual({ count: 1, limited: false });
    expect(await rateLimitCount(h.db, { key: "link-failures:a", windowMs: HOUR, now: at(3).getTime() })).toBe(3);
  });

  it("the previous window decays linearly into the estimate", async () => {
    const windowMs = 10 * MIN;
    for (let i = 0; i < 10; i++) {
      await rateLimitHit(h.db, { key: "decay", limit: 100, windowMs, now: at(i).getTime() });
    }
    // Window edge: the previous window still carries its full weight.
    expect(await rateLimitCount(h.db, { key: "decay", windowMs, now: at(windowMs).getTime() })).toBe(10);
    // Halfway: half of it is still inside the sliding window.
    expect(await rateLimitCount(h.db, { key: "decay", windowMs, now: at(windowMs + windowMs / 2).getTime() })).toBe(5);
    // One ms before it is fully out.
    expect(await rateLimitCount(h.db, { key: "decay", windowMs, now: at(2 * windowMs - 1).getTime() })).toBe(0);
  });

  it("50 concurrent hits on one key count exactly 50 (one atomic upsert each)", async () => {
    const rs = await Promise.all(
      Array.from({ length: 50 }, () => rateLimitHit(h.db, { key: "burst", limit: 100, windowMs: HOUR, now: at(10_000).getTime() })),
    );
    expect(rs.every((r) => !r.limited)).toBe(true);
    expect(await rateLimitCount(h.db, { key: "burst", windowMs: HOUR, now: at(10_000).getTime() })).toBe(50);
  });

  it("prune removes only rows older than the cutoff and reports how many", async () => {
    const now = T0.getTime();
    await rateLimitHit(h.db, { key: "prune-old", limit: 10, windowMs: MIN, now });
    const late = now + 3 * HOUR;
    await rateLimitHit(h.db, { key: "prune-fresh", limit: 10, windowMs: MIN, now: late });
    const removed = await pruneRateLimits(h.db, { olderThanMs: 2 * HOUR, now: late });
    expect(removed).toBeGreaterThanOrEqual(1); // "prune-old" and the earlier tests' windows
    expect(await rateLimitCount(h.db, { key: "prune-old", windowMs: MIN, now: late })).toBe(0);
    expect(await rateLimitCount(h.db, { key: "prune-fresh", windowMs: MIN, now: late })).toBe(1);
  });

  it("clearRateLimits forgets one limiter's counters only (the web layer's test hook)", async () => {
    await rateLimitHit(h.db, { key: "link-failures:x", limit: 10, windowMs: MIN, now: at(DAY).getTime() });
    await rateLimitHit(h.db, { key: "wallet-auth:x", limit: 10, windowMs: MIN, now: at(DAY).getTime() });
    expect(await clearRateLimits(h.db, { name: "link-failures" })).toBeGreaterThanOrEqual(1);
    expect(await rateLimitCount(h.db, { key: "link-failures:x", windowMs: MIN, now: at(DAY).getTime() })).toBe(0);
    expect(await rateLimitCount(h.db, { key: "wallet-auth:x", windowMs: MIN, now: at(DAY).getTime() })).toBe(1);
  });
});