/**
 * DEV ONLY: a LiveRaceFeed driven by a full replay, mimicking the server's broadcast
 * (frames up to the live edge, polled every `pollMs`; `final` once the field is home).
 */
import type { LiveRaceFeed, RaceEvent, RaceReplay } from "@thoroughbred/shared";

export interface FakeLiveFeed extends LiveRaceFeed {
  stop(): void;
}

export function fakeLiveFeed(replay: RaceReplay, broadcastStartMs: number, pollMs = 500): FakeLiveFeed {
  const listeners = new Set<() => void>();
  const frameDt = replay.sampleEvery / replay.tickHz;
  const lastFrame = replay.frames.length - 1;
  const state = {
    frames: [] as number[][],
    events: [] as RaceEvent[],
    liveEdgeFrame: -1,
    final: null as RaceReplay | null,
  };
  const poll = () => {
    const t = (Date.now() - broadcastStartMs) / 1000;
    const edge = Math.min(lastFrame, Math.floor(t / frameDt));
    if (edge > state.liveEdgeFrame) {
      // Arrays only ever grow (new array identity each poll, like a real client).
      state.frames = [...state.frames, ...replay.frames.slice(state.liveEdgeFrame + 1, edge + 1).map((f) => [...f])];
      state.events = replay.events.filter((e) => e.tick <= edge * replay.sampleEvery);
      state.liveEdgeFrame = edge;
    }
    if (!state.final && edge >= lastFrame && t > lastFrame * frameDt + 0.5) state.final = replay;
    for (const l of listeners) l();
  };
  const timer = setInterval(poll, pollMs);
  poll();
  const { seed: _s, result: _r, totalTicks: _t, frames: _f, events: _e, ...rest } = replay;
  return {
    raceId: replay.race.id,
    header: { version: 1, engineVersion: rest.engineVersion, race: rest.race, seedCommitment: rest.seedCommitment, tickHz: rest.tickHz, sampleEvery: rest.sampleEvery, trackLengthMm: rest.trackLengthMm, laneCount: rest.laneCount, horses: rest.horses },
    broadcastStartMs,
    get frames() {
      return state.frames;
    },
    get events() {
      return state.events;
    },
    get liveEdgeFrame() {
      return state.liveEdgeFrame;
    },
    get final() {
      return state.final;
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    stop() {
      clearInterval(timer);
    },
  };
}
