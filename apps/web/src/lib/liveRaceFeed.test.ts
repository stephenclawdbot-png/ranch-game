import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { broadcastEndsAtMs, broadcastStartMs, sliceBroadcast } from "@/server/live";
import { computeReplay, createQuickRace } from "@/server/races";
import { openLiveRaceFeed } from "./liveRaceFeed";

const PLAYER = "abc123def456ghij";
const T0 = Date.UTC(2026, 9, 25, 15, 0, 0);
/** The server's clock runs 5 s ahead of this "browser". */
const SKEW = 5000;

function setup(opts: { maxFrames?: number; hidden?: boolean } = {}) {
  const { raceId, postTimeMs } = createQuickRace({ playerId: PLAYER, horseIndex: 0, tactic: "front" }, T0, `feed${Math.random().toString(36).slice(2, 8)}`);
  const replay = computeReplay(raceId);
  const requests: string[] = [];
  let hidden = opts.hidden ?? false;
  const fakeFetch = vi.fn(async (url: string | URL | Request) => {
    const u = new URL(String(url), "http://x");
    requests.push(u.pathname + u.search);
    const from = Number(u.searchParams.get("from"));
    const chunk = sliceBroadcast(replay, from, Date.now() + SKEW, opts.maxFrames);
    return new Response(JSON.stringify(chunk), { status: 200 });
  }) as unknown as typeof fetch;
  return {
    raceId,
    postTimeMs,
    replay,
    requests,
    fakeFetch,
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
    expect(feed.clockOffsetMs).toBe(SKEW);
    expect(feed.serverBroadcastStartMs).toBe(broadcastStartMs(s.postTimeMs));
    // broadcastStartMs is in this browser's clock.
    expect(feed.broadcastStartMs).toBe(broadcastStartMs(s.postTimeMs) - SKEW);
    expect(s.requests[0]).toBe(`/api/races/${encodeURIComponent(s.raceId)}/live?from=0`);
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
    // Requests continue from what we hold.
    const froms = s.requests.map((r) => Number(new URL(r, "http://x").searchParams.get("from")));
    for (let i = 1; i < froms.length; i++) expect(froms[i]).toBeGreaterThanOrEqual(froms[i - 1]!);

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

  it("catches up immediately when the server caps a chunk (e.g. reload mid-race)", async () => {
    const s = setup({ maxFrames: 20 });
    vi.setSystemTime(s.postTimeMs - SKEW + 30_000); // 30 s into the race
    const feed = await s.open();
    expect(feed.frames).toHaveLength(20);
    await vi.advanceTimersByTimeAsync(50);
    // Server edge ~300 frames: fetched in back-to-back requests, no 1.2 s waits.
    expect(feed.frames.length).toBeGreaterThanOrEqual(280);
    expect(feed.frames).toEqual(s.replay.frames.slice(0, feed.frames.length));
    feed.close();
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
