/**
 * Ground & weather (game-core climate.ts) for the web app: the per-course forecast the /week page
 * and GET /api/ground show, and the ground trend on a racecard.
 *
 * What it reveals: the exact going and weather only for days the card has already published
 * (RULES.cardHorizonMs ahead, the same races anyone can open), then a 4-day outlook computed as
 * a forecast from the last published day. The climate is seeded from public values like the
 * card itself, so this is a choice of what to show, not a secret.
 */
import * as gc from "@thoroughbred/game-core";
import { RULES, seasonNumberAt } from "@thoroughbred/db";
import type { GroundView } from "@/lib/competitionTypes";

const CLOCK = { epochMs: RULES.seasonEpochMs };

export function groundView(now: Date): GroundView {
  const season = seasonNumberAt(now);
  return {
    serverNowMs: now.getTime(),
    season,
    yearSeason: gc.yearSeasonOf(season),
    courses: gc.forecast(CLOCK, now.getTime(), RULES.cardHorizonMs).map((c) => ({ ...c, character: gc.courseById(c.courseId).character })),
  };
}

/**
 * The ground trend a racecard shows next to the going ("soft, drying"): from the climate at the
 * race's course on race day. Null for synthetic (always good), an unknown course, or a race whose
 * going isn't the course's own that day (a sister keeps its original's ground, §4d; races
 * published before the climate model).
 */
export function raceGroundTrend(conditions: { track?: unknown; surface?: unknown; going?: unknown }, postTime: Date): gc.GroundTrend | null {
  const course = gc.courseByName(typeof conditions.track === "string" ? conditions.track : null);
  const surface = conditions.surface;
  if (!course || (surface !== "turf" && surface !== "dirt")) return null;
  const ground = gc.raceGround(CLOCK, course.id, surface, postTime.getTime());
  return ground.going === conditions.going ? ground.trend : null;
}
