/**
 * Archetype strength map: rating of a quality-550 horse of each archetype (no stat noise, natural
 * style, preferred surface, good going), averaged over its possible preferred trips, per race distance.
 * Use it to keep archetypes equally strong at their own trips (niches, not raw power).
 */
import { it } from "vitest";
import type { Horse, HorseStats } from "@thoroughbred/shared";
import { ARCHETYPES, type Archetype } from "../../apps/web/src/server/demoData";
import { DISTANCES_M, raceRating } from "../../apps/web/src/server/races";
import { writeReport } from "./out";

it("archetype map", () => {
  const lines = [`# Archetype rating map (quality 550, natural style, own surface, good going)`, `${"".padEnd(12)} ${DISTANCES_M.map((d) => String(d).padStart(6)).join("")}   best  stat-sum`];
  const data: Record<string, number[]> = {};
  for (const [a, def] of Object.entries(ARCHETYPES) as [Archetype, (typeof ARCHETYPES)[Archetype]][]) {
    const stats = Object.fromEntries(Object.entries(def.mods).map(([k, v]) => [k, Math.max(80, Math.min(990, 550 + v))])) as unknown as HorseStats;
    const row = DISTANCES_M.map((d) => {
      let sum = 0;
      for (const pref of def.distances) {
        const style = def.styles[0]!;
        const horse = { stats, preferredDistanceM: pref, preferredSurface: "turf", style } as Horse;
        sum += raceRating(horse, style, { distanceM: d, surface: "turf", going: "good" });
      }
      return Math.round(sum / def.distances.length);
    });
    data[a] = row;
    lines.push(`${a.padEnd(12)} ${row.map((r) => String(r).padStart(6)).join("")}  ${String(Math.max(...row)).padStart(5)}  ${Object.values(def.mods).reduce((x, y) => x + y, 0)}`);
  }
  writeReport("archetypes", data, lines);
});
