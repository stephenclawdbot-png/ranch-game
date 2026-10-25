/**
 * Stat & preference sanity (engine level, controlled fields).
 * One test horse (h1) in a field of 10 otherwise-equal 650 horses; each experiment re-runs the
 * SAME seeds with one change, so differences are paired and low-noise.
 */
import { it } from "vitest";
import type { HorseStats, RunningStyle } from "@thoroughbred/shared";
import { simulateRace } from "../../packages/racing-engine/src/index";
import { makeInput, seedFor, type EntryOpts } from "../../packages/racing-engine/src/test-fixtures";
import { writeReport, yieldNow } from "./out";

const STYLES: RunningStyle[] = ["front", "stalker", "closer"];
const N = Number(process.env.BAL_N ?? 240);
const FIELD = 10;
const DISTANCES = [1000, 1400, 1600, 2000, 2400];
const STAT_KEYS: (keyof HorseStats)[] = ["speed", "stamina", "burst", "durability", "adaptability", "temperament"];

interface Probe {
  stats?: Partial<HorseStats>;
  preferredDistanceM?: number;
  preferredSurface?: "turf" | "dirt" | "synthetic";
  style?: RunningStyle;
  tactic?: RunningStyle;
}

/** Mean finishing position and win share of h1 over N paired seeds. */
async function probe(d: number, p: Probe, opts: { going?: "good" | "soft" | "heavy" | "firm"; surface?: "turf" | "dirt" } = {}) {
  let pos = 0;
  let wins = 0;
  for (let s = 0; s < N; s++) {
    if (s % 40 === 0) await yieldNow();
    const style = p.style ?? STYLES[s % 3]!;
    const field: EntryOpts[] = [
      {
        stats: { ...p.stats },
        style,
        tactic: p.tactic ?? style,
        preferredDistanceM: p.preferredDistanceM ?? d,
        preferredSurface: p.preferredSurface ?? opts.surface ?? "dirt",
      },
    ];
    for (let k = 1; k < FIELD; k++) {
      const st = STYLES[(k + s) % 3]!;
      field.push({ stats: 650, style: st, tactic: st, preferredDistanceM: d, preferredSurface: opts.surface ?? "dirt" });
    }
    const entries = field.map((e, i) => ({ ...e, gate: ((i + s) % FIELD) + 1 }));
    const r = simulateRace(makeInput(entries, { distanceM: d, going: opts.going ?? "good", surface: opts.surface ?? "dirt", seed: seedFor(900_000 + s) }));
    const me = r.result.finishOrder.find((f) => f.horseId === "h1")!;
    pos += me.position;
    if (me.position === 1) wins++;
  }
  return { pos: pos / N, win: wins / N };
}

it("stat value, preferences, tactic match", async () => {
  const out: Record<string, unknown> = {};
  const base650 = { speed: 650, stamina: 650, burst: 650, durability: 650, adaptability: 650, temperament: 650 };

  // 1) Value of +150 in each stat (vs all-650), per distance. Gain = baseline mean pos - probe mean pos.
  const statRows: string[] = [];
  const statTable: Record<string, Record<string, { gain: number; win: number }>> = {};
  for (const d of DISTANCES) {
    const base = await probe(d, { stats: base650 });
    statTable[d] = { base: { gain: 0, win: base.win } };
    const cells: string[] = [`base win ${(base.win * 100).toFixed(1)}%`];
    for (const k of STAT_KEYS) {
      const r = await probe(d, { stats: { ...base650, [k]: 800 } });
      statTable[d]![k] = { gain: base.pos - r.pos, win: r.win };
      cells.push(`${k} +${(base.pos - r.pos).toFixed(2)}pos/${(r.win * 100).toFixed(0)}%`);
    }
    statRows.push(`${d}m: ${cells.join(" | ")}`);
  }
  out.statValue = statTable;

  // 2) Stamina vs distance: stamina 450 vs 850 at each distance.
  const stamRows: string[] = [];
  const stam: Record<string, { lo: number; hi: number }> = {};
  for (const d of DISTANCES) {
    const lo = await probe(d, { stats: { ...base650, stamina: 450 } });
    const hi = await probe(d, { stats: { ...base650, stamina: 850 } });
    stam[d] = { lo: lo.win, hi: hi.win };
    stamRows.push(`${d}m stamina450 win ${(lo.win * 100).toFixed(1)}% pos ${lo.pos.toFixed(2)} | stamina850 win ${(hi.win * 100).toFixed(1)}% pos ${hi.pos.toFixed(2)}`);
  }
  out.staminaVsDistance = stam;

  // 3) Preferences (1600 m, all-650 horse): surface off by adaptability, distance off by +-400.
  const pref: Record<string, { pos: number; win: number }> = {};
  for (const a of [300, 650, 900]) {
    pref[`surface-on adapt${a}`] = await probe(1600, { stats: { ...base650, adaptability: a }, preferredSurface: "dirt" });
    pref[`surface-off adapt${a}`] = await probe(1600, { stats: { ...base650, adaptability: a }, preferredSurface: "turf" });
  }
  pref["pref 1200 (race longer)"] = await probe(1600, { stats: base650, preferredDistanceM: 1200 });
  pref["pref 2000 (race shorter)"] = await probe(1600, { stats: base650, preferredDistanceM: 2000 });
  pref["pref 1600"] = await probe(1600, { stats: base650 });
  pref["heavy going adapt300"] = await probe(1600, { stats: { ...base650, adaptability: 300 } }, { going: "heavy" });
  pref["heavy going adapt900"] = await probe(1600, { stats: { ...base650, adaptability: 900 } }, { going: "heavy" });
  out.preferences = pref;

  // 4) Tactic match bonus: h1 natural style X, ridden as X vs ridden as each other tactic.
  const tac: Record<string, { pos: number; win: number }> = {};
  for (const style of STYLES) for (const t of STYLES) tac[`${style} ridden ${t}`] = await probe(1600, { stats: base650, style, tactic: t });
  out.tacticMatch = tac;

  const lines = [
    `# Stat value (h1 one stat 800 vs field of 650s, N=${N}/cell, field ${FIELD}; fair win = 10%)`,
    ...statRows,
    "",
    "# Stamina vs distance",
    ...stamRows,
    "",
    "# Preferences @1600m",
    ...Object.entries(pref).map(([k, v]) => `${k}: win ${(v.win * 100).toFixed(1)}% pos ${v.pos.toFixed(2)}`),
    "",
    "# Tactic match @1600m",
    ...Object.entries(tac).map(([k, v]) => `${k}: win ${(v.win * 100).toFixed(1)}% pos ${v.pos.toFixed(2)}`),
  ];
  writeReport("stats", out, lines);
});
