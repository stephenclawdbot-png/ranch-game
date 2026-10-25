/**
 * Weekly owner leagues: groups of up to 30 owners per tier, points from the week's racing,
 * promotion and relegation at the week's end. The core status hook — relative boards keep
 * everyone motivated (design-research §8.5). Ranked rewards are cosmetic and need a verified
 * account; an owner who did not race simply stays put (no relegation for being away).
 */
import type { League, LeagueMember, LeagueTier } from "./types";
import { LeagueTierSchema } from "./types";
import { Rng, seedFrom } from "./rng";

export const LEAGUE_SIZE = 30;
export const PROMOTE = 5;
export const RELEGATE = 5;
export const LEAGUE_TIERS: readonly LeagueTier[] = LeagueTierSchema.options;

/** Points per finishing position in a rated race (field ≥ 4), plus a start point. */
export const RACE_POINTS = [12, 8, 6, 4, 3, 2] as const;
export const START_POINT = 1;
/** Per-week points cap so volume alone can't win a league. */
export const WEEKLY_RACE_POINTS_CAP = 240;

export function racePoints(position: number, fieldSize: number, tierBonus = 0): number {
  if (fieldSize < 4) return START_POINT;
  return START_POINT + (RACE_POINTS[position - 1] ?? 0) + tierBonus;
}

/** Graded / feature races are worth more. */
export function tierBonus(tier: string, position: number): number {
  if (position > 3) return 0;
  if (tier === "g1") return 10;
  if (tier === "g2") return 6;
  if (tier === "g3" || tier === "listed") return 3;
  return 0;
}

/** Group owners of one tier into leagues of ≤30, seeded shuffle so groups are fair and stable. */
export function formLeagues(week: number, tier: LeagueTier, ownerIds: readonly string[]): League[] {
  const rng = new Rng(seedFrom("league", week, tier));
  const ids = [...ownerIds].sort();
  for (let i = ids.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  const groups = Math.max(1, Math.ceil(ids.length / LEAGUE_SIZE));
  const out: League[] = [];
  for (let g = 0; g < groups; g++) {
    const members: LeagueMember[] = ids.filter((_, i) => i % groups === g).map((ownerId) => ({ ownerId, points: 0, wins: 0, bestFinish: 0 }));
    out.push({ id: `w${week}-${tier}-${g}`, week, tier, members });
  }
  return out;
}

export function addPoints(league: League, ownerId: string, points: number, win: boolean, finish: number): League {
  return {
    ...league,
    members: league.members.map((m) =>
      m.ownerId === ownerId
        ? {
            ...m,
            points: Math.min(WEEKLY_RACE_POINTS_CAP, m.points + Math.max(0, points)),
            wins: m.wins + (win ? 1 : 0),
            bestFinish: m.bestFinish === 0 ? finish : Math.min(m.bestFinish, finish),
          }
        : m,
    ),
  };
}

export function standings(league: League): LeagueMember[] {
  return [...league.members].sort((a, b) => b.points - a.points || b.wins - a.wins || (a.bestFinish || 99) - (b.bestFinish || 99) || (a.ownerId < b.ownerId ? -1 : 1));
}

export interface LeagueMove {
  ownerId: string;
  from: LeagueTier;
  to: LeagueTier;
  rank: number;
  outcome: "promoted" | "relegated" | "stayed";
}

/**
 * End-of-week moves: top 5 (with points) go up, bottom 5 among those who raced go down.
 * Owners with 0 points never move down: being away is never punished.
 */
export function settleLeague(league: League): LeagueMove[] {
  const t = LEAGUE_TIERS.indexOf(league.tier);
  const table = standings(league);
  const active = table.filter((m) => m.points > 0);
  const relegated = new Set(t > 0 && active.length > PROMOTE + RELEGATE ? active.slice(-RELEGATE).map((m) => m.ownerId) : []);
  return table.map((m, i) => {
    const promote = i < PROMOTE && m.points > 0 && t < LEAGUE_TIERS.length - 1;
    const down = relegated.has(m.ownerId);
    const to = promote ? LEAGUE_TIERS[t + 1]! : down ? LEAGUE_TIERS[t - 1]! : league.tier;
    return { ownerId: m.ownerId, from: league.tier, to, rank: i + 1, outcome: promote ? "promoted" : down ? "relegated" : "stayed" };
  });
}
