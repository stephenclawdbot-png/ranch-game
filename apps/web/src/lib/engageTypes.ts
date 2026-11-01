/** GET /api/engage (types only: safe to import from client components). */

/** One "Tomorrow at your yard" line (game-core TomorrowLine). `atMs` is shown in local time. */
export interface TomorrowLineView {
  kind: string;
  text: string;
  href: string;
  atMs?: number;
}

/** A row of this week's table across every stable (League points; ties share a place). */
export interface WeekBoardRowView {
  rank: number;
  tied: boolean;
  stableName: string;
  points: number;
  wins: number;
  runs: number;
  /** Places up (+) or down (−) since the start of today (UTC); null on Monday or for a newcomer. */
  move: number | null;
  /** On the table for the first time today. */
  isNew: boolean;
  mine: boolean;
}

export interface WeekBoardView {
  top: WeekBoardRowView[];
  mine: WeekBoardRowView | null;
  stables: number;
  endsAtMs: number;
  /** Movement compares with the table at this instant (00:00 UTC today); null on the week's first day. */
  sinceMs: number | null;
}

/** This week's Saturday Feature, as a Home card (Thursday to Saturday evening) and the race page banner. */
export interface SaturdayFeatureCardView {
  name: string;
  postTimeMs: number;
  distanceM: number;
  surface: string;
  raceId: string | null;
  status: "upcoming" | "open" | "closed" | "off";
  maxRunners: number;
  entered: { horseName: string; stableName: string; mine: boolean }[];
  qualified: { horseName: string; stableName: string; mine: boolean; via: "qualifier" | "rating" }[];
  qualifiersLeft: number[];
  qualifyTop: number;
  ratingByRight: number;
}

export interface EngageView {
  serverNowMs: number;
  /** What will be new tomorrow (signed in only; empty when nothing is). */
  tomorrow: TomorrowLineView[];
  board: WeekBoardView;
  /** Null outside Thursday 00:00 UTC to a few hours after Saturday's off. */
  feature: SaturdayFeatureCardView | null;
}
