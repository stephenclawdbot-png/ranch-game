/**
 * Pick the winner (go-to-market 2026-10-31): before a Live card race goes off, any player may
 * pick one runner to win. Points only: nothing is staked, nothing is paid, and points can never
 * be exchanged for anything (no credits, no USDG, no prizes of value).
 *
 *   - the window: from the card's publication to the off (post time), on the declared field
 *     (entries close 30 s before the off, so the final field is known too briefly to be the only
 *     window); a pick on a runner that doesn't run (scratched, race called off) is void;
 *   - the score: a public, rule-based estimate of how unlikely the pick was, the runner's rank by
 *     official rating within the final field (a rule, nothing quoted): the top-rated winner scores
 *     PICK_POINTS_TOP, the lowest-rated PICK_POINTS_OUTSIDER, linearly between;
 *   - the tipster table: points per UTC week (Monday to Monday), the weekly top
 *     TIPSTER_BADGE_TOP get a badge; all-time best week and the best run of winning picks.
 *
 * Pure and integer-only; the database scores picks only once the race's result is public.
 */

/** Points for picking the winner when it was the top-rated runner in the field. */
export const PICK_POINTS_TOP = 10;
/** Points for picking the winner when it was the lowest-rated runner in the field. */
export const PICK_POINTS_OUTSIDER = 50;
/** The weekly tipster table's top this many (with points) get the week's badge. */
export const TIPSTER_BADGE_TOP = 10;
/** The Tipsters page lists this many tipsters per table. */
export const TIPSTER_TABLE_SHOWN = 50;
/**
 * Bring a rival: one-time welcome credits for both the inviter and the invited stable when a
 * friend founds a stable through a rival invite link (once per invited account; refused when the
 * two accounts are linked: same device, wallet, email ...). Kind `rival_invite`.
 */
export const RIVAL_INVITE_CREDITS = 300;
/**
 * The inviter's side of the welcome is paid for at most this many rival invites per UTC week
 * (anti-farming); beyond it the rivalry still forms and the invited stable still gets its welcome.
 */
export const RIVAL_INVITE_WEEKLY_WELCOMES = 5;

const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

export interface PickRunner {
  horseId: string;
  /** Official rating at entry (the racecard's OR). */
  rating: number;
}

/** Rank by rating within the field, 1 = top-rated; equal ratings share the better rank (1, 2, 2, 4). */
export function ratingRanks(field: readonly PickRunner[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of field) out.set(r.horseId, 1 + field.filter((o) => o.rating > r.rating).length);
  return out;
}

/** Points for a winning pick ranked `rank` of `fieldSize` (10 for the top-rated, up to 50 for the lowest-rated). */
export function pickPoints(rank: number, fieldSize: number): number {
  if (fieldSize <= 1) return PICK_POINTS_TOP;
  const r = Math.max(1, Math.min(fieldSize, Math.floor(rank)));
  return PICK_POINTS_TOP + Math.floor(((PICK_POINTS_OUTSIDER - PICK_POINTS_TOP) * (r - 1)) / (fieldSize - 1));
}

export type PickOutcome = "won" | "lost" | "void";

export interface ScoredPick {
  outcome: PickOutcome;
  points: number;
  /** The pick's rank by rating in the final field (null when void). */
  rank: number | null;
  fieldSize: number;
}

/**
 * Scores one pick against the final field and the result. Void when the race didn't run or the
 * picked runner wasn't in the final field. A dead heat for first counts every horse placed 1st.
 */
export function scorePick(input: { horseId: string; field: readonly PickRunner[]; winners: readonly string[]; ran: boolean }): ScoredPick {
  const fieldSize = input.field.length;
  const rank = ratingRanks(input.field).get(input.horseId);
  if (!input.ran || rank === undefined) return { outcome: "void", points: 0, rank: null, fieldSize };
  if (!input.winners.includes(input.horseId)) return { outcome: "lost", points: 0, rank, fieldSize };
  return { outcome: "won", points: pickPoints(rank, fieldSize), rank, fieldSize };
}

/** Picks open while the race hasn't gone off: not called off, and before post time. */
export function pickWindowOpen(race: { status: string; postTimeMs: number }, nowMs: number): boolean {
  return (race.status === "open" || race.status === "locked") && nowMs < race.postTimeMs;
}

/** Start (ms) of the UTC week (Monday 00:00) holding `ms`: the tipster table resets then. */
export function tipsterWeekStartMs(ms: number): number {
  const day = Math.floor(ms / DAY_MS);
  const dow = (((day + 3) % 7) + 7) % 7; // 1970-01-01 was a Thursday; 0 = Monday
  return (day - dow) * DAY_MS;
}

/** The current and best runs of winning picks (oldest first; void picks don't break a run). */
export function pickStreaks(outcomes: readonly PickOutcome[]): { current: number; best: number } {
  let current = 0;
  let best = 0;
  for (const o of outcomes) {
    if (o === "void") continue;
    current = o === "won" ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return { current, best };
}

export interface TipsterTotal {
  stableId: string;
  points: number;
  wins: number;
  picks: number;
}

export interface TipsterRow extends TipsterTotal {
  position: number;
  /** In the week's top TIPSTER_BADGE_TOP with points. */
  badge: boolean;
}

/** Orders a table: points, then winners, then fewer picks (a sharper eye), then a stable tie-break; equal scores share a position. */
export function rankTipsters(rows: readonly TipsterTotal[]): TipsterRow[] {
  const sorted = [...rows].sort((a, b) => b.points - a.points || b.wins - a.wins || a.picks - b.picks || (a.stableId < b.stableId ? -1 : a.stableId > b.stableId ? 1 : 0));
  const out: TipsterRow[] = [];
  for (const [i, r] of sorted.entries()) {
    const prev = out[i - 1];
    const tied = prev && prev.points === r.points && prev.wins === r.wins && prev.picks === r.picks;
    const position = tied ? prev.position : i + 1;
    out.push({ ...r, position, badge: r.points > 0 && position <= TIPSTER_BADGE_TOP });
  }
  return out;
}
