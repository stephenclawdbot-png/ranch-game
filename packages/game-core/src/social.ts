/**
 * Status systems: achievements, Hall of Fame criteria and rivalry detection.
 */
import type { HorseState } from "./types";
import { overallPotential, gradeOf } from "./genome";
import { HORSE_LENGTH_MM } from "@thoroughbred/shared";

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

export interface OwnerStats {
  races: number;
  wins: number;
  gradedWins: number;
  g1Wins: number;
  photoFinishWins: number;
  foalsBred: number;
  bestBredGrade: "E" | "D" | "C" | "B" | "A" | "S" | null;
  cupTop10: number;
  cupRuns: number;
  leaguePromotions: number;
  seasonFinalWins: number;
  hallOfFame: number;
  careDays: number;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  test: (s: OwnerStats) => boolean;
}

const gradeRank = (g: OwnerStats["bestBredGrade"]) => (g ? ["E", "D", "C", "B", "A", "S"].indexOf(g) : -1);

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: "first_race", title: "Off and Running", description: "Run your first race.", test: (s) => s.races >= 1 },
  { id: "first_win", title: "Winner's Enclosure", description: "Win a race.", test: (s) => s.wins >= 1 },
  { id: "ten_wins", title: "Proven Yard", description: "Win 10 races.", test: (s) => s.wins >= 10 },
  { id: "photo_win", title: "By a Nose", description: "Win a photo finish.", test: (s) => s.photoFinishWins >= 1 },
  { id: "graded_win", title: "Group Winner", description: "Win a Group race.", test: (s) => s.gradedWins >= 1 },
  { id: "g1_win", title: "Top Level", description: "Win a Group 1.", test: (s) => s.g1Wins >= 1 },
  { id: "first_foal", title: "New Arrival", description: "Breed your first foal.", test: (s) => s.foalsBred >= 1 },
  { id: "bred_b", title: "Rising Line", description: "Breed a B-grade horse.", test: (s) => gradeRank(s.bestBredGrade) >= 3 },
  { id: "bred_a", title: "Elite Bloodline", description: "Breed an A-grade horse.", test: (s) => gradeRank(s.bestBredGrade) >= 4 },
  { id: "bred_s", title: "Living Legend", description: "Breed an S-grade horse.", test: (s) => gradeRank(s.bestBredGrade) >= 5 },
  { id: "cup_regular", title: "Cup Regular", description: "Take 20 Cup Runs (any days, no streak needed).", test: (s) => s.cupRuns >= 20 },
  { id: "cup_top10", title: "Cup Contender", description: "Finish in the Daily Cup top 10%.", test: (s) => s.cupTop10 >= 1 },
  { id: "promoted", title: "Moving Up", description: "Win promotion in your league.", test: (s) => s.leaguePromotions >= 1 },
  { id: "final_win", title: "Season Champion", description: "Win a Season Final.", test: (s) => s.seasonFinalWins >= 1 },
  { id: "hall_of_fame", title: "Immortal", description: "Have a horse inducted into the Hall of Fame.", test: (s) => s.hallOfFame >= 1 },
  { id: "carer", title: "Good Hands", description: "Give 30 days of care (any days).", test: (s) => s.careDays >= 30 },
];

export function unlockedAchievements(s: OwnerStats, already: ReadonlySet<string> = new Set()): Achievement[] {
  return ACHIEVEMENTS.filter((a) => !already.has(a.id) && a.test(s));
}

// ---------------------------------------------------------------------------
// Hall of Fame
// ---------------------------------------------------------------------------

export interface HorseHonours {
  g1Wins: number;
  gradedWins: number;
  seasonFinalWins: number;
  weekendFeatureWins: number;
  recordTimes: number;
  /** Graded-race winners among its offspring. */
  gradedWinnerOffspring: number;
}

export type HallOfFameReason = "champion" | "season_winner" | "record_time" | "great_racehorse" | "foundation_sire" | "foundation_mare" | "elite_genetics";

/** Hall of Fame criteria. Entries are permanent. */
export function hallOfFameReasons(h: HorseState, honours: HorseHonours): HallOfFameReason[] {
  const out: HallOfFameReason[] = [];
  if (honours.g1Wins >= 2 || (honours.g1Wins >= 1 && honours.gradedWins >= 4)) out.push("champion");
  if (honours.seasonFinalWins >= 1) out.push("season_winner");
  if (honours.recordTimes >= 1) out.push("record_time");
  if (h.rating.peakOr >= 115 || (h.record.starts >= 20 && h.record.wins >= 10)) out.push("great_racehorse");
  if (honours.gradedWinnerOffspring >= 3) out.push(h.sex === "filly" || h.sex === "mare" ? "foundation_mare" : "foundation_sire");
  if (gradeOf(overallPotential(h.genome)) === "S") out.push("elite_genetics");
  return out;
}

// ---------------------------------------------------------------------------
// Rivalries
// ---------------------------------------------------------------------------

export interface RaceFinishLite {
  raceId: string;
  atMs: number;
  finishers: { ownerId: string; position: number; marginMm: number }[];
}

export interface Rivalry {
  owners: [string, string];
  closeFinishes: number;
  /** Close finishes won by owners[0]. */
  aWins: number;
  lastAtMs: number;
}

/** A close finish: adjacent positions within this margin. */
export const RIVAL_MARGIN_MM = HORSE_LENGTH_MM;
export const RIVAL_MIN_CLOSE = 3;

/**
 * Detect rivalries: owner pairs with at least 3 close finishes (adjacent positions, ≤ 1 length
 * apart) against each other across the given races. Club runners are ignored.
 */
export function detectRivalries(races: readonly RaceFinishLite[], ignoreOwners: ReadonlySet<string> = new Set(["club"])): Rivalry[] {
  const map = new Map<string, Rivalry>();
  for (const r of races) {
    const fs = [...r.finishers].sort((a, b) => a.position - b.position);
    for (let i = 1; i < fs.length; i++) {
      const ahead = fs[i - 1]!;
      const behind = fs[i]!;
      if (ahead.ownerId === behind.ownerId || ignoreOwners.has(ahead.ownerId) || ignoreOwners.has(behind.ownerId)) continue;
      if (behind.marginMm > RIVAL_MARGIN_MM) continue;
      const [a, b] = ahead.ownerId < behind.ownerId ? [ahead.ownerId, behind.ownerId] : [behind.ownerId, ahead.ownerId];
      const key = `${a}|${b}`;
      const cur = map.get(key) ?? { owners: [a, b] as [string, string], closeFinishes: 0, aWins: 0, lastAtMs: 0 };
      cur.closeFinishes++;
      if (ahead.ownerId === a) cur.aWins++;
      cur.lastAtMs = Math.max(cur.lastAtMs, r.atMs);
      map.set(key, cur);
    }
  }
  return [...map.values()].filter((r) => r.closeFinishes >= RIVAL_MIN_CLOSE).sort((x, y) => y.closeFinishes - x.closeFinishes || y.lastAtMs - x.lastAtMs);
}
