/**
 * GET /api/races/:id/live?w=<window>: the shared, CDN-cacheable live feed. One Live race
 * from entries open to the result: errors are never cacheable, the field-locked countdown
 * and the live window are cached ~1 s at the CDN only, complete windows and the final are
 * immutable, nothing ever runs past the live edge, and the response is the same for every
 * viewer (the route never reads cookies; `cookies()` throws here). Uses the shared PGlite
 * singleton, like the route.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => {
    throw new Error("the live feed must not read cookies");
  },
  headers: async () => {
    throw new Error("the live feed must not read request headers");
  },
}));

import { GET } from "../../app/api/races/[id]/live/route";
import { createAccount, stableOf } from "@thoroughbred/db";
import type { RaceBroadcastChunk, RaceReplay } from "@thoroughbred/shared";
import { LIVE_WINDOW_FRAMES, liveWindowOf } from "@/lib/liveWindow";
import { dbHandle } from "./db";
import { driveCard, enterLive, entryOptions, raceCard, raceList, servedReplay } from "./game";
import { broadcastEndsAtMs, liveEdgeFrame } from "./live";

const T0 = new Date(Date.UTC(2026, 10, 3, 9, 0, 3));
const W = LIVE_WINDOW_FRAMES;

let raceId: string;
let postTimeMs: number;
let closeAtMs: number;
let replay: RaceReplay;

async function get(w: number | string, init?: RequestInit): Promise<Response> {
  return GET(new Request(`https://tb.example/api/races/${encodeURIComponent(raceId)}/live?w=${w}`, init), { params: Promise.resolve({ id: raceId }) });
}

/** Runs `fn` with the server clock at `ms`. */
async function at<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  vi.setSystemTime(ms);
  try {
    return await fn();
  } finally {
    vi.setSystemTime(T0);
  }
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  const h = await dbHandle();
  const acc = await createAccount(h.db, { stableName: "Window Box", silks: { pattern: "hoops", primary: "#223344", secondary: "#556677", cap: "#8899aa" }, timezone: "Europe/London", now: T0 });
  const p = { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) };
  await driveCard(h.db, T0, { force: true });
  const { upcoming } = await raceList(h.db, T0, p.stable.id);
  for (const r of [...upcoming].sort((a, b) => a.postTimeMs - b.postTimeMs)) {
    const ok = (await entryOptions(h.db, p, r.id, T0)).options.find((o) => o.reason === null);
    if (!ok) continue;
    await enterLive(h.db, p, r.id, ok.horseId, { tactic: "stalker", intensity: "normal" }, T0);
    raceId = r.id;
    break;
  }
  expect(raceId).toBeTruthy();
  const card = await raceCard(h.db, raceId, T0, p.stable.id);
  postTimeMs = card.config.postTimeMs;
  closeAtMs = card.entriesCloseAtMs;
}, 120_000);

afterAll(() => {
  vi.useRealTimers();
});

describe("live windows", () => {
  it("entries open: 425, never cacheable", async () => {
    const res = await get(0);
    expect(res.status).toBe(425);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("CDN-Cache-Control")).toBeNull();
  });

  it("bad window: 400, never cacheable", async () => {
    for (const w of ["-1", "x", "10000", "1.5"]) {
      const res = await get(w);
      expect(res.status).toBe(400);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    }
  });

  it("field locked, before the off: the countdown is cached ~1 s at the CDN, no frames", async () => {
    const res = await at(closeAtMs + 500, () => get(0));
    expect(res.status).toBe(200);
    expect(res.headers.get("CDN-Cache-Control")).toBe("public, s-maxage=1, stale-while-revalidate=1");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
    const chunk = (await res.json()) as RaceBroadcastChunk;
    expect(chunk.liveEdgeFrame).toBe(-1);
    expect(chunk.frames).toEqual([]);
    expect(chunk.final).toBeNull();
    // The full replay, to check what the windows reveal (the tests below run earlier on the clock).
    replay = await servedReplay((await dbHandle()).db, raceId, new Date(postTimeMs + 3_600_000));
  });

  it("mid-race: complete windows immutable, the live window ~1 s at the CDN, nothing past the edge, the same for every viewer", { timeout: 60_000 }, async () => {
    const t = postTimeMs + 25_000;
    const edge = liveEdgeFrame(replay, t);
    const liveW = liveWindowOf(edge);
    expect(liveW).toBeGreaterThan(0);

    const done = await at(t, () => get(liveW - 1));
    expect(done.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    const doneChunk = (await done.json()) as RaceBroadcastChunk;
    expect(doneChunk.frames).toEqual(replay.frames.slice((liveW - 1) * W, liveW * W));

    // Two viewers, one with cookies and one without, at the same instant: identical responses.
    const a = await at(t, () => get(liveW, { headers: { cookie: "tb_session=viewer-a; other=1" } }));
    const b = await at(t, () => get(liveW));
    expect(a.headers.get("CDN-Cache-Control")).toBe("public, s-maxage=1, stale-while-revalidate=1");
    expect(a.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
    for (const res of [a, b]) {
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("vary") ?? "").not.toMatch(/cookie|\*/i);
    }
    const bodyA = await a.text();
    expect(await b.text()).toBe(bodyA);
    const chunk = JSON.parse(bodyA) as RaceBroadcastChunk;
    expect(chunk.final).toBeNull();
    expect(chunk.fromFrame).toBe(liveW * W);
    expect(chunk.liveEdgeFrame).toBe(edge);
    expect(chunk.fromFrame + chunk.frames.length - 1).toBe(edge);
    expect(chunk.frames).toEqual(replay.frames.slice(liveW * W, edge + 1));
    expect(bodyA).not.toContain(replay.seed);
    expect(bodyA).not.toMatch(/"result"|"seed"|"totalTicks"|"mine"/);

    // A window ahead of the edge holds nothing yet.
    const ahead = (await (await at(t, () => get(liveW + 1))).json()) as RaceBroadcastChunk;
    expect(ahead.frames).toEqual([]);
    expect(ahead.final).toBeNull();
  });

  it("once the broadcast is over: the final replay, immutable, from any window", { timeout: 60_000 }, async () => {
    const end = broadcastEndsAtMs(replay);
    const lastW = liveWindowOf(replay.frames.length - 1);
    const before = (await (await at(end - 1, () => get(lastW))).json()) as RaceBroadcastChunk;
    expect(before.final).toBeNull();
    for (const w of [0, lastW]) {
      const res = await at(end, () => get(w));
      expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
      const chunk = (await res.json()) as RaceBroadcastChunk;
      expect(chunk.final?.result.resultHash).toBe(replay.result.resultHash);
    }
  });
});
