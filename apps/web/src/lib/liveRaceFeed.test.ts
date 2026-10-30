import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { broadcastEndsAtMs, broadcastStartMs, sliceBroadcast } from "@/server/live";
import { fixtureReplay } from "@/server/testing";
import { openLiveRaceFeed, offsetBounds } from "./liveRaceFeed";
import { LIVE_WINDOW_FRAMES } from "./liveWindow";

const T0 = Date.UTC(2026, 9, 25, 15, 0, 0);
/** The server's clock runs 5 s ahead of this "browser". */
const SKEW = 5000;
/** How close the estimated offset must stay to the true skew behind a cache. */
const MIN_TOLERANCE_MS = 600;
const ORIGIN_SLACK_MS = 100;

/**
 * A fake origin + CDN for GET /live?w=<n>. `cdnMs` > 0 caches each window URL for that long
 * (served with Age and x-vercel-cache: HIT), like Vercel's s-maxage.
 */
function setup(opts: { hidden?: boolean; latencyMs?: number; cdnMs?: number } = {}) {
  const postTimeMs = T0 + 10_000;
  const replay = fixtureReplay(`feed${Math.random().toString(36).slice(2, 8)}`, postTimeMs);
  const raceId = replay.race.id;
  const requests: string[] = [];
  const requestTimes: number[] = [];
  let originHits = 0;
  const cdn = new Map<string, { at: number; body: string }>();
  let hidden = opts.hidden ?? false;
  const fakeFetch = vi.fn(async (url: string | URL | Request) => {
    const u = new URL(String(url), "http://x");
    requests.push(u.pathname + u.search);
    requestTimes.push(Date.now());
    const w = Number(u.searchParams.get("w"));
    // Server answers at the midpoint of the round trip.
    if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs! / 2));
    const key = u.search;
    const hit = cdn.get(key);
    let res: Response;
    if (opts.cdnMs && hit && Date.now() - hit.at < opts.cdnMs) {
      const age = String(Math.floor((Date.now() - hit.at) / 1000));
      res = new Response(hit.body, { status: 200, headers: { age, "x-vercel-cache": "HIT" } });
    } else {
      originHits++;
      const body = JSON.stringify(sliceBroadcast(replay, w * LIVE_WINDOW_FRAMES, Date.now() + SKEW, LIVE_WINDOW_FRAMES));
      if (opts.cdnMs) cdn.set(key, { at: Date.now(), body });
      res = new Response(body, { status: 200, headers: opts.cdnMs ? { "x-vercel-cache": "MISS" } : {} });
    }
    if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs! / 2));
    return res;
  }) as unknown as typeof fetch;
  return {
    raceId,
    postTimeMs,
    replay,
    requests,
    requestTimes,
    fakeFetch,
    originHits: () => originHits,
    windows: () => requests.map((r) => Number(new URL(r, "http://x").searchParams.get("w"))),
    setHidden: (h: boolean) => (hidden = h),
    open: () => openLiveRaceFeed(raceId, { fetch: fakeFetch, isHidden: () => hidden }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  // Local clock: 5 s before post time on the server's clock (post is ~10 s after T0).
  vi.setSystemTime(T0 - SKEW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("live race feed", () => {
  it("opens before the off with the header, corrected clock and no frames", async () => {
    const s = setup();
    const feed = await s.open();
    expect(feed.raceId).toBe(s.raceId);
    expect(feed.liveEdgeFrame).toBe(-1);
    expect(feed.frames).toHaveLength(0);
    expect(feed.final).toBeNull();
    // Within the origin slack (an origin response may be shared with a concurrent request).
    expect(Math.abs(feed.clockOffsetMs - SKEW)).toBeLessThanOrEqual(ORIGIN_SLACK_MS);
    expect(feed.serverBroadcastStartMs).toBe(broadcastStartMs(s.postTimeMs));
    // broadcastStartMs is in this browser's clock.
    expect(feed.broadcastStartMs).toBe(broadcastStartMs(s.postTimeMs) - feed.clockOffsetMs);
    expect(s.requests[0]).toBe(`/api/races/${encodeURIComponent(s.raceId)}/live?w=0`);
    feed.close();
  });

  it("polls, appends frames by fromFrame, dedupes events, notifies and stops at the final", async () => {
    const s = setup();
    const feed = await s.open();
    let notified = 0;
    feed.subscribe(() => notified++);

    // Run to mid-race.
    await vi.advanceTimersByTimeAsync(s.postTimeMs - (Date.now() + SKEW) + 20_000);
    expect(feed.liveEdgeFrame).toBeGreaterThan(100);
    expect(feed.final).toBeNull();
    expect(feed.frames).toEqual(s.replay.frames.slice(0, feed.frames.length));
    expect(feed.liveEdgeFrame).toBe(feed.frames.length - 1);
    expect(notified).toBeGreaterThan(5);
    const keys = feed.events.map((e) => `${e.tick}|${e.type}|${e.horseId}|${e.text}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(feed.events.every((e) => e.tick <= feed.liveEdgeFrame * s.replay.sampleEvery)).toBe(true);
    // Requests ask for the window holding what we lack, never going back.
    const ws = s.windows();
    for (let i = 1; i < ws.length; i++) expect(ws[i]).toBeGreaterThanOrEqual(ws[i - 1]!);

    // Run to the end.
    await vi.advanceTimersByTimeAsync(broadcastEndsAtMs(s.replay) - (Date.now() + SKEW) + 3000);
    expect(feed.final?.result.resultHash).toBe(s.replay.result.resultHash);
    expect(feed.frames).toBe(feed.final!.frames);
    expect(feed.liveEdgeFrame).toBe(s.replay.frames.length - 1);
    expect(feed.isClosed).toBe(true);
    const n = s.requests.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(s.requests.length).toBe(n);
  });

  it("catches up window by window, back to back, when joining mid-race", async () => {
    const s = setup();
    vi.setSystemTime(s.postTimeMs - SKEW + 30_000); // 30 s into the race
    const feed = await s.open();
    expect(feed.frames).toHaveLength(LIVE_WINDOW_FRAMES);
    await vi.advanceTimersByTimeAsync(50);
    // Server edge ~300 frames: windows 0..6 fetched in back-to-back requests, no 1.2 s waits.
    expect(feed.frames.length).toBeGreaterThanOrEqual(280);
    expect(feed.frames).toEqual(s.replay.frames.slice(0, feed.frames.length));
    expect(s.windows().slice(0, 6)).toEqual([0, 1, 2, 3, 4, 5]);
    feed.close();
  });

  it("steps to the next window once the current one is complete and drops frames it already has", async () => {
    const s = setup();
    vi.setSystemTime(s.postTimeMs - SKEW + 2_000); // edge just past frame 20: window 0 is live
    const feed = await s.open();
    expect(feed.frames.length).toBeGreaterThan(0);
    expect(feed.frames.length).toBeLessThan(LIVE_WINDOW_FRAMES);
    let lastLen = feed.frames.length;
    for (let i = 0; i < 80; i++) {
      await vi.advanceTimersByTimeAsync(100);
      // Re-polling the same window repeats frames we hold: they're dropped, never duplicated.
      expect(feed.frames).toEqual(s.replay.frames.slice(0, feed.frames.length));
      expect(feed.frames.length).toBeGreaterThanOrEqual(lastLen);
      lastLen = feed.frames.length;
    }
    const ws = s.windows();
    // Window 0 polled several times while live, then 1, then 2; never skipping one.
    expect(ws.filter((w) => w === 0).length).toBeGreaterThan(2);
    expect(ws).toContain(1);
    for (let i = 1; i < ws.length; i++) expect(ws[i]! - ws[i - 1]!).toBeLessThanOrEqual(1);
    // Every request is for the window holding the cursor at the time.
    const last = Math.max(...ws);
    expect(last).toBeGreaterThanOrEqual(Math.floor((feed.frames.length - 1) / LIVE_WINDOW_FRAMES));
    expect(last).toBeLessThanOrEqual(Math.floor(feed.frames.length / LIVE_WINDOW_FRAMES));
    feed.close();
  });

  it("behind a 1 s CDN cache: no gaps, no regressions, a sane clock, origin hits shared", async () => {
    const s = setup({ cdnMs: 1000, latencyMs: 40 });
    vi.setSystemTime(s.postTimeMs - SKEW + 5_000);
    const viewers = 8;
    const opening = Promise.all(
      Array.from({ length: viewers }, async (_, i) => {
        await new Promise((r) => setTimeout(r, i * 150)); // arrivals spread out
        return s.open();
      }),
    );
    await vi.advanceTimersByTimeAsync(viewers * 150 + 40);
    const feeds = await opening;
    await vi.advanceTimersByTimeAsync(1500);
    const frameMs = (s.replay.sampleEvery * 1000) / s.replay.tickHz;
    let starved = 0;
    for (let i = 0; i < 300; i++) {
      await vi.advanceTimersByTimeAsync(100);
      for (const feed of feeds) {
        expect(Math.abs(feed.clockOffsetMs - SKEW)).toBeLessThan(MIN_TOLERANCE_MS);
        expect(feed.frames).toEqual(s.replay.frames.slice(0, feed.frames.length));
        if (Math.floor((Date.now() - feed.broadcastStartMs) / frameMs) > feed.liveEdgeFrame) starved++;
      }
    }
    // A cached copy up to ~1 s old still arrives inside the 2 s broadcast delay.
    expect(starved).toBe(0);
    // About one origin hit per window URL per second, however many viewers poll.
    expect(s.originHits()).toBeLessThanOrEqual(50); // ~33 s of polling
    expect(s.requests.length).toBeGreaterThan(s.originHits() * 3);
    for (const feed of feeds) feed.close();
  });

  it("backs off while the tab is hidden and resumes when visible", async () => {
    const doc = new EventTarget();
    vi.stubGlobal("document", doc);
    const s = setup({ hidden: true });
    vi.setSystemTime(s.postTimeMs - SKEW + 10_000);
    const feed = await s.open();
    const n = s.requests.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(s.requests.length).toBe(n);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(s.requests.length).toBe(n + 1);
    s.setHidden(false);
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(s.requests.length).toBeGreaterThanOrEqual(n + 3);
    feed.close();
    vi.unstubAllGlobals();
  });

  it("a finished race opens straight into the final replay without polling", async () => {
    const s = setup();
    vi.setSystemTime(broadcastEndsAtMs(s.replay) - SKEW + 1);
    const feed = await s.open();
    expect(feed.final).not.toBeNull();
    expect(feed.frames).toHaveLength(s.replay.frames.length);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.requests).toHaveLength(1);
  });

  it("keeps a steady cadence and never runs out of frames when responses are slow", async () => {
    const s = setup({ latencyMs: 900 });
    vi.setSystemTime(s.postTimeMs - SKEW + 5_000);
    const opening = s.open();
    await vi.advanceTimersByTimeAsync(900);
    const feed = await opening;
    // Window 0 is already complete (immutable, any age): a lower bound until a live window lands.
    expect(feed.clockOffsetMs).toBe(SKEW - 450);
    await vi.advanceTimersByTimeAsync(1000);
    expect(Math.abs(feed.clockOffsetMs - SKEW)).toBeLessThanOrEqual(ORIGIN_SLACK_MS);
    const frameMs = (s.replay.sampleEvery * 1000) / s.replay.tickHz;
    let starved = 0;
    for (let i = 0; i < 100; i++) {
      await vi.advanceTimersByTimeAsync(100);
      const shownFrame = Math.floor((Date.now() - feed.broadcastStartMs) / frameMs);
      if (shownFrame > feed.liveEdgeFrame) starved++;
    }
    expect(starved).toBe(0);
    const gaps = s.requestTimes.slice(2).map((t, i) => t - s.requestTimes[i + 1]!);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(1250);
    feed.close();
  });

  it("clock bounds: a CDN copy only bounds the offset from below unless its age is known", () => {
    // Fresh: [server - t1, server - t0 (+ slack)].
    expect(offsetBounds(10_000, { t0: 4_900, t1: 5_100, ageMs: null, source: "fresh" })).toEqual({ lo: 4_900, hi: 5_100 + ORIGIN_SLACK_MS });
    // Cached with Age 1: generated 1-2 s before it left the CDN.
    expect(offsetBounds(10_000, { t0: 4_900, t1: 5_100, ageMs: 1000, source: "cached" })).toEqual({ lo: 5_900, hi: 7_100 });
    // Cached with Age 0: generated up to 1 s before.
    expect(offsetBounds(10_000, { t0: 4_900, t1: 5_100, ageMs: 0, source: "cached" })).toEqual({ lo: 4_900, hi: 6_100 });
    // Cached, no Age: anything up to the worst staleness.
    const b = offsetBounds(10_000, { t0: 4_900, t1: 5_100, ageMs: null, source: "cached" });
    expect(b.lo).toBe(4_900);
    expect(b.hi).toBeGreaterThanOrEqual(7_100);
    // Complete windows may be hours old (browser cache): a lower bound only.
    expect(offsetBounds(10_000, { t0: 4_900, t1: 5_100, ageMs: null, source: "immutable" })).toEqual({ lo: 4_900, hi: Infinity });
  });

  it("close() aborts and stops polling", async () => {
    const s = setup();
    vi.setSystemTime(s.postTimeMs - SKEW + 10_000);
    const feed = await s.open();
    feed.close();
    const n = s.requests.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.requests.length).toBe(n);
  });
});
