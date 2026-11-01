/**
 * Body build and mane / tail (V-04, V-05) are looks only: the engine's result, frames and events
 * are identical with or without them, and with different ones, for the same race.
 */
import { describe, expect, it } from "vitest";
import { simulateRace } from "@thoroughbred/racing-engine";
import type { RaceInput } from "@thoroughbred/shared";
import { fixtureInput } from "@/server/testing";

const NOW = Date.UTC(2026, 10, 1, 15, 0, 0);

const withLook = (input: RaceInput, f: (i: number) => { build?: unknown; hair?: unknown }): RaceInput => ({
  ...input,
  entries: input.entries.map((e, i) => {
    const { build: _b, hair: _h, ...rest } = e.horse.appearance;
    void _b;
    void _h;
    return { ...e, horse: { ...e.horse, appearance: { ...rest, ...(f(i) as object) } } };
  }),
});

describe("the look never changes a race", () => {
  it("same result hash, frames and events with no build, flat builds and extreme builds and manes", () => {
    for (const [k, d] of [1000, 1600, 2400].entries()) {
      const base = fixtureInput(`look-race-${k}`, NOW, { distanceM: d, runners: 8 });
      const variants = [
        withLook(base, () => ({})),
        withLook(base, () => ({ build: { height: 0, leg: 0, neck: 0, girth: 0, head: 0 }, hair: { mane: 0, tail: 0, thick: false, wave: false } })),
        withLook(base, (i) => ({ build: { height: 2 - (i % 5), leg: (i % 5) - 2, neck: 2, girth: -2, head: 1 }, hair: { mane: i % 4, tail: i % 3, thick: i % 2 === 0, wave: true } })),
      ];
      const replays = variants.map((v) => simulateRace(v));
      for (const r of replays.slice(1)) {
        expect(r.result).toEqual(replays[0]!.result);
        expect(r.frames).toEqual(replays[0]!.frames);
        expect(r.events).toEqual(replays[0]!.events);
        expect(r.totalTicks).toBe(replays[0]!.totalTicks);
      }
    }
  });
});
