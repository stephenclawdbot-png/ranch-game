/**
 * Story curve probe (first-hour follow-up): brand-new stables play Story chapter 1 and the first
 * races of chapter 2 the way the game suggests (apps/web/src/server/storyProbe.ts).
 *
 *   npx vitest run --config tools/season-harness/vitest.config.ts storyCurve
 *   env: PROBE_STABLES (default 40), PROBE_SEED (default "story-1"), PROBE_OUT (a JSON file to write)
 *
 *   PROBE_REST=race: run the game's own pick even when it is tired (default: wait for a rested horse).
 *   PROBE_SUGGEST=order: point the player at the first chapter race not yet won (the Story screen before
 *   2026-11-01) instead of the best fit.
 *
 * Kept out of the default suites (a *.harness.ts file); the regression test with a smaller seeded
 * run is apps/web/src/server/storyCurve.test.ts.
 */
import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { createDb } from "@thoroughbred/db";
import { installDeterministicRandom } from "./src/determinism";
import { defaultStartMs } from "./src/config";

it("story curve", async () => {
  const n = Number(process.env.PROBE_STABLES ?? 40);
  const seed = process.env.PROBE_SEED ?? "story-1";
  installDeterministicRandom(seed);
  const { probeStable, summarise } = await import("@/server/storyProbe");
  const h = await createDb({ url: null, pglite: "memory" });
  const t0 = Date.now();
  const rs = [];
  for (let i = 0; i < n; i++) {
    // New players arrive through the day: 07:00-22:00 UTC, a day apart so stables never share a clock.
    const start = defaultStartMs() + i * 86_400_000 + (7 + ((i * 7) % 16)) * 3_600_000;
    const r = await probeStable(h.db, i, { startMs: start, ch2Races: 3, suggest: process.env.PROBE_SUGGEST === "order" ? "order" : "fit", rest: process.env.PROBE_REST === "race" ? "race" : "wait" });
    rs.push(r);
    console.log(`stable ${i}: ch1 in ${r.ch1Races ?? "-"} races (${r.ch1Minutes ?? "-"} min), longest losing run ${r.longestLosingStreak}, waits ${r.waits} (${r.waitMinutes} min), racing ${Math.round(r.racingMinutes)} min, tired starts ${r.tiredStarts}; ` + r.races.map((x) => `${x.raceKey ?? "open"}:${x.position}/${x.field}${x.change ? `(${x.change})` : ""}[${x.level}v${x.strength ?? x.fieldMean}]`).join(" ") + " | ch2 " + r.ch2.map((x) => `${x.raceKey}:${x.position}/${x.field}[${x.level}v${x.strength}]`).join(" "));
  }
  const sum = summarise(rs);
  console.log(JSON.stringify(sum, null, 2));
  console.log(`wall ${Math.round((Date.now() - t0) / 1000)} s`);
  if (process.env.PROBE_OUT) writeFileSync(process.env.PROBE_OUT, JSON.stringify({ seed, summary: sum, stables: rs }, null, 2));
  await h.close();
});
