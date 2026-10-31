import { describe, expect, it } from "vitest";
import type { RaceReplay } from "@thoroughbred/shared";
import { fakeReplay } from "../../dev/fakeReplay";
import { buildRaceCall, buildVoicedRaceCall, type LiveReplayView, type RaceCallInput, type VoicedCallLine } from "../buildRaceCall";
import { CASTERS, pickCaster } from "./casters";
import { INTENSITIES, marginId, phraseId, VOCABULARY, type Intensity } from "./speech";

const SALTMARSH = { name: "Saltmarsh", homeStraightM: 520, finishGradientPermille: 0 };

function input(r: RaceReplay, extra: Partial<RaceCallInput> = {}): RaceCallInput {
  return { replay: r, names: Object.fromEntries(r.horses.map((h) => [h.horseId, h.name])), distanceM: r.race.distanceM, uptoSec: Number.POSITIVE_INFINITY, seed: r.race.id, ...extra };
}

/** A race from per-horse speed profiles (mm/s as a function of time), frames every 0.1 s. */
function profiled(speeds: Array<(t: number) => number>, distanceM: number, lanes?: number[]): RaceReplay {
  const base = fakeReplay({ horses: speeds.length, distanceM, seed: 5, photoFinish: false, postTimeMs: 0 });
  const L = distanceM * 1000;
  const frames: number[][] = [];
  const x = speeds.map(() => 0);
  for (let f = 0; f < 4000; f++) {
    const frame: number[] = [];
    speeds.forEach((v, h) => {
      const s = Math.round(v(f * 0.1));
      if (f > 0) x[h] = Math.min(L, x[h]! + s * 0.1);
      frame.push(Math.round(x[h]!), (lanes?.[h] ?? h) * 1000, x[h]! >= L ? 0 : s, 900);
    });
    frames.push(frame);
    if (x.every((d) => d >= L)) break;
  }
  return { ...base, frames, events: [{ tick: 0, type: "start", text: "Off" }], totalTicks: frames.length * base.sampleEvery };
}

/** Even speeds, well spread: the leader wins by a distance. */
const easyWin = () => profiled([16_500, 15_300, 14_100, 12_900, 11_700].map((v) => () => v), 1600);
/** Seven bunched front-runners; the eighth is last at halfway, then flies home and wins. */
const comeback = () =>
  profiled(
    [...[0, 1, 2, 3, 4, 5, 6].map((k) => () => 16_000 - k * 50), (t: number) => (t < 50 ? 14_500 : 18_500)],
    1600,
    [0, 1, 2, 3, 4, 5, 6, 4],
  );

const level = (i: Intensity) => INTENSITIES.indexOf(i);
const maxLevel = (lines: VoicedCallLine[]) => Math.max(...lines.map((l) => (l.speech ? level(l.speech.intensity) : -1)));

describe("voiced race call", () => {
  const sprint = fakeReplay({ distanceM: 1200, horses: 8, seed: 3, postTimeMs: 0 });
  const sprintIn = input(sprint, { mine: ["h5"], course: SALTMARSH });

  it("keeps the text call byte-identical", () => {
    for (const inp of [sprintIn, input(easyWin()), input(comeback(), { mine: ["h8"] }), input(fakeReplay({ distanceM: 2400, horses: 12, seed: 11, postTimeMs: 0 }))]) {
      expect(buildVoicedRaceCall(inp).map(({ speech: _s, ...l }) => l)).toEqual(buildRaceCall(inp));
    }
  });

  it("is deterministic, and only uses clips in the vocabulary", () => {
    expect(buildVoicedRaceCall(sprintIn)).toEqual(buildVoicedRaceCall(sprintIn));
    for (let seed = 1; seed <= 12; seed++) {
      const r = fakeReplay({ distanceM: 1000 + seed * 150, horses: 2 + (seed % 14), seed, postTimeMs: 0, photoFinish: seed % 2 === 0 });
      for (const l of buildVoicedRaceCall(input(r, { mine: [r.horses[seed % r.horses.length]!.horseId], course: seed % 3 ? SALTMARSH : undefined, going: ["firm", "good", "soft", "heavy"][seed % 4] }))) {
        for (const t of l.speech?.tokens ?? []) {
          if (t.k === "p") expect(VOCABULARY.has(t.id), `${t.id} in "${l.text}"`).toBe(true);
          else {
            expect(r.horses.some((h) => h.name === t.name)).toBe(true);
            expect(t.num).toBeGreaterThanOrEqual(1);
          }
        }
      }
    }
  });

  it("voices every line but the split times, starting with the off", () => {
    const lines = buildVoicedRaceCall(sprintIn);
    expect(lines[0]!.kind).toBe("off");
    expect(lines[0]!.speech!.intensity).toBe("building");
    for (const l of lines) if (l.kind !== "fraction") expect(l.speech, l.text).not.toBeNull();
  });

  it("never spoils: the spoken lines up to T never change when more data arrives", () => {
    const full = buildVoicedRaceCall(sprintIn);
    const dt = sprint.sampleEvery / sprint.tickHz;
    for (let T = 0; T <= 90; T += 4.3) {
      const edge = Math.min(sprint.frames.length - 1, Math.floor(T / dt + 1e-9));
      const view: LiveReplayView = {
        race: { name: sprint.race.name, going: sprint.race.going },
        tickHz: sprint.tickHz,
        sampleEvery: sprint.sampleEvery,
        trackLengthMm: sprint.trackLengthMm,
        horses: sprint.horses.map((h) => ({ horseId: h.horseId, name: h.name, gate: h.gate })),
        frames: sprint.frames.slice(0, edge + 1),
        events: sprint.events.filter((e) => e.tick <= edge * sprint.sampleEvery),
      };
      expect(buildVoicedRaceCall({ ...sprintIn, replay: view, uptoSec: T })).toEqual(full.filter((l) => l.atSec <= T + 1e-6));
    }
  });

  it("a photo finish: a duel at climax in the final furlong, the photograph and its verdict shouted", () => {
    const lines = buildVoicedRaceCall(sprintIn);
    const photo = lines.find((l) => l.kind === "photo")!;
    expect(photo.speech!.intensity).toBe("climax");
    expect(lines.find((l) => l.kind === "result")!.speech!.intensity).toBe("climax");
    const lastFurlong = lines.filter((l) => l.atSec < photo.atSec && l.atSec > photo.atSec - 12 && l.speech);
    expect(lastFurlong.some((l) => l.speech!.intensity === "climax")).toBe(true);
    // The verdict names the winner with the saddle-cloth number: "First, number two, ...".
    const result = lines.find((l) => l.kind === "result")!.speech!.tokens;
    const winner = sprint.horses.find((h) => h.horseId === lines.find((l) => l.kind === "result")!.horseIds[0])!;
    expect(result.some((t) => t.k === "p" && t.id === `num_${winner.gate}`)).toBe(true);
  });

  it("an easy winner is called calmer: nothing reaches climax and the result is read calmly", () => {
    const lines = buildVoicedRaceCall(input(easyWin()));
    expect(maxLevel(lines)).toBeLessThanOrEqual(level("building"));
    expect(lines.find((l) => l.kind === "finish")!.speech!.intensity).toBe("building");
    expect(lines.find((l) => l.kind === "result")!.speech!.intensity).toBe("calm");
    // The start is calmer than the finish all the same.
    expect(lines.find((l) => l.kind === "order")!.speech!.intensity).toBe("calm");
  });

  it("a comeback: big ground late is called with rising excitement and the winner at climax", () => {
    const r = comeback();
    const lines = buildVoicedRaceCall(input(r));
    const finish = lines.find((l) => l.kind === "finish")!;
    expect(finish.horseIds[0]).toBe("h8");
    expect(finish.speech!.intensity).toBe("climax");
    const late = lines.filter((l) => l.atSec > 55 && l.atSec < finish.atSec && l.horseIds.includes("h8") && l.speech);
    expect(late.length).toBeGreaterThan(0);
    for (const l of late) expect(level(l.speech!.intensity), l.text).toBeGreaterThanOrEqual(level("building"));
    expect(lines.some((l) => l.speech?.tokens.some((t) => t.k === "p" && (t.id === phraseId("But look at this!") || t.id === phraseId("And here comes"))))).toBe(true);
    // Early on the call is calm.
    for (const l of lines.filter((x) => x.atSec < 30 && x.kind !== "off")) expect(l.speech?.intensity ?? "calm").toBe("calm");
  });

  it("says the viewer's horses as 'your X'", () => {
    const lines = buildVoicedRaceCall(input(comeback(), { mine: ["h8"] }));
    expect(lines.some((l) => l.speech?.tokens.some((t) => t.k === "name" && t.your && t.name === "Copper Comet") || l.speech?.tokens.some((t) => t.k === "p" && t.id === "your"))).toBe(true);
  });

  it("maps margins to the library", () => {
    expect(marginId(0)).toBe("m_a_nose");
    expect(marginId(2400 * 0.07, true)).toBe("m_a_short_head");
    expect(marginId(2400 * 0.25, true)).toBe("m_a_neck");
    expect(marginId(2400 * 30)).toBe("m_over_twenty_lengths");
    for (const mm of [0, 100, 500, 1000, 2000, 4000, 9000, 30_000, 60_000, 200_000]) {
      expect(VOCABULARY.has(marginId(mm))).toBe(true);
      expect(VOCABULARY.has(marginId(mm, true))).toBe(true);
    }
  });
});

describe("caster pick", () => {
  it("is deterministic from the race id and uses every caster", () => {
    expect(pickCaster("race-1")).toEqual(pickCaster("race-1"));
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) seen.add(pickCaster(`00000000-0000-4000-8000-${`${i}`.padStart(12, "0")}`).id);
    expect(seen).toEqual(new Set(CASTERS.map((c) => c.id)));
  });
});
