/**
 * The shared limiter (src/server/rateLimit.ts): counts per key in the database, over-limit
 * verdicts, two limiter objects with the same name sharing one count (the multi-instance
 * case: every serverless instance counts against the same quota), and failing OPEN when the
 * database errors — plus the client-IP header order.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb, type Db, type DbHandle } from "@thoroughbred/db";
import { clientIp, sharedLimiter } from "./rateLimit";

const MIN = 60_000;
const HOUR = 60 * MIN;
/** Minute-aligned, so t(0) is the start of a fixed window. */
const T0 = new Date("2026-11-03T12:00:00.000Z").getTime();
const t = (ms: number) => T0 + ms;

let h: DbHandle;
beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

function req(headers: Record<string, string>): Request {
  return new Request("https://beta.example/api", { headers });
}

describe("sharedLimiter", () => {
  it("counts hits per key and goes over the limit", async () => {
    const l = sharedLimiter({ name: "t-count", limit: 2, windowMs: HOUR });
    expect(await l.hit(h.db, "a", t(0))).toBe(false);
    expect(await l.hit(h.db, "a", t(MIN))).toBe(false);
    expect(await l.hit(h.db, "a", t(2 * MIN))).toBe(true); // over
    expect(await l.count(h.db, "a", t(2 * MIN))).toBe(3);
    // Other keys are independent.
    expect(await l.hit(h.db, "b", t(2 * MIN))).toBe(false);
    expect(await l.count(h.db, "b", t(2 * MIN))).toBe(1);
  });

  it("counts failures without a verdict (the device-link counter)", async () => {
    const l = sharedLimiter({ name: "t-fail", limit: 2, windowMs: HOUR });
    await l.fail(h.db, "a", t(0));
    await l.fail(h.db, "a", t(MIN));
    expect(await l.count(h.db, "a", t(MIN))).toBe(2);
    await l.fail(h.db, "a", t(2 * MIN));
    expect(await l.count(h.db, "a", t(2 * MIN))).toBe(3);
  });

  it("two limiters with the same name share one count (the multi-instance case)", async () => {
    const east = sharedLimiter({ name: "t-shared", limit: 2, windowMs: HOUR });
    const west = sharedLimiter({ name: "t-shared", limit: 2, windowMs: HOUR });
    expect(await east.hit(h.db, "ip", t(0))).toBe(false);
    expect(await west.hit(h.db, "ip", t(1))).toBe(false);
    // The second "instance" sees the first's attempts: the third hit is over the limit.
    expect(await east.count(h.db, "ip", t(2))).toBe(2);
    expect(await west.hit(h.db, "ip", t(2))).toBe(true);
  });

  it("fails OPEN when the database errors, logging once (a limiter must never take the game down)", async () => {
    const l = sharedLimiter({ name: "t-open", limit: 1, windowMs: HOUR });
    const broken = { insert: () => { throw new Error("connection refused"); } } as unknown as Db;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await l.hit(broken, "a", t(0))).toBe(false); // allowed
      await l.fail(broken, "a", t(0));
      expect(await l.count(broken, "a", t(0))).toBe(0);
      expect(await l.hit(broken, "a", t(1))).toBe(false); // still allowed
      expect(errors).toHaveBeenCalledTimes(1); // logged once, then quiet
    } finally {
      errors.mockRestore();
    }
  });
});

describe("clientIp", () => {
  it("prefers x-vercel-forwarded-for, then x-real-ip, then the first hop of x-forwarded-for, then local", () => {
    expect(clientIp(req({ "x-vercel-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIp(req({ "x-vercel-forwarded-for": "203.0.113.8", "x-forwarded-for": "1.2.3.4" }))).toBe("203.0.113.8");
    expect(clientIp(req({ "x-real-ip": "198.51.100.3", "x-forwarded-for": "1.2.3.4" }))).toBe("198.51.100.3");
    expect(clientIp(req({}))).toBe("local");
    expect(clientIp(req({ "x-forwarded-for": " " }))).toBe("local");
  });
});