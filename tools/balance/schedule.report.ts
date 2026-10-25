/**
 * Rival pool + scheduled races: class strength ordering, competitiveness, win concentration, feel.
 */
import { it } from "vitest";
import type { RaceClass } from "@thoroughbred/shared";
import { RIVAL_POOL, ownerStableName } from "../../apps/web/src/server/demoData";
import { getRaceInput, raceRating } from "../../apps/web/src/server/races";
import { feel, feelLines, groupBy, mean, pct, runScheduled, type RaceStats } from "../../apps/web/src/server/balance/sim";
import { writeReport, yieldNow } from "./out";

const SLOTS = Number(process.env.BAL_SLOTS ?? 2400); // 2400 slots = 5 days of the 3-minute schedule
const CLASSES: RaceClass[] = ["maiden", "novice", "handicap", "listed", "graded"];

it("scheduled races", async () => {
  const lines: string[] = [];
  const data: Record<string, unknown> = { slots: SLOTS };

  // Pool overview: base rating at a neutral 1600 m good-ground race on the horse's own surface, natural style.
  const baseRating = (h: (typeof RIVAL_POOL)[number]) =>
    raceRating(h, h.style, { distanceM: h.preferredDistanceM, surface: h.preferredSurface, going: "good" });
  const ratings = RIVAL_POOL.map(baseRating).sort((a, b) => a - b);
  lines.push(`# Rival pool: ${RIVAL_POOL.length} horses; ideal-conditions rating min ${ratings[0]} p25 ${ratings[Math.floor(ratings.length / 4)]} median ${ratings[Math.floor(ratings.length / 2)]} p75 ${ratings[Math.floor((ratings.length * 3) / 4)]} max ${ratings[ratings.length - 1]}`);
  data.poolRatings = ratings;

  const races: RaceStats[] = [];
  const fieldRatings = new Map<RaceClass, number[]>();
  for (let slot = 0; slot < SLOTS; slot++) {
    if (slot % 50 === 0) await yieldNow();
    const st = runScheduled(slot);
    races.push(st);
    const input = getRaceInput(`s-${slot}`);
    const arr = fieldRatings.get(st.config.raceClass) ?? [];
    for (const e of input.entries) arr.push(baseRating(e.horse));
    fieldRatings.set(st.config.raceClass, arr);
  }

  lines.push("", "# By class");
  const byClass: Record<string, unknown> = {};
  for (const c of CLASSES) {
    const xs = races.filter((r) => r.config.raceClass === c);
    if (xs.length === 0) continue;
    const fr = fieldRatings.get(c) ?? [];
    const winners = groupBy(xs, (r) => r.winnerId);
    const topShare = Math.max(...[...winners.values()].map((w) => w.length)) / xs.length;
    const f = feel(xs);
    byClass[c] = {
      races: xs.length,
      fieldRating: mean(fr),
      distinctWinners: winners.size,
      topHorseShare: topShare,
      purse: mean(xs.map((r) => r.config.purse)),
      ...f,
    };
    lines.push(
      `${c.padEnd(9)} n=${String(xs.length).padStart(4)} field rating ${mean(fr).toFixed(0)} | distinct winners ${winners.size} top horse ${pct(topShare)} | fav ${pct(f.favouriteWin)} upset ${pct(f.upset)} photo ${pct(f.photo)} | purse ${mean(xs.map((r) => r.config.purse)).toFixed(0)}`,
    );
  }
  data.byClass = byClass;

  // Win concentration across the whole board.
  const winsByHorse = [...groupBy(races, (r) => r.winnerId)].map(([id, xs]) => [id, xs.length] as const).sort((a, b) => b[1] - a[1]);
  const starts = new Map<string, number>();
  for (let slot = 0; slot < SLOTS; slot++) for (const e of getRaceInput(`s-${slot}`).entries) starts.set(e.horse.id, (starts.get(e.horse.id) ?? 0) + 1);
  const top5 = winsByHorse.slice(0, 5).reduce((a, [, w]) => a + w, 0) / races.length;
  const zeroWin = RIVAL_POOL.filter((h) => !winsByHorse.some(([id]) => id === h.id)).length;
  const strikeRates = RIVAL_POOL.map((h) => ({ h, sr: (winsByHorse.find(([id]) => id === h.id)?.[1] ?? 0) / (starts.get(h.id) ?? 1) })).sort((a, b) => b.sr - a.sr);
  const byStable = [...groupBy(races, (r) => RIVAL_POOL.find((h) => h.id === r.winnerId)!.ownerId)].map(([id, xs]) => [ownerStableName(id), xs.length / races.length] as const).sort((a, b) => b[1] - a[1]);
  lines.push("", "# Results board concentration");
  lines.push(`top horse ${winsByHorse[0]![0]} ${pct(winsByHorse[0]![1] / races.length)} of all wins (fair share ${pct(1 / RIVAL_POOL.length)}), top-5 horses ${pct(top5)}, horses with no win ${zeroWin}/${RIVAL_POOL.length}`);
  lines.push(`best strike rates: ${strikeRates.slice(0, 5).map((x) => `${x.h.id} ${pct(x.sr)} (r${baseRating(x.h)})`).join(", ")}`);
  lines.push(`worst strike rates: ${strikeRates.slice(-5).map((x) => `${x.h.id} ${pct(x.sr)} (r${baseRating(x.h)})`).join(", ")}`);
  lines.push(`stables: ${byStable.map(([n, s]) => `${n} ${pct(s)}`).join(", ")}`);
  data.concentration = { topHorseShare: winsByHorse[0]![1] / races.length, top5, zeroWin, byStable, maxStrikeRate: strikeRates[0]!.sr };

  lines.push("", "# Feel (all scheduled races)");
  lines.push(...feelLines(races));
  data.feel = feel(races);
  data.avgDurationS = mean(races.map((r) => r.durationMs)) / 1000;
  lines.push(`avg race duration ${(mean(races.map((r) => r.durationMs)) / 1000).toFixed(0)} s`);
  writeReport("schedule", data, lines);
});
