/**
 * Dumps per-runner features + finishing positions from random fields drawn from the rival pool and
 * the starters, under random conditions, for fitting the raceRating weights (tools/balance/fit_rating.py).
 *   BAL_FIT=1 npx vitest run --config tools/balance/vitest.config.ts fit
 */
import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Going, Horse, RaceInput, RunningStyle, Surface } from "@thoroughbred/shared";
import { simulateRace } from "../../packages/racing-engine/src/index";
import { RIVAL_POOL, starterHorses } from "../../apps/web/src/server/demoData";
import { createRng } from "../../apps/web/src/server/prng";
import { simPlayerId } from "../../apps/web/src/server/balance/sim";
import { yieldNow } from "./out";

const RACES = Number(process.env.BAL_FIT_RACES ?? 3000);
const DIST = [1000, 1200, 1400, 1600, 2000, 2400];
const GOING_PEN: Record<Going, number> = { firm: 0, good: 0, soft: 140, heavy: 300 };

function features(h: Horse, tactic: RunningStyle, D: number, surface: Surface, going: Going): number[] {
  const s = h.stats;
  const gap = 1000 - s.adaptability;
  const matched = h.style === tactic;
  const surf = h.preferredSurface !== surface ? 40 + (110 * gap) / 1000 : 0;
  const goingPen = (GOING_PEN[going] * gap) / 1000;
  const dd = D - h.preferredDistanceM;
  const short = dd < 0 ? (-dd * (1100 - s.adaptability)) / 6000 : 0;
  const stamMul = 1000 + ((650 - s.stamina) * ((Math.max(0, D - 800) * 9) / 20)) / 1000;
  const distMul = dd > 0 ? 1000 + (dd * (1100 - s.adaptability)) / 3000 : 1000;
  const durMul = 1000 + (600 - s.durability) / 6;
  const drain = (stamMul * distMul * durMul * (matched ? 994 : 1006)) / 1e9 - 1000;
  return [
    ((s.speed - 650) * 105) / 100 - surf - goingPen - short + (matched ? 15 : -15), // cruise mm/s
    drain, // permille
    s.burst - 650,
    ((s.burst - 650) * (D - 1600)) / 1000,
    s.temperament - 650,
    s.durability - 650,
  ];
}

it.skipIf(!process.env.BAL_FIT)("dump fit data", async () => {
  const rng = createRng("fit-data");
  const styles: RunningStyle[] = ["front", "stalker", "closer"];
  const rows: { race: number; f: number[]; pos: number }[] = [];
  for (let k = 0; k < RACES; k++) {
    if (k % 50 === 0) await yieldNow();
    const D = rng.pick(DIST);
    const surface = rng.weighted<Surface>([["turf", 5], ["dirt", 4], ["synthetic", 2]]);
    const going = rng.pick<Going>(["firm", "good", "good", "soft", "heavy"]);
    const size = rng.int(8, 12);
    const pool = [...RIVAL_POOL, ...starterHorses(simPlayerId(k % 50))];
    const horses = rng.shuffle(pool).slice(0, size);
    const entries = horses.map((horse, i) => ({ gate: i + 1, horse, tactic: rng.chance(1, 4) ? rng.pick(styles) : horse.style }));
    const input: RaceInput = {
      race: { id: `fit-${k}`, name: "Fit", distanceM: D, surface, weather: "clear", going, raceClass: "handicap", postTimeMs: 0, purse: 1000 },
      entries,
      seed: (k.toString(16).padStart(8, "0") + "ab").repeat(8).slice(0, 64),
    };
    const r = simulateRace(input);
    const pos = new Map(r.result.finishOrder.map((f) => [f.horseId, f.position]));
    for (const e of entries) rows.push({ race: k, f: features(e.horse, e.tactic, D, surface, going), pos: pos.get(e.horse.id)! });
  }
  writeFileSync(fileURLToPath(new URL("./out/fit-data.json", import.meta.url)), JSON.stringify(rows));
});
