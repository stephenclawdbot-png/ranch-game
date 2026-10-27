/**
 * The shared sliding-window limiter (src/server/rateLimit.ts): counts per key, over-limit
 * verdicts, window sliding, empty-key eviction and the map cap (oldest keys dropped past
 * 10,000), plus the client-IP header order.
 */
import { describe, expect, it } from "vitest";
import { clientIp, slidingWindowLimiter } from "./rateLimit";

const MIN = 60_000;

function req(headers: Record<string, string>): Request {
  return new Request("https://beta.example/api", { headers });
}

describe("slidingWindowLimiter", () => {
  it("counts hits per key, goes over the limit, slides the window", () => {
    const l = slidingWindowLimiter({ limit: 2, windowMs: 60 * MIN });
    expect(l.hit("a", 0)).toBe(false);
    expect(l.hit("a", MIN)).toBe(false);
    expect(l.hit("a", 2 * MIN)).toBe(true); // over
    expect(l.count("a", 2 * MIN)).toBe(3);
    // The first hit slides out of the window: two fresh ones fit again.
    expect(l.hit("a", 61 * MIN)).toBe(false);
    expect(l.hit("a", 61 * MIN)).toBe(true);
    // Other keys are independent.
    expect(l.hit("b", 61 * MIN)).toBe(false);
    // reset forgets everything (test hook).
    l.reset();
    expect(l.count("a", 61 * MIN)).toBe(0);
  });

  it("counts failures without a verdict (the device-link counter)", () => {
    const l = slidingWindowLimiter({ limit: 2, windowMs: 60 * MIN });
    l.fail("a", 0);
    l.fail("a", MIN);
    expect(l.count("a", MIN)).toBe(2);
    l.fail("a", 2 * MIN);
    expect(l.count("a", 2 * MIN)).toBe(3);
  });

  it("evicts keys once their window is empty", () => {
    const l = slidingWindowLimiter({ limit: 1, windowMs: MIN });
    l.hit("a", 0);
    expect(l.count("a", MIN)).toBe(0); // slid out
    // An empty key is gone: the next hit starts from zero, not the stale entry.
    expect(l.hit("a", MIN)).toBe(false);
    expect(l.count("a", MIN)).toBe(1);
  });

  it("caps the map at 10,000 keys, dropping the oldest (a spoofed-IP spray can't grow it)", () => {
    const l = slidingWindowLimiter({ limit: 10, windowMs: 60 * MIN });
    l.hit("first", 0);
    for (let i = 0; i < 10_000; i++) l.hit(`ip-${i}`, 1);
    // "first" was dropped as the oldest key; the newest key keeps its count.
    expect(l.count("first", 1)).toBe(0);
    expect(l.count("ip-9999", 1)).toBe(1);
    // The limiter still works after the cap.
    expect(l.hit("another", 1)).toBe(false);
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