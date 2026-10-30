import { describe, expect, it } from "vitest";
import { FRAME_STRIDE, type RaceReplay } from "@thoroughbred/shared";
import { fakeReplay } from "../dev/fakeReplay";
import { buildRaceCall, CALL_MIN_GAP_SEC, type CallLine, type LiveReplayView, type RaceCallInput } from "./buildRaceCall";
import { TEMPLATES } from "./templates";

const SALTMARSH = { name: "Saltmarsh", homeStraightM: 520, finishGradientPermille: 0 };
const HARROWGATE = { name: "Harrowgate", homeStraightM: 380, finishGradientPermille: 18 };

function namesOf(r: RaceReplay): Record<string, string> {
  return Object.fromEntries(r.horses.map((h) => [h.horseId, h.name]));
}

function input(r: RaceReplay, extra: Partial<RaceCallInput> = {}): RaceCallInput {
  return { replay: r, names: namesOf(r), distanceM: r.race.distanceM, uptoSec: Number.POSITIVE_INFINITY, seed: r.seedCommitment, ...extra };
}

/** What a live client holds at time T: frames up to the edge, events up to the edge, no result. */
function liveView(r: RaceReplay, T: number): LiveReplayView {
  const dt = r.sampleEvery / r.tickHz;
  const edge = Math.min(r.frames.length - 1, Math.floor(T / dt + 1e-9));
  return {
    race: { name: r.race.name, going: r.race.going },
    tickHz: r.tickHz,
    sampleEvery: r.sampleEvery,
    trackLengthMm: r.trackLengthMm,
    horses: r.horses.map((h) => ({ horseId: h.horseId, name: h.name })),
    frames: r.frames.slice(0, edge + 1),
    events: r.events.filter((e) => e.tick <= edge * r.sampleEvery),
  };
}

function lastFrameSec(r: RaceReplay): number {
  return ((r.frames.length - 1) * r.sampleEvery) / r.tickHz;
}

function render(lines: CallLine[]): string {
  return lines.map((l) => `${l.atSec.toFixed(1).padStart(5)}  ${l.kind.padEnd(9)} ${l.text}`).join("\n");
}

/** Constant speeds, evenly spread: a strung-out race with a clear order throughout. */
function strungOut(): RaceReplay {
  const base = fakeReplay({ horses: 5, distanceM: 1600, seed: 5, photoFinish: false, postTimeMs: 0 });
  const speeds = [16_500, 15_300, 14_100, 12_900, 11_700];
  const L = 1_600_000;
  const frames: number[][] = [];
  for (let f = 0; ; f++) {
    const t = f * 0.1;
    const frame: number[] = [];
    speeds.forEach((v, h) => frame.push(Math.min(L, Math.round(v * t)), h * 1000, v, 900));
    frames.push(frame);
    if (frame[(speeds.length - 1) * FRAME_STRIDE]! >= L) break;
  }
  return { ...base, frames, events: [{ tick: 0, type: "start", text: "Off" }], totalTicks: frames.length * 2 };
}

const BANNED = /\b(odds|punters?|favou?rite|bet|bets|betting|bookies?|bookmakers?|wager|stake money|price|tipster|evens|each[- ]way)\b/i;

describe("buildRaceCall", () => {
  const sprint = fakeReplay({ distanceM: 1200, horses: 8, seed: 3, postTimeMs: 0 });
  const route = fakeReplay({ distanceM: 2400, horses: 12, seed: 11, postTimeMs: 0 });
  const sprintIn = input(sprint, { mine: ["h5"], course: SALTMARSH });
  const routeIn = input(route, { mine: ["h5"], course: HARROWGATE });

  it("is deterministic per seed and varies between seeds", () => {
    expect(buildRaceCall(sprintIn)).toEqual(buildRaceCall(sprintIn));
    const a = buildRaceCall(sprintIn).map((l) => l.text);
    const b = buildRaceCall({ ...sprintIn, seed: "another race" }).map((l) => l.text);
    expect(a).not.toEqual(b);
  });

  it("never spoils: lines up to T never change when more data arrives", () => {
    for (const r of [sprint, route]) {
      for (const course of [SALTMARSH, HARROWGATE]) {
        const base = input(r, { mine: ["h2", "h7"], course });
        const full = buildRaceCall(base);
        const end = lastFrameSec(r) + 16;
        for (let T = 0; T <= end; T += 1.7) {
          const expected = full.filter((l) => l.atSec <= T + 1e-6);
          // A live client at the edge T.
          expect(buildRaceCall({ ...base, replay: liveView(r, T), uptoSec: T })).toEqual(expected);
          // The full replay cut at T.
          expect(buildRaceCall({ ...base, uptoSec: T })).toEqual(expected);
        }
      }
    }
  });

  it("never reads the official result", () => {
    const tampered: RaceReplay = { ...route, result: { ...route.result, finishOrder: [...route.result.finishOrder].reverse(), photoFinish: false } };
    expect(buildRaceCall({ ...routeIn, replay: tampered })).toEqual(buildRaceCall(routeIn));
  });

  it("names every runner once in the opening order, early", () => {
    for (const horses of [2, 3, 5, 8, 12, 16]) {
      const r = fakeReplay({ distanceM: 1600, horses, seed: horses, postTimeMs: 0 });
      const lines = buildRaceCall(input(r));
      const order = lines.filter((l) => l.kind === "order");
      const text = order.map((l) => l.text).join(" ");
      for (const h of r.horses) expect(text.split(h.name).length - 1, `${h.name} in "${text}"`).toBe(1);
      const leaderSpeedMmS = 16_000;
      expect(order.at(-1)!.atSec * leaderSpeedMmS).toBeLessThan(0.25 * r.trackLengthMm);
      expect(new Set(order.flatMap((l) => l.horseIds)).size).toBe(horses);
    }
  });

  it("spaces lines by the minimum gap", () => {
    for (const inp of [sprintIn, routeIn]) {
      const lines = buildRaceCall(inp);
      for (let k = 1; k < lines.length; k++) expect(lines[k]!.atSec - lines[k - 1]!.atSec).toBeGreaterThanOrEqual(CALL_MIN_GAP_SEC - 1e-6);
    }
  });

  it("calls a photograph in a close finish, then the result", () => {
    const lines = buildRaceCall(sprintIn);
    const photo = lines.find((l) => l.kind === "photo");
    expect(photo?.text).toMatch(/Photograph!/);
    const winnerSec = sprint.result.winningTimeUs / 1e6;
    expect(photo!.atSec - winnerSec).toBeLessThan(1);
    const result = lines.find((l) => l.kind === "result")!;
    expect(result.atSec).toBeGreaterThan(photo!.atSec);
    expect(result.horseIds.slice(0, 2)).toEqual(sprint.result.finishOrder.slice(0, 2).map((f) => f.horseId));
  });

  it("does not call a photograph when the winner is clear", () => {
    const r = strungOut();
    const lines = buildRaceCall(input(r));
    expect(lines.some((l) => l.kind === "photo")).toBe(false);
    const finish = lines.find((l) => l.kind === "finish")!;
    expect(finish.horseIds[0]).toBe("h1");
    expect(lines.find((l) => l.kind === "result")!.horseIds).toEqual(["h1", "h2", "h3"]);
  });

  it("gives sensible position lines in a strung-out race", () => {
    const r = strungOut();
    const lines = buildRaceCall(input(r, { mine: ["h4"] }));
    const positions = lines.filter((l) => l.kind === "position");
    expect(positions.length).toBeGreaterThan(0);
    for (const p of positions) {
      expect(p.horseIds.slice(0, 3)).toEqual(["h1", "h2", "h3"]);
      // The leader opens or is clearly named before the chasers.
      expect(p.text.indexOf("Copper Comet")).toBeLessThan(p.text.indexOf("Midnight Ledger"));
      expect(p.text).toMatch(/lengths?/);
    }
    expect(lines.some((l) => /strung|spread|stretched|daylight|line of runners/.test(l.text))).toBe(true);
    const you = lines.filter((l) => l.kind === "you" && l.horseIds[0] === "h4");
    expect(you.length).toBeGreaterThanOrEqual(2);
    for (const y of you) expect(y.text).toMatch(/fourth/);
    const order = lines.find((l) => l.kind === "order")!;
    expect(order.text).toMatch(/gap of|adrift/);
  });

  it("calls the viewer's horses by name more often", () => {
    const lines = buildRaceCall(routeIn);
    const count = (id: string) => lines.filter((l) => l.horseIds.includes(id)).length;
    const others = route.horses.filter((h) => h.horseId !== "h5").map((h) => count(h.horseId));
    expect(count("h5")).toBeGreaterThan(others.reduce((a, b) => a + b, 0) / others.length);
    expect(lines.filter((l) => l.kind === "you").length).toBeGreaterThanOrEqual(3);
  });

  it("is course-aware", () => {
    expect(buildRaceCall(sprintIn).some((l) => l.text.includes("Saltmarsh"))).toBe(true);
    expect(buildRaceCall(routeIn).some((l) => /hill/.test(l.text) && l.text.includes("Harrowgate"))).toBe(true);
  });

  it("handles empty and tiny inputs", () => {
    expect(buildRaceCall({ ...sprintIn, replay: liveView(sprint, -1), uptoSec: -1 })).toEqual([]);
    expect(buildRaceCall({ ...sprintIn, replay: { ...liveView(sprint, 0), frames: [] }, uptoSec: 0 })).toEqual([]);
    expect(buildRaceCall({ ...sprintIn, uptoSec: 0.5 })).toEqual([]);
    expect(buildRaceCall({ ...sprintIn, uptoSec: 0.6 })[0]!.kind).toBe("off");
  });

  it("has at least six variants per beat and no betting language", () => {
    for (const [beat, list] of Object.entries(TEMPLATES)) {
      expect(list.length, beat).toBeGreaterThanOrEqual(6);
      for (const t of list) expect(t, beat).not.toMatch(BANNED);
    }
    for (const inp of [sprintIn, routeIn]) for (const l of buildRaceCall(inp)) expect(l.text).not.toMatch(BANNED);
  });

  it("matches the sample calls", () => {
    expect(render(buildRaceCall(sprintIn))).toMatchSnapshot("1200 m, Saltmarsh");
    expect(render(buildRaceCall(routeIn))).toMatchSnapshot("2400 m, Harrowgate");
  });

});
