/**
 * Live broadcast: reveal a deterministic replay only up to "now".
 *
 * The race is simulated in full on the server (it is deterministic and cheap), but a
 * client only ever receives what has already happened:
 *
 *   postTimeMs                  the simulation clock starts (frame 0 "happens")
 *   broadcastStartMs            = postTimeMs + BROADCAST_DELAY_S; frame 0 is *shown*
 *   frame f is shown at         broadcastStartMs + f * sampleEvery / tickHz s
 *   broadcastEndsAtMs           = broadcastStartMs + totalTicks / tickHz s + FINAL_MARGIN_MS
 *
 * Frames are revealed on the simulation clock (i.e. LIVE_LOOKAHEAD_MS ahead of what the
 * viewer shows), which is exactly the broadcast delay: it absorbs polling latency so
 * playback never starves. Nothing that depends on the *rest* of the race (result, seed,
 * totalTicks, finish times, later events) is sent until `isBroadcastOver`.
 *
 * Pure functions only; no I/O and no imports from races.ts (races.ts imports this).
 */
import {
  BROADCAST_DELAY_S,
  type RaceBroadcastChunk,
  type RaceBroadcastHeader,
  type RaceEvent,
  type RaceReplay,
} from "@thoroughbred/shared";

export const BROADCAST_DELAY_MS = BROADCAST_DELAY_S * 1000;
/**
 * How far ahead of the displayed broadcast frames are revealed. Equal to the broadcast
 * delay, so the server's live edge is "now" on the simulation clock. Set to 0 to reveal
 * strictly up to what the viewer is showing (playback then stalls between polls).
 */
export const LIVE_LOOKAHEAD_MS = BROADCAST_DELAY_MS;
/** Grace after the last horse crosses the line on the broadcast before the result is official. */
export const FINAL_MARGIN_MS = 750;
/** Most frames sent in one chunk (30 s at 10 fps); clients catching up fetch again. */
export const MAX_CHUNK_FRAMES = 300;
/** Event types whose text describes the finish (margin to the runner-up, photo). */
const FINISH_EVENT_TYPES: ReadonlySet<RaceEvent["type"]> = new Set(["finish", "photo_finish"]);

export function broadcastStartMs(postTimeMs: number): number {
  return postTimeMs + BROADCAST_DELAY_MS;
}

/** Wall time from which frames start being revealed. */
function revealStartMs(postTimeMs: number): number {
  return broadcastStartMs(postTimeMs) - LIVE_LOOKAHEAD_MS;
}

export function lastFrameIndex(replay: RaceReplay): number {
  return replay.frames.length - 1;
}

/** When the result becomes official on the broadcast clock. Server-only: derived from the final finish. */
export function broadcastEndsAtMs(replay: RaceReplay): number {
  return broadcastStartMs(replay.race.postTimeMs) + Math.ceil((replay.totalTicks * 1000) / replay.tickHz) + FINAL_MARGIN_MS;
}

/** Highest frame index that may be revealed at `nowMs` (-1 before the off). */
export function liveEdgeFrame(replay: RaceReplay, nowMs: number): number {
  const start = revealStartMs(replay.race.postTimeMs);
  if (nowMs < start) return -1;
  const f = Math.floor(((nowMs - start) * replay.tickHz) / (1000 * replay.sampleEvery));
  return Math.min(f, lastFrameIndex(replay));
}

/** True once the whole field has finished on the broadcast clock: result, seed and full replay may be served. */
export function isBroadcastOver(replay: RaceReplay, nowMs: number): boolean {
  return liveEdgeFrame(replay, nowMs) >= lastFrameIndex(replay) && nowMs >= broadcastEndsAtMs(replay);
}

/** The outcome-free part of a replay. Built field by field so new replay fields never leak by default. */
export function broadcastHeader(replay: RaceReplay): RaceBroadcastHeader {
  return {
    version: replay.version,
    engineVersion: replay.engineVersion,
    race: { ...replay.race },
    seedCommitment: replay.seedCommitment,
    tickHz: replay.tickHz,
    sampleEvery: replay.sampleEvery,
    trackLengthMm: replay.trackLengthMm,
    laneCount: replay.laneCount,
    horses: replay.horses.map((h) => ({ horseId: h.horseId, name: h.name, gate: h.gate, tactic: h.tactic, appearance: h.appearance })),
  };
}

/**
 * Events that may be shown with frames up to `edgeFrame`: tick <= edge tick. The finish
 * line ("X wins by a neck") also names the margin to the runner-up, so finish events are
 * held back until the runner-up has crossed the line too (they keep their original tick).
 */
export function revealedEvents(replay: RaceReplay, edgeFrame: number): RaceEvent[] {
  if (edgeFrame < 0) return [];
  const edgeTick = edgeFrame * replay.sampleEvery;
  const second = replay.result.finishOrder[1] ?? replay.result.finishOrder[0];
  const secondTick = second ? Math.ceil((second.finishTimeUs * replay.tickHz) / 1_000_000) : 0;
  return replay.events
    .filter((e) => e.tick <= edgeTick && (!FINISH_EVENT_TYPES.has(e.type) || secondTick <= edgeTick))
    .map((e) => ({ ...e }));
}

/**
 * The live endpoint payload for `fromFrame` at `nowMs`.
 *  - live: frames [fromFrame, min(edge, fromFrame + maxFrames - 1)], all revealed events, final null.
 *  - over: `final` is the complete replay; frames/events are left empty (they are inside `final`).
 */
export function sliceBroadcast(replay: RaceReplay, fromFrame: number, nowMs: number, maxFrames = MAX_CHUNK_FRAMES): RaceBroadcastChunk {
  const from = Math.max(0, Math.floor(fromFrame));
  const base = {
    raceId: replay.race.id,
    serverNowMs: Math.floor(nowMs),
    broadcastStartMs: broadcastStartMs(replay.race.postTimeMs),
    header: broadcastHeader(replay),
    fromFrame: from,
  };
  if (isBroadcastOver(replay, nowMs)) {
    return { ...base, frames: [], events: [], liveEdgeFrame: lastFrameIndex(replay), final: replay };
  }
  const edge = liveEdgeFrame(replay, nowMs);
  const end = Math.min(edge, from + Math.max(1, maxFrames) - 1);
  const frames = end >= from ? replay.frames.slice(from, end + 1).map((f) => f.slice()) : [];
  return { ...base, frames, events: revealedEvents(replay, edge), liveEdgeFrame: edge, final: null };
}
