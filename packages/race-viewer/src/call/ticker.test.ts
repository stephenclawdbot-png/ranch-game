import { describe, expect, it } from "vitest";
import type { RaceReplay } from "@thoroughbred/shared";
import { fakeReplay } from "../dev/fakeReplay";
import type { CallLine, LiveReplayView } from "./buildRaceCall";
import { RaceCallFeed, callLineAt } from "./ticker";

const r = fakeReplay({ horses: 8, seed: 3, distanceM: 1200, photoFinish: true, postTimeMs: 0 });
const dt = r.sampleEvery / r.tickHz;
const opts = { names: Object.fromEntries(r.horses.map((h) => [h.horseId, h.name])), mine: ["h3"], distanceM: r.race.distanceM, seed: r.race.id };

/** What a live client holds at time T. Reading `result` (or anything outcome-like) throws. */
function liveView(src: RaceReplay, T: number): LiveReplayView {
  const edge = Math.min(src.frames.length - 1, Math.floor(T / dt + 1e-9));
  const view: LiveReplayView = {
    race: { name: src.race.name, going: src.race.going },
    tickHz: src.tickHz,
    sampleEvery: src.sampleEvery,
    trackLengthMm: src.trackLengthMm,
    horses: src.horses.map((h) => ({ horseId: h.horseId, name: h.name })),
    frames: src.frames.slice(0, edge + 1),
    events: src.events.filter((e) => e.tick <= edge * src.sampleEvery),
  };
  return new Proxy(view, {
    get(target, key) {
      if (key === "result" || key === "seed" || key === "totalTicks") throw new Error(`spoiler: read ${String(key)} while live`);
      return Reflect.get(target, key);
    },
  });
}

describe("RaceCallFeed (live)", () => {
  it("never reads the result and never says anything past the data edge", () => {
    for (const T of [5, 20, 40, 60]) {
      const feed = new RaceCallFeed(opts);
      feed.update(liveView(r, T), false, T);
      expect(feed.lines.length).toBeGreaterThan(0);
      for (const l of feed.lines) expect(l.atSec).toBeLessThanOrEqual(T + 1e-9);
    }
  });

  it("lines already said never change as more of the race arrives, and match the official call", () => {
    const fin = new RaceCallFeed(opts);
    fin.update(r, true, Infinity);
    const feed = new RaceCallFeed(opts);
    for (let T = 1; T < 50; T += 3.3) {
      feed.update(liveView(r, T), false, T);
      const prefix = fin.lines.filter((l) => l.atSec <= T - 3);
      expect(feed.lines.slice(0, prefix.length).map((l) => l.text)).toEqual(prefix.map((l) => l.text));
    }
  });

  it("rebuilds only when new frames arrive", () => {
    const feed = new RaceCallFeed(opts);
    const v = liveView(r, 10);
    feed.update(v, false, 10);
    const a = feed.lines;
    feed.update(v, false, 10);
    expect(feed.lines).toBe(a);
  });
});

describe("callLineAt", () => {
  const L = (atSec: number, priority: number, text = `${atSec}`): CallLine => ({ atSec, priority, text, kind: "position", horseIds: [] });

  it("never shows a line before its time", () => {
    const lines = [L(1, 50), L(5, 50), L(9, 50)];
    expect(callLineAt(lines, 0.5, { minShowSec: 2.5, holdSec: 6 })).toBeNull();
    expect(callLineAt(lines, 4.99, { minShowSec: 2.5, holdSec: 6 })!.atSec).toBe(1);
    expect(callLineAt(lines, 5, { minShowSec: 2.5, holdSec: 6 })!.atSec).toBe(5);
    expect(callLineAt(lines, 20, { minShowSec: 2.5, holdSec: 6 })).toBeNull();
  });

  it("drops low-priority lines that would overlap (fast playback), keeps the important ones", () => {
    const lines = [L(1, 50), L(3.5, 40), L(6, 80), L(8.5, 30), L(11, 60)];
    // 2x: 5 race seconds per line.
    const pick = { minShowSec: 5, holdSec: 12 };
    expect(callLineAt(lines, 4, pick)!.atSec).toBe(1); // 3.5 (lower) dropped
    expect(callLineAt(lines, 6.5, pick)!.atSec).toBe(6); // higher priority replaces
    expect(callLineAt(lines, 9, pick)!.atSec).toBe(6); // 8.5 dropped
    expect(callLineAt(lines, 11.5, pick)!.atSec).toBe(11);
    // 1x: every line shows in turn.
    expect(callLineAt(lines, 9, { minShowSec: 2.5, holdSec: 6 })!.atSec).toBe(8.5);
  });

  it("on the real call at 1x nothing is dropped", () => {
    const fin = new RaceCallFeed(opts);
    fin.update(r, true, Infinity);
    const seen = new Set<string>();
    for (let t = 0; t < 90; t += 0.1) {
      const l = callLineAt(fin.lines, t, { minShowSec: 2.5, holdSec: 6 });
      if (l) seen.add(`${l.atSec}|${l.text}`);
    }
    expect(seen.size).toBe(fin.lines.length);
  });
});
