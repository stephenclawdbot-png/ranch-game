/**
 * Balance regression bands for the new-player experience (quick races).
 *
 * Fixed seeds, so every number is exact and reproducible; the bands are the design targets from
 * docs/balance.md, kept tolerant so a deliberate tweak doesn't need a test edit, while a change that
 * silently breaks the balance does. Full-size Monte Carlo reports: tools/balance (see docs/balance.md).
 */
import { describe, expect, it } from "vitest";
import { QUICK_POST_DELAY_MS } from "./races";
import { STARTER_STAT_CAP, starterHorses } from "./demoData";
import { TACTICS, feel, groupBy, mean, runQuick, simNonce, simPlayerId, type QuickSample } from "./sim";

const PLAYERS = 10;
const NATURAL_RACES = 12; // per horse
const OFF_RACES = 4; // per horse per off-style tactic

const natural: QuickSample[] = [];
const offStyle: QuickSample[] = [];
for (let p = 0; p < PLAYERS; p++) {
  const pid = simPlayerId(1000 + p);
  const horses = starterHorses(pid);
  for (let h = 0; h < 6; h++) {
    for (let r = 0; r < NATURAL_RACES; r++) natural.push(runQuick(pid, h, horses[h]!.style, simNonce(r, p * 7 + h)));
    for (const t of TACTICS) {
      if (t === horses[h]!.style) continue;
      for (let r = 0; r < OFF_RACES; r++) offStyle.push(runQuick(pid, h, t, simNonce(100 + r, p * 7 + h)));
    }
  }
}
const winRate = (xs: readonly QuickSample[]) => mean(xs.map((s) => (s.position === 1 ? 1 : 0)));
const top3Rate = (xs: readonly QuickSample[]) => mean(xs.map((s) => (s.position <= 3 ? 1 : 0)));

describe("new player experience (quick races, default tactic)", () => {
  it("wins about 1 in 10 and places about 1 in 3 overall", () => {
    expect(winRate(natural)).toBeGreaterThan(0.07);
    expect(winRate(natural)).toBeLessThan(0.15);
    expect(top3Rate(natural)).toBeGreaterThan(0.24);
    expect(top3Rate(natural)).toBeLessThan(0.4);
  });

  it("first top-3 comes in ~3-5 races and the first win in ~8-15 (expected, 1/p)", () => {
    expect(1 / top3Rate(natural)).toBeGreaterThan(2.5);
    expect(1 / top3Rate(natural)).toBeLessThan(4.5);
    expect(1 / winRate(natural)).toBeGreaterThan(7);
    expect(1 / winRate(natural)).toBeLessThan(15);
  });

  it("class matters: maidens are winnable, handicaps are a stretch", () => {
    const by = groupBy(natural, (s) => s.config.raceClass);
    const maiden = winRate(by.get("maiden")!);
    const novice = winRate(by.get("novice")!);
    const handicap = winRate(by.get("handicap")!);
    expect(maiden).toBeGreaterThan(novice);
    expect(novice).toBeGreaterThan(handicap);
    expect(maiden).toBeGreaterThan(0.11);
    expect(maiden).toBeLessThan(0.26);
    expect(handicap).toBeLessThan(0.1);
  });

  it("no starter archetype is useless or dominant", () => {
    for (const [archetype, xs] of groupBy(natural, (s) => s.archetype)) {
      expect(winRate(xs), archetype).toBeGreaterThan(0.03);
      expect(winRate(xs), archetype).toBeLessThan(0.22);
      expect(top3Rate(xs), archetype).toBeGreaterThan(0.15);
    }
  });

  it("preferred trip and surface matter visibly, not absolutely", () => {
    const niche = natural.filter((s) => s.surfaceMatch && Math.abs(s.distDelta) <= 200);
    const off = natural.filter((s) => !s.surfaceMatch && Math.abs(s.distDelta) >= 400);
    expect(top3Rate(niche)).toBeGreaterThan(top3Rate(off) + 0.08);
    expect(top3Rate(off)).toBeGreaterThan(0.08);
  });

  it("an off-style tactic is a real option, not a trap", () => {
    expect(winRate(offStyle)).toBeGreaterThan(winRate(natural) * 0.5);
    expect(winRate(offStyle)).toBeLessThan(winRate(natural) * 1.2);
  });

  it("starters are modest: no stat above the starter cap", () => {
    for (let p = 0; p < PLAYERS; p++)
      for (const h of starterHorses(simPlayerId(1000 + p))) for (const v of Object.values(h.stats)) expect(v).toBeLessThanOrEqual(STARTER_STAT_CAP);
  });
});

describe("quick-race feel and economy", () => {
  it("favourites win often but not mostly; finishes are close", () => {
    const f = feel(natural);
    expect(f.favouriteWin).toBeGreaterThan(0.18);
    expect(f.favouriteWin).toBeLessThan(0.42);
    expect(f.medianMarginL).toBeGreaterThan(0.8);
    expect(f.medianMarginL).toBeLessThan(3);
    expect(f.photo).toBeLessThan(0.08);
    for (const t of TACTICS) expect(f.winnerTactic[t]!, t).toBeGreaterThan(0.12);
  });

  it("no class or distance is a credit farm", () => {
    const perClass = [...groupBy(natural, (s) => s.config.raceClass).values()].map((xs) => mean(xs.map((s) => s.prize)));
    expect(Math.max(...perClass) / Math.min(...perClass)).toBeLessThan(1.6);
    const perHour = [...groupBy(natural, (s) => s.config.distanceM).values()].map(
      (xs) => (mean(xs.map((s) => s.prize)) * 3600) / (QUICK_POST_DELAY_MS / 1000 + 20 + mean(xs.map((s) => s.durationMs)) / 1000),
    );
    expect(Math.max(...perHour) / Math.min(...perHour)).toBeLessThan(2);
  });
});
