/**
 * Competition calendar. Seasons (4 real weeks) exist for competitions only: leagues, the
 * Weekend Feature, the Season Final and titles — never for horse ageing.
 *
 * A race goes off every 3 minutes. Conditions are published in advance (deterministic from
 * the season and slot number), entries close 1 minute before the off.
 *
 *   - Regular slots rotate through the classes (maiden … G1) on a fixed 20-slot cycle.
 *   - Weekend Feature: a G1-level feature every Saturday 19:00 UTC; qualifiers (Listed-level)
 *     run daily Mon–Fri at 19:00 UTC — the top-3 of any qualifier earn a feature place.
 *   - Season Final: the last day of the season, one championship per division at 18:00–19:30 UTC.
 */
import type { Going, Surface, Weather } from "@thoroughbred/shared";
import type { RaceKind, RaceSlot, RaceTier } from "./types";
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, SEASON_DAYS, seasonOf, seasonStartMs, type SeasonClock } from "./time";
import { ENTRY_FEE_BY_TIER, PURSE_BY_TIER, SEASON_FINAL_PURSE, WEEKEND_FEATURE_PURSE } from "./economy";
import { Rng, seedFrom } from "./rng";

export const SLOT_INTERVAL_MS = 3 * MS_PER_MINUTE;
export const ENTRY_CLOSE_BEFORE_MS = MS_PER_MINUTE;
export const SLOTS_PER_DAY = MS_PER_DAY / SLOT_INTERVAL_MS; // 480

/** 20-slot class rotation (one hour = 20 slots). */
export const TIER_CYCLE: readonly RaceTier[] = [
  "maiden",
  "hcp_0_55",
  "novice",
  "quick",
  "hcp_50_75",
  "maiden",
  "hcp_0_55",
  "hcp_70_95",
  "quick",
  "novice",
  "hcp_50_75",
  "listed",
  "maiden",
  "hcp_0_55",
  "quick",
  "hcp_70_95",
  "novice",
  "hcp_50_75",
  "g3",
  "quick",
];
/** Hours (UTC) at which slot 18 of the hour is upgraded to G2 / G1 instead of G3. */
export const G2_HOURS = [2, 8, 14, 20];
export const G1_HOURS = [21];

export const DISTANCES: Record<"sprint" | "mile" | "middle" | "staying", number[]> = {
  sprint: [1000, 1100, 1200],
  mile: [1400, 1500, 1600],
  middle: [1800, 2000, 2200],
  staying: [2400, 2800, 3200],
};
export const DIVISIONS = ["sprint", "mile", "middle", "staying"] as const;
export type Division = (typeof DIVISIONS)[number];

function weatherAndGoing(rng: Rng, surface: Surface): { weather: Weather; going: Going } {
  const weather = rng.pick<Weather>(["clear", "clear", "clear", "overcast", "overcast", "rain", "dusk"]);
  if (surface === "synthetic") return { weather, going: "good" };
  if (weather === "rain") return { weather, going: rng.chance(400) ? "heavy" : "soft" };
  return { weather, going: rng.chance(surface === "turf" ? 250 : 150) ? "firm" : rng.chance(120) ? "soft" : "good" };
}

const TIER_NAME: Partial<Record<RaceTier, string>> = {
  maiden: "Maiden Stakes",
  novice: "Novice Stakes",
  quick: "Quick Dash",
  hcp_0_55: "Handicap",
  hcp_50_75: "Handicap",
  hcp_70_95: "Handicap",
  listed: "Listed Stakes",
  g3: "Group 3",
  g2: "Group 2",
  g1: "Group 1",
};

/** The regular slot with absolute index `n` (n * 3 min after the season epoch). */
export function regularSlot(clock: SeasonClock, n: number): RaceSlot {
  const postTimeMs = clock.epochMs + n * SLOT_INTERVAL_MS;
  const season = seasonOf(clock, postTimeMs);
  const rng = new Rng(seedFrom("slot", n));
  const inHour = n % 20;
  const hour = Math.floor(((postTimeMs % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY / MS_PER_HOUR);
  let tier = TIER_CYCLE[inHour]!;
  if (tier === "g3" && G1_HOURS.includes(hour)) tier = "g1";
  else if (tier === "g3" && G2_HOURS.includes(hour)) tier = "g2";
  const div = rng.pick(tier === "quick" ? (["sprint", "mile"] as const) : DIVISIONS);
  const distanceM = rng.pick(DISTANCES[div]);
  const surface = rng.pick<Surface>(["turf", "turf", "dirt", "dirt", "synthetic"]);
  const { weather, going } = weatherAndGoing(rng, surface);
  return {
    id: `s${season}-r${n}`,
    name: `${distanceM}m ${TIER_NAME[tier] ?? "Race"}`,
    kind: tier === "quick" ? "quick" : "regular",
    tier,
    season,
    postTimeMs,
    entryCloseMs: postTimeMs - ENTRY_CLOSE_BEFORE_MS,
    distanceM,
    surface,
    goingForecast: going,
    weather,
    purse: PURSE_BY_TIER[tier],
    entryFee: ENTRY_FEE_BY_TIER[tier],
    maxRunners: tier === "quick" ? 8 : 12,
    handicap: tier.startsWith("hcp_"),
    division: div,
  };
}

/** Regular slots with post time in [fromMs, toMs). */
export function regularSlots(clock: SeasonClock, fromMs: number, toMs: number): RaceSlot[] {
  const first = Math.max(0, Math.ceil((fromMs - clock.epochMs) / SLOT_INTERVAL_MS));
  const out: RaceSlot[] = [];
  for (let n = first; clock.epochMs + n * SLOT_INTERVAL_MS < toMs; n++) out.push(regularSlot(clock, n));
  return out;
}

/** Next slot a horse could still enter (entries open) at `nowMs`. */
export function nextOpenSlot(clock: SeasonClock, nowMs: number): RaceSlot {
  let n = Math.max(0, Math.ceil((nowMs + ENTRY_CLOSE_BEFORE_MS - clock.epochMs) / SLOT_INTERVAL_MS));
  while (clock.epochMs + n * SLOT_INTERVAL_MS - ENTRY_CLOSE_BEFORE_MS <= nowMs) n++;
  return regularSlot(clock, n);
}

function special(season: number, id: string, name: string, kind: RaceKind, tier: RaceTier, postTimeMs: number, purse: number, division: Division, seedLabel: string): RaceSlot {
  const rng = new Rng(seedFrom("special", season, seedLabel));
  const distanceM = DISTANCES[division][1]!;
  const surface: Surface = kind === "season_final" ? (division === "sprint" ? "dirt" : "turf") : "turf";
  const { weather, going } = weatherAndGoing(rng, surface);
  return {
    id,
    name,
    kind,
    tier,
    season,
    postTimeMs,
    entryCloseMs: postTimeMs - ENTRY_CLOSE_BEFORE_MS,
    distanceM,
    surface,
    goingForecast: going,
    weather,
    purse,
    entryFee: ENTRY_FEE_BY_TIER[tier],
    maxRunners: kind === "season_final" || kind === "weekend_feature" ? 14 : 12,
    handicap: false,
    division,
  };
}

/** Weekend Features and their weekday qualifiers, plus the Season Final, for one season. */
export function featureCalendar(clock: SeasonClock, season: number): RaceSlot[] {
  const start = seasonStartMs(clock, season);
  const out: RaceSlot[] = [];
  const divRng = new Rng(seedFrom("feature-divisions", season));
  for (let week = 0; week < SEASON_DAYS / 7; week++) {
    const division = divRng.pick(DIVISIONS);
    for (let d = 0; d < 7; d++) {
      const day = week * 7 + d;
      if (day === SEASON_DAYS - 1) continue; // final day belongs to the Season Final
      const dayStart = start + day * MS_PER_DAY;
      const dow = (((Math.floor(dayStart / MS_PER_DAY) + 3) % 7) + 7) % 7; // 0 = Monday
      if (dow <= 4) {
        out.push(special(season, `s${season}-q${day}`, `Feature Qualifier (${division})`, "feature_qualifier", "listed", dayStart + 19 * MS_PER_HOUR + 90_000, PURSE_BY_TIER.listed, division, `q${day}`));
      } else if (dow === 5) {
        out.push(special(season, `s${season}-wf${week}`, `Weekend Feature (${division})`, "weekend_feature", "g1", dayStart + 19 * MS_PER_HOUR + 90_000, WEEKEND_FEATURE_PURSE, division, `wf${week}`));
      }
    }
  }
  const finalDay = start + (SEASON_DAYS - 1) * MS_PER_DAY;
  DIVISIONS.forEach((division, i) => {
    out.push(special(season, `s${season}-final-${division}`, `Season Final: ${division[0]!.toUpperCase()}${division.slice(1)} Championship`, "season_final", "g1", finalDay + 18 * MS_PER_HOUR + i * 30 * MS_PER_MINUTE + 90_000, SEASON_FINAL_PURSE, division, `final-${division}`));
  });
  return out.sort((a, b) => a.postTimeMs - b.postTimeMs);
}

/** Feature place: a top-3 finish in any qualifier this week (or OR ≥ 100 by right). */
export function featureQualified(qualifierFinishes: readonly number[], or: number): boolean {
  return or >= 100 || qualifierFinishes.some((p) => p >= 1 && p <= 3);
}
