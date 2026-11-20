/**
 * The "beta" population (HARNESS_SCENARIO=beta): the shape of the real first week (112 testers,
 * 12-38 playing a day, 2026-11), where the standard season run assumes 50 stables that all play
 * every day. Used to tune what a thin population sees: the Live card above all.
 *
 *   - Sign-ups arrive over the first two days (BETA_DAY1_PERMILLE on day 1, the rest on day 2),
 *     between 06:00 and 24:00 UTC. A stable is founded when its player arrives, through the same
 *     path as everyone else (foundStable), so its starters are the game's own (rated about 40).
 *   - Most leave at once: BETA_LIFETIMES gives how long each sign-up keeps playing. About 30% come
 *     back after the first day, about a quarter of the day-1 sign-ups play on day 2, and 10-15
 *     stables are still playing every day after a week.
 *   - Nearly all are casual (one evening visit, skipping one day in five); BETA_ENGAGED of the
 *     ones who stay play like the season run's grinders. Some never enter a Live race
 *     (BETA_STORY_ONLY_PERMILLE: care, the Daily Cup and Story mode only).
 *
 * Everything is drawn from the run's seed, one stream per sign-up.
 */
import * as gc from "@thoroughbred/game-core";
import type { Cohort } from "./config";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Share of sign-ups that arrive on the first day (permille); the rest arrive on the second. */
export const BETA_DAY1_PERMILLE = 700;
/**
 * How long a sign-up keeps playing, as [permille of sign-ups, first day it may quit after, last].
 * Days are counted from the sign-up day (1 = only that day); null = stays for the whole run.
 */
export const BETA_LIFETIMES: readonly (readonly [number, number, number] | readonly [number, null, null])[] = [
  [700, 1, 1],
  [100, 2, 4],
  [60, 5, 10],
  [140, null, null],
];
/** Stayers that play like grinders (several visits a day, every horse entered), as a count per 100 sign-ups. */
export const BETA_ENGAGED_PER_100 = 4;
/** Chance (permille) that a casual sign-up never enters a Live race: one-day players, and the rest. */
export const BETA_STORY_ONLY_PERMILLE = { oneDay: 300, returning: 150 } as const;
/** A returning casual skips this share of days (permille). */
export const BETA_SKIP_PERMILLE = 200;

export interface BetaSignUp {
  index: number;
  cohort: Cohort;
  /** When the player arrives and founds the stable. */
  joinMs: number;
  /** Start of the first UTC day the player no longer plays (null: stays to the end). */
  quitMs: number | null;
  storyOnly: boolean;
  skipPermille: number;
}

/** The run's sign-ups in arrival order. */
export function betaSignUps(seed: string, startMs: number, total: number): BetaSignUp[] {
  const dayStart = Math.floor(startMs / DAY) * DAY;
  const out: BetaSignUp[] = [];
  for (let i = 0; i < total; i++) {
    const rng = new gc.Rng(gc.seedFrom("season-harness", seed, "beta", i));
    const day = rng.chance(BETA_DAY1_PERMILLE) ? 0 : 1;
    const joinMs = Math.max(startMs + 60_000, dayStart + day * DAY + 6 * HOUR + rng.int(18 * 60) * 60_000);
    let roll = rng.int(1000);
    let life: (typeof BETA_LIFETIMES)[number] = BETA_LIFETIMES[BETA_LIFETIMES.length - 1]!;
    for (const l of BETA_LIFETIMES) {
      if (roll < l[0]) {
        life = l;
        break;
      }
      roll -= l[0];
    }
    const playDays = life[1] === null ? null : life[1] + rng.int(life[2] - life[1] + 1);
    const joinDay = Math.floor(joinMs / DAY) * DAY;
    const oneDay = playDays === 1;
    out.push({
      index: i,
      cohort: "casual",
      joinMs,
      quitMs: playDays === null ? null : joinDay + playDays * DAY,
      storyOnly: rng.chance(oneDay ? BETA_STORY_ONLY_PERMILLE.oneDay : BETA_STORY_ONLY_PERMILLE.returning),
      skipPermille: BETA_SKIP_PERMILLE,
    });
  }
  // The engaged few: the first stayers by index (the seed decides who stays).
  let engaged = Math.round((total * BETA_ENGAGED_PER_100) / 100);
  for (const s of out) {
    if (engaged <= 0) break;
    if (s.quitMs !== null) continue;
    s.cohort = "grinder";
    s.storyOnly = false;
    s.skipPermille = 0;
    engaged--;
  }
  return out.sort((a, b) => a.joinMs - b.joinMs || a.index - b.index);
}
