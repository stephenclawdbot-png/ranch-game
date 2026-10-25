/**
 * New-player experience + quick-race economy + fairness, through the real quick-race path:
 * createQuickRace -> getRaceInput -> simulateRace, for many simulated players.
 */
import { it } from "vitest";
import { CLASS_PURSE, QUICK_POST_DELAY_MS } from "../../apps/web/src/server/races";
import { TACTICS, feel, feelLines, groupBy, mean, median, pct, runQuick, simNonce, simPlayerId, type QuickSample } from "../../apps/web/src/server/balance/sim";
import { writeReport, yieldNow } from "./out";

const PLAYERS = Number(process.env.BAL_PLAYERS ?? 30);
const RACES = Number(process.env.BAL_RACES ?? 10); // per horse per tactic
/** Seconds a player spends between races (result screen, picking the next runner). */
const UI_OVERHEAD_S = 20;

function summary(xs: readonly QuickSample[]) {
  return {
    n: xs.length,
    win: mean(xs.map((x) => (x.position === 1 ? 1 : 0))),
    top3: mean(xs.map((x) => (x.position <= 3 ? 1 : 0))),
    avgPos: mean(xs.map((x) => x.position)),
    avgPrize: mean(xs.map((x) => x.prize)),
    avgField: mean(xs.map((x) => x.fieldSize)),
  };
}
const fmt = (s: ReturnType<typeof summary>) =>
  `n=${String(s.n).padStart(5)} win ${pct(s.win).padStart(6)} top3 ${pct(s.top3).padStart(6)} pos ${s.avgPos.toFixed(2)} prize ${s.avgPrize.toFixed(0).padStart(5)}`;

it("player experience", async () => {
  const samples: QuickSample[] = [];
  const byKey = new Map<string, QuickSample>();
  for (let p = 0; p < PLAYERS; p++) {
    await yieldNow();
    const pid = simPlayerId(p);
    for (let h = 0; h < 6; h++)
      for (const t of TACTICS)
        for (let r = 0; r < RACES; r++) {
          const s = runQuick(pid, h, t, simNonce(r, p * 31 + h));
          samples.push(s);
          if (s.natural) byKey.set(`${p}:${h}:${r}`, s);
        }
  }
  const natural = samples.filter((s) => s.natural);
  const lines: string[] = [];
  const data: Record<string, unknown> = { players: PLAYERS, racesPerCell: RACES };

  lines.push(`# Quick races: ${samples.length} races, ${PLAYERS} players x 6 starters x 3 tactics x ${RACES}`);
  lines.push(`All, natural tactic   : ${fmt(summary(natural))}`);
  lines.push(`All, off-style tactic : ${fmt(summary(samples.filter((s) => !s.natural)))}`);
  data.overallNatural = summary(natural);

  lines.push("", "# By starter archetype (natural tactic)");
  const byArch: Record<string, unknown> = {};
  for (const [a, xs] of [...groupBy(natural, (s) => s.archetype)].sort()) {
    const niche = xs.filter((s) => s.surfaceMatch && Math.abs(s.distDelta) <= 200);
    const off = xs.filter((s) => !s.surfaceMatch || Math.abs(s.distDelta) > 400);
    byArch[a] = { all: summary(xs), niche: summary(niche), off: summary(off) };
    lines.push(`${a.padEnd(12)} all   ${fmt(summary(xs))}`);
    lines.push(`${"".padEnd(12)} niche ${fmt(summary(niche))}   (surface match, trip within 200 m)`);
    lines.push(`${"".padEnd(12)} off   ${fmt(summary(off))}   (wrong surface or trip >400 m off)`);
  }
  data.byArchetype = byArch;

  lines.push("", "# Tactic by archetype (win% / top3%) — natural style marked *");
  const tacTable: Record<string, Record<string, unknown>> = {};
  for (const [a, xs] of [...groupBy(samples, (s) => s.archetype)].sort()) {
    const cells: string[] = [];
    tacTable[a] = {};
    for (const [style, ys] of [...groupBy(xs, (s) => s.horse.style)].sort()) {
      const parts: string[] = [];
      for (const t of TACTICS) {
        const zs = ys.filter((s) => s.tactic === t);
        const sm = summary(zs);
        tacTable[a]![`${style}->${t}`] = sm;
        parts.push(`${t}${t === style ? "*" : ""} ${pct(sm.win, 0)}/${pct(sm.top3, 0)}`);
      }
      cells.push(`[style ${style}] ${parts.join(" ")}`);
    }
    lines.push(`${a.padEnd(12)} ${cells.join("  ")}`);
  }
  data.tactics = tacTable;

  lines.push("", "# By race distance vs preferred (natural tactic)");
  for (const [d, xs] of [...groupBy(natural, (s) => Math.max(-800, Math.min(800, Math.round(s.distDelta / 400) * 400)))].sort((a, b) => a[0] - b[0]))
    lines.push(`delta ${String(d).padStart(5)} m: ${fmt(summary(xs))}`);
  lines.push("", "# Surface match (natural tactic)");
  lines.push(`match   : ${fmt(summary(natural.filter((s) => s.surfaceMatch)))}`);
  lines.push(`mismatch: ${fmt(summary(natural.filter((s) => !s.surfaceMatch)))}`);
  lines.push("", "# By quick-race class (natural tactic)");
  for (const [c, xs] of groupBy(natural, (s) => s.config.raceClass)) lines.push(`${c.padEnd(9)}: ${fmt(summary(xs))} purse ${mean(xs.map((x) => x.config.purse)).toFixed(0)}`);

  // Per-horse spread: every (player, horse) natural-tactic win rate, then spread across a stable.
  const perHorse = [...groupBy(natural, (s) => `${s.playerId}:${s.horseIndex}`).values()].map((xs) => summary(xs).win);
  const perStable = [...groupBy(natural, (s) => s.playerId).values()].map((xs) => {
    const rates = [...groupBy(xs, (s) => s.horseIndex).values()].map((ys) => summary(ys).win);
    return { best: Math.max(...rates), worst: Math.min(...rates) };
  });
  lines.push("", "# Spread within a stable (natural tactic, per-horse win rate over its quick races)");
  lines.push(`mean best horse ${pct(mean(perStable.map((s) => s.best)))}, mean worst horse ${pct(mean(perStable.map((s) => s.worst)))}`);
  lines.push(`horses with 0 wins in ${RACES} races: ${pct(perHorse.filter((w) => w === 0).length / perHorse.length)}`);
  data.spread = { best: mean(perStable.map((s) => s.best)), worst: mean(perStable.map((s) => s.worst)) };

  // Session model: a new player rotates through the 6 starters with the default (natural) tactic.
  const firsts = Array.from({ length: PLAYERS }, (_, p) => {
    const seq: QuickSample[] = [];
    for (let r = 0; r < RACES; r++) for (let h = 0; h < 6; h++) seq.push(byKey.get(`${p}:${h}:${r}`)!);
    const firstTop3 = seq.findIndex((s) => s.position <= 3) + 1;
    const firstWin = seq.findIndex((s) => s.position === 1) + 1;
    return { firstTop3: firstTop3 || seq.length + 1, firstWin: firstWin || seq.length + 1 };
  });
  const pTop3 = summary(natural).top3;
  const pWin = summary(natural).win;
  lines.push("", "# New player session (rotate horses, natural tactic)");
  lines.push(`first top-3: mean race #${mean(firsts.map((f) => f.firstTop3)).toFixed(1)} (geometric 1/p = ${(1 / pTop3).toFixed(1)}), median ${median(firsts.map((f) => f.firstTop3))}`);
  lines.push(`first win  : mean race #${mean(firsts.map((f) => f.firstWin)).toFixed(1)} (geometric 1/p = ${(1 / pWin).toFixed(1)}), median ${median(firsts.map((f) => f.firstWin))}, censored at ${RACES * 6}: ${firsts.filter((f) => f.firstWin > RACES * 6).length}`);
  data.session = { meanFirstTop3: mean(firsts.map((f) => f.firstTop3)), meanFirstWin: mean(firsts.map((f) => f.firstWin)), geoTop3: 1 / pTop3, geoWin: 1 / pWin };

  // Economy.
  const avgRaceS = mean(natural.map((s) => s.durationMs)) / 1000;
  const cycleS = QUICK_POST_DELAY_MS / 1000 + avgRaceS + UI_OVERHEAD_S;
  const perRace = summary(natural).avgPrize;
  const bestPerRace = Math.max(...[...groupBy(natural, (s) => s.archetype).values()].map((xs) => summary(xs.filter((s) => s.surfaceMatch && Math.abs(s.distDelta) <= 200)).avgPrize));
  lines.push("", "# Economy (quick races)");
  lines.push(`avg race ${avgRaceS.toFixed(0)} s + ${QUICK_POST_DELAY_MS / 1000} s gate + ${UI_OVERHEAD_S} s UI = ${cycleS.toFixed(0)} s/race -> ${(3600 / cycleS).toFixed(0)} races/h`);
  lines.push(`avg credits/race ${perRace.toFixed(0)} -> ${((perRace * 3600) / cycleS).toFixed(0)} credits/h (natural tactic, random horse)`);
  lines.push(`best archetype in its niche: ${bestPerRace.toFixed(0)} credits/race -> ${((bestPerRace * 3600) / cycleS).toFixed(0)} credits/h if a player could farm it`);
  lines.push(`class purse table: ${JSON.stringify(CLASS_PURSE)}`);
  const byDist: Record<string, number> = {};
  for (const [d, xs] of [...groupBy(natural, (s) => s.config.distanceM)].sort((a, b) => a[0] - b[0])) {
    const cyc = QUICK_POST_DELAY_MS / 1000 + mean(xs.map((x) => x.durationMs)) / 1000 + UI_OVERHEAD_S;
    byDist[d] = (summary(xs).avgPrize * 3600) / cyc;
    lines.push(`  ${d} m: race ${(mean(xs.map((x) => x.durationMs)) / 1000).toFixed(0)} s, ${summary(xs).avgPrize.toFixed(0)} credits/race -> ${byDist[d]!.toFixed(0)} credits/h`);
  }
  const byClassEcon: Record<string, number> = {};
  for (const [c, xs] of groupBy(natural, (s) => s.config.raceClass)) byClassEcon[c] = summary(xs).avgPrize;
  lines.push(`  expected credits/race by class: ${Object.entries(byClassEcon).map(([c, v]) => `${c} ${v.toFixed(0)}`).join(", ")}`);
  data.economy = { avgRaceS, cycleS, perRace, perHour: (perRace * 3600) / cycleS, bestPerRace, byDist, byClassEcon };

  // Fairness/feel in quick races (one record per race).
  const races = natural;
  lines.push("", "# Feel (quick races, natural tactic)");
  lines.push(feelLines(races).join("\n"));
  data.feel = feel(races);
  data.playerRatingRank = mean(natural.map((s) => s.playerRatingRank));
  lines.push(`player's horse mean rating rank in field: ${mean(natural.map((s) => s.playerRatingRank)).toFixed(2)} of ${mean(natural.map((s) => s.fieldSize)).toFixed(1)}`);

  writeReport("player", data, lines);
});

