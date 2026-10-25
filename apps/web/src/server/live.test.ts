import { describe, expect, it } from "vitest";
import { BROADCAST_DELAY_S, RaceBroadcastChunkSchema, type RaceBroadcastChunk } from "@thoroughbred/shared";
import { NextResponse } from "next/server";
import {
  BROADCAST_DELAY_MS,
  LIVE_LOOKAHEAD_MS,
  MAX_CHUNK_FRAMES,
  broadcastEndsAtMs,
  broadcastStartMs,
  isBroadcastOver,
  liveEdgeFrame,
  sliceBroadcast,
} from "./live";
import { TooEarlyError } from "./errors";
import { handleError } from "./http";
import { fixtureReplay } from "./testing";

const NOW = Date.UTC(2026, 9, 25, 15, 0, 0);

/** A fixture race whose post time is 10 s after NOW (the old quick-race timing). */
function quick(nonce: string) {
  const postTimeMs = NOW + 10_000;
  const replay = fixtureReplay(nonce, postTimeMs);
  const raceId = replay.race.id;
  const frameMs = (replay.sampleEvery * 1000) / replay.tickHz;
  const revealStart = broadcastStartMs(postTimeMs) - LIVE_LOOKAHEAD_MS;
  return { raceId, postTimeMs, replay, frameMs, revealStart, last: replay.frames.length - 1, endsAt: broadcastEndsAtMs(replay) };
}

/** Everything in a live payload that could reveal the outcome. */
function assertNoLeak(chunk: RaceBroadcastChunk, r: ReturnType<typeof quick>) {
  const { replay } = r;
  expect(chunk.final).toBeNull();
  const json = JSON.stringify(chunk);
  expect(json).not.toContain(replay.seed);
  expect(json).not.toContain(replay.result.resultHash);
  for (const key of ["result", "seed", "totalTicks", "finishOrder", "finishTimeUs", "winningTimeUs", "endsAtMs", "prize"]) {
    expect(json).not.toContain(`"${key}"`);
  }
  // No frame beyond the edge.
  if (chunk.frames.length > 0) expect(chunk.fromFrame + chunk.frames.length - 1).toBeLessThanOrEqual(chunk.liveEdgeFrame);
  expect(chunk.liveEdgeFrame).toBeLessThan(r.last);
  // No event beyond the edge.
  const edgeTick = chunk.liveEdgeFrame * replay.sampleEvery;
  for (const e of chunk.events) expect(e.tick).toBeLessThanOrEqual(edgeTick);
  // The header is exactly the schema's keys (nothing extra rides along).
  expect(Object.keys(chunk.header).sort()).toEqual(
    ["version", "engineVersion", "race", "seedCommitment", "tickHz", "sampleEvery", "trackLengthMm", "laneCount", "horses"].sort(),
  );
  for (const h of chunk.header.horses) expect(Object.keys(h).sort()).toEqual(["appearance", "gate", "horseId", "name", "tactic"]);
}

describe("broadcast clock", () => {
  it("broadcast starts BROADCAST_DELAY_S after post time", () => {
    expect(broadcastStartMs(1_000_000)).toBe(1_000_000 + BROADCAST_DELAY_S * 1000);
    expect(BROADCAST_DELAY_MS).toBe(BROADCAST_DELAY_S * 1000);
  });

  it("live edge is -1 before the off, advances with time, and is clamped to the last frame", () => {
    const r = quick("edge000001");
    expect(liveEdgeFrame(r.replay, r.postTimeMs - 5000)).toBe(-1);
    expect(liveEdgeFrame(r.replay, r.revealStart - 1)).toBe(-1);
    expect(liveEdgeFrame(r.replay, r.revealStart)).toBe(0);
    expect(liveEdgeFrame(r.replay, r.revealStart + r.frameMs * 10 + 1)).toBe(10);
    expect(liveEdgeFrame(r.replay, r.revealStart + r.frameMs * 10 - 1)).toBe(9);
    expect(liveEdgeFrame(r.replay, r.endsAt + 3_600_000)).toBe(r.last);
  });

  it("the race is over only once the last frame has been broadcast plus a margin", () => {
    const r = quick("over000001");
    const lastShownAt = broadcastStartMs(r.postTimeMs) + (r.replay.totalTicks * 1000) / r.replay.tickHz;
    expect(isBroadcastOver(r.replay, lastShownAt - 1)).toBe(false);
    expect(isBroadcastOver(r.replay, r.endsAt - 1)).toBe(false);
    expect(isBroadcastOver(r.replay, r.endsAt)).toBe(true);
    expect(r.endsAt).toBeGreaterThan(lastShownAt);
  });
});

describe("sliceBroadcast", () => {
  it("before the off: header only, edge -1, nothing else", () => {
    const r = quick("pre0000001");
    const chunk = sliceBroadcast(r.replay, 0, r.postTimeMs - 3000);
    expect(RaceBroadcastChunkSchema.safeParse(chunk).success).toBe(true);
    expect(chunk.liveEdgeFrame).toBe(-1);
    expect(chunk.frames).toEqual([]);
    expect(chunk.events).toEqual([]);
    expect(chunk.broadcastStartMs).toBe(r.postTimeMs + BROADCAST_DELAY_S * 1000);
    expect(chunk.header.horses).toHaveLength(r.replay.horses.length);
    assertNoLeak(chunk, r);
  });

  it("mid-race: frames [from, edge] and events <= edge only; no result, seed or final", () => {
    const r = quick("mid0000001");
    const mid = r.revealStart + Math.floor((r.last / 2) * r.frameMs) + 5;
    const edge = liveEdgeFrame(r.replay, mid);
    expect(edge).toBeGreaterThan(10);
    const chunk = sliceBroadcast(r.replay, 0, mid);
    expect(RaceBroadcastChunkSchema.safeParse(chunk).success).toBe(true);
    expect(chunk.liveEdgeFrame).toBe(edge);
    expect(chunk.frames.length).toBe(Math.min(edge + 1, MAX_CHUNK_FRAMES));
    expect(chunk.frames[0]).toEqual(r.replay.frames[0]);
    assertNoLeak(chunk, r);

    const tail = sliceBroadcast(r.replay, edge - 4, mid);
    expect(tail.fromFrame).toBe(edge - 4);
    expect(tail.frames).toEqual(r.replay.frames.slice(edge - 4, edge + 1));
    assertNoLeak(tail, r);

    // Asking beyond the edge reveals nothing new.
    const ahead = sliceBroadcast(r.replay, edge + 50, mid);
    expect(ahead.frames).toEqual([]);
    assertNoLeak(ahead, r);
  });

  it("caps the chunk; consecutive requests reassemble the exact frames", () => {
    const r = quick("cap0000001");
    const late = r.endsAt - 1000; // edge at the last frame, but not official yet
    expect(liveEdgeFrame(r.replay, late)).toBe(r.last);
    const got: number[][] = [];
    for (let guard = 0; guard < 100; guard++) {
      const c = sliceBroadcast(r.replay, got.length, late, 50);
      expect(c.final).toBeNull();
      expect(c.frames.length).toBeLessThanOrEqual(50);
      got.push(...c.frames);
      if (got.length - 1 >= c.liveEdgeFrame) break;
    }
    expect(got).toEqual(r.replay.frames);
  });

  it("just before the official finish everything has been run but the result is still withheld", () => {
    const r = quick("late000001");
    const chunk = sliceBroadcast(r.replay, 0, r.endsAt - 1, 100_000);
    expect(chunk.final).toBeNull();
    const json = JSON.stringify(chunk);
    expect(json).not.toContain(r.replay.seed);
    expect(json).not.toContain('"result"');
    expect(json).not.toContain('"totalTicks"');
  });

  it("finish commentary (which names the margin to the runner-up) waits until the runner-up has finished", () => {
    const r = quick("fin0000001");
    const second = r.replay.result.finishOrder[1]!;
    const secondTick = Math.ceil((second.finishTimeUs * r.replay.tickHz) / 1_000_000);
    const winTick = r.replay.events.find((e) => e.type === "finish")!.tick;
    const at = (tick: number) => r.revealStart + Math.ceil((tick / r.replay.sampleEvery) * r.frameMs) + 1;
    const before = sliceBroadcast(r.replay, 0, at(Math.max(winTick, secondTick) - r.replay.sampleEvery), 100_000);
    expect(before.events.some((e) => e.type === "finish" || e.type === "photo_finish")).toBe(false);
    const after = sliceBroadcast(r.replay, 0, at(Math.max(winTick, secondTick) + r.replay.sampleEvery), 100_000);
    expect(after.events.some((e) => e.type === "finish")).toBe(true);
  });

  it("after the finish: final carries the complete replay", () => {
    const r = quick("done000001");
    const chunk = sliceBroadcast(r.replay, 0, r.endsAt);
    expect(RaceBroadcastChunkSchema.safeParse(chunk).success).toBe(true);
    expect(chunk.final).toBe(r.replay);
    expect(chunk.liveEdgeFrame).toBe(r.last);
  });
});

describe("errors", () => {
  it("the 425 while live carries no end time", async () => {
    const res = handleError(new TooEarlyError(123, "live")) as NextResponse;
    expect(res.status).toBe(425);
    const body = await res.json();
    expect(body.error).toBe("race_live");
    expect(body.postTimeMs).toBe(123);
    expect(Object.keys(body).sort()).toEqual(["error", "message", "postTimeMs"]);
    expect(res.headers.get("Retry-After")).toBe("5");
  });
});

// The database-backed card, list, replay and verify paths keep the same guarantees; see game.test.ts.
