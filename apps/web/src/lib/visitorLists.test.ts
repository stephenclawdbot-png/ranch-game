/**
 * A visitor's race card is derived from a shared copy that can be an hour old. It must stay
 * sensible as the clock moves on, and it must never show a result the copy did not hold.
 */
import { describe, expect, it } from "vitest";
import type { RaceSummary } from "./types";
import { visitorListsAt } from "./visitorLists";

const T0 = Date.UTC(2026, 10, 20, 12, 0, 0);
const MIN = 60_000;

function race(id: string, postInMin: number, over: Partial<RaceSummary> = {}): RaceSummary {
  const postTimeMs = T0 + postInMin * MIN;
  return {
    id,
    kind: "live",
    name: `Race ${id}`,
    distanceM: 1600,
    surface: "turf",
    going: "good",
    weather: "clear",
    raceClass: "maiden",
    purse: 1000,
    postTimeMs,
    entriesCloseAtMs: postTimeMs - 30_000,
    entryCost: 1,
    entryFee: 0,
    fieldSize: 0,
    targetRunners: 8,
    stables: 0,
    meetingStartMs: postTimeMs,
    phase: "open",
    mine: 0,
    ...over,
  } as RaceSummary;
}

const winner = { horseId: "h", name: "Winner", stableName: "Stable", timeUs: 96_000_000 };
const copy = {
  upcoming: [race("a", 5, { stables: 2 }), race("b", 20), race("c", 35, { stables: 1 }), race("d", 50)],
  recent: [race("mid", -2, { phase: "live", stables: 3 }), race("r1", -20, { phase: "finished", winner, endsAtMs: T0 - 17 * MIN }), race("r2", -35, { phase: "finished", winner, endsAtMs: T0 - 32 * MIN })],
};

describe("visitorListsAt", () => {
  it("at the moment the copy was made: the card as it was, the running race as live", () => {
    const v = visitorListsAt(copy, T0);
    expect(v.upcoming.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    expect(v.recent.map((r) => r.id)).toEqual(["mid", "r1", "r2"]);
    expect(v.live?.id).toBe("mid");
  });

  it("later: races that have gone off leave the upcoming list; one with stables in it shows as live, with no outcome", () => {
    const v = visitorListsAt(copy, T0 + 6 * MIN);
    expect(v.upcoming.map((r) => r.id)).toEqual(["b", "c", "d"]);
    expect(v.live).toMatchObject({ id: "a", phase: "live" });
    expect(v.live).not.toHaveProperty("winner");
    expect(v.live).not.toHaveProperty("endsAtMs");
  });

  it("a race the copy caught mid-broadcast is dropped once its window has passed: its result is never guessed", () => {
    const v = visitorListsAt(copy, T0 + 3 * MIN);
    expect(v.recent.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(v.live).toBeNull();
    for (const r of [...v.upcoming, ...(v.live ? [v.live] : [])]) expect(r.winner).toBeUndefined();
  });

  it("a race nobody had entered is not offered once its entries have closed (it was called off)", () => {
    const v = visitorListsAt(copy, T0 + 19 * MIN + 45_000);
    expect(v.upcoming.map((r) => r.id)).toEqual(["c", "d"]);
    // and it never shows as live after its post time
    expect(visitorListsAt(copy, T0 + 21 * MIN).live).toBeNull();
  });

  it("only results that were in the copy are ever shown as results", () => {
    for (let m = 0; m <= 120; m += 7) {
      const v = visitorListsAt(copy, T0 + m * MIN);
      const withResult = [...v.upcoming, ...v.recent, ...(v.live ? [v.live] : [])].filter((r) => r.winner || r.endsAtMs !== undefined).map((r) => r.id);
      expect(withResult.every((id) => id === "r1" || id === "r2")).toBe(true);
    }
  });

  it("a very old copy leaves an empty card rather than stale races", () => {
    const v = visitorListsAt(copy, T0 + 24 * 60 * MIN);
    expect(v.upcoming).toEqual([]);
    expect(v.live).toBeNull();
    expect(v.recent.map((r) => r.id)).toEqual(["r1", "r2"]);
  });
});
