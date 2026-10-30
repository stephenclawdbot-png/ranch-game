import { describe, expect, it } from "vitest";
import { CARE_TO_RACING, createHorseState } from "./lifecycle";
import { generateFoundationGenome, maturityType, potentials } from "./genome";
import { IMPROVER_FROM_STARTS, IMPROVER_PERMILLE, IMPROVER_RUNS, IMPROVER_SHOW_RUNS, IMPROVER_STEP_OR, abilityMark, currentStats, progressionGainOr, progressionOf } from "./phenotype";
import { STAT_KEYS, type HorseState } from "./types";

const T0 = 1_800_000_000_000;
function horse(i: number, starts: number, realisation = 750, ownerId = "owner-a"): HorseState {
  const genome = generateFoundationGenome(`progress-${i}`, { season: 1 });
  const h = createHorseState({ id: `p${i}`, name: `Prog ${i}`, sex: i % 2 ? "colt" : "filly", ownerId, sireId: null, damId: null, generation: 0, genome, bornAtMs: T0, bornSeason: 1, careSessions: CARE_TO_RACING });
  const r = Object.fromEntries(STAT_KEYS.map((k) => [k, realisation])) as HorseState["training"]["realisation"];
  return { ...h, career: { ...h.career, starts }, training: { ...h.training, realisation: r } };
}
const POOL = Array.from({ length: 1200 }, (_, i) => i);

describe("progression: improvers step up mid-career", () => {
  it("about a fifth of horses are improvers, late developers most often", () => {
    const by = { early: [0, 0], normal: [0, 0], late: [0, 0] } as Record<string, [number, number]>;
    for (const i of POOL) {
      const h = horse(i, 40);
      const t = maturityType(h.genome);
      by[t]![1]++;
      if (progressionOf(h).orNow > 0) by[t]![0]++;
    }
    for (const t of ["early", "normal", "late"] as const) {
      const [imp, n] = by[t]!;
      if (n < 60) continue;
      expect(imp / n, t).toBeGreaterThan(IMPROVER_PERMILLE[t] / 1000 - 0.08);
      expect(imp / n, t).toBeLessThan(IMPROVER_PERMILLE[t] / 1000 + 0.08);
    }
  });

  it("the step starts inside the maturity window, arrives over a few runs, then stays", () => {
    for (const i of POOL.slice(0, 400)) {
      const series = Array.from({ length: 41 }, (_, s) => progressionOf(horse(i, s)));
      const first = series.findIndex((p) => p.orNow > 0);
      if (first < 0) continue;
      const [lo, hi] = IMPROVER_FROM_STARTS[maturityType(horse(i, 0).genome)];
      expect(first).toBeGreaterThan(lo);
      expect(first).toBeLessThanOrEqual(hi + 1);
      const full = series[40]!.orNow;
      expect(full).toBeGreaterThanOrEqual(IMPROVER_STEP_OR[0]);
      expect(full).toBeLessThanOrEqual(IMPROVER_STEP_OR[1]);
      expect(series[first + IMPROVER_RUNS - 1]!.orNow).toBe(full);
      for (let s = first; s < 40; s++) expect(series[s + 1]!.orNow).toBeGreaterThanOrEqual(series[s]!.orNow);
      // Shown as "improving" while it happens and a few runs after, then "improved"; nothing before.
      expect(series[first - 1]!.status).toBeNull();
      expect(series[first]!.status).toBe("improving");
      expect(series[first + IMPROVER_RUNS - 1 + IMPROVER_SHOW_RUNS]!.status).toBe("improving");
      if (first + IMPROVER_RUNS + IMPROVER_SHOW_RUNS <= 40) expect(series[first + IMPROVER_RUNS + IMPROVER_SHOW_RUNS]!.status).toBe("improved");
    }
  });

  it("lifts a horse with room to grow 4-8 OR, never past its potential, and is the same for every owner", () => {
    const gains: number[] = [];
    for (const i of POOL) {
      const h = horse(i, 34, 700);
      if (progressionOf(h).orNow === 0) continue;
      const g = progressionGainOr(h);
      gains.push(g);
      const cur = currentStats(h);
      const pot = potentials(h.genome);
      for (const k of ["speed", "stamina", "burst"] as const) expect(cur[k]).toBeLessThanOrEqual(pot[k]);
      const other = { ...h, ownerId: "owner-b" };
      expect(abilityMark(other)).toBe(abilityMark(h));
      expect(progressionOf(other)).toEqual(progressionOf(h));
    }
    gains.sort((a, b) => a - b);
    console.log(`improver gains (OR) at 34 starts, 70% trained: n=${gains.length} min ${gains[0]} median ${gains[gains.length >> 1]} max ${gains[gains.length - 1]}`);
    const median = gains[gains.length >> 1]!;
    expect(median).toBeGreaterThanOrEqual(3);
    expect(gains[gains.length - 1]!).toBeLessThanOrEqual(IMPROVER_STEP_OR[1] + 1);
  });

  it("a horse that never improves keeps exactly its maturity-and-training stats", () => {
    for (const i of POOL.slice(0, 200)) {
      const h = horse(i, 30);
      if (progressionOf(h).orNow !== 0) continue;
      expect(progressionGainOr(h)).toBe(0);
    }
  });
});
