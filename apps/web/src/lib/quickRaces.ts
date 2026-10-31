/**
 * Quick races (the fast layer): the shapes the hub, the API and the server share (client-safe).
 *
 *   Match race       one of your racing horses against up to three other stables' racing horses,
 *                    on a course, trip and going you pick, with a fresh random seed.
 *   Ghost race       your horse against the first three home in a settled Live race (as they
 *                    locked), on that race's course, trip and going, with a fresh random seed.
 *   Daily challenge  one puzzle a UTC day for everyone: a Club horse, a fixed field and conditions;
 *                    you choose only the tactic, the riding intensity and a rider grade.
 *
 * All three are unofficial: no rating, fatigue, injury, credits, form, records, leagues, jockey
 * stats, tote or picks. Knobs live in game-core (quickRaces.ts).
 */
import { z } from "zod";
import { ordinal } from "./format";
import type { Going, HorseAppearance as Appearance, RunningStyle, Silks, Surface, Weather } from "@thoroughbred/shared";

export type QuickMode = "match" | "ghost" | "daily";
export type JockeyGrade = "A" | "B" | "C" | "D" | "E";
export type Intensity = "conservative" | "normal" | "all_out";

/** The stage badge of each mode (the viewer shows it in capitals). */
export const QUICK_BADGE: Record<QuickMode, string> = {
  match: "Match race · unofficial",
  ghost: "Ghost race · unofficial",
  daily: "Daily challenge",
};

export const QUICK_MODE_LABEL: Record<QuickMode, string> = { match: "Match race", ghost: "Ghost race", daily: "Daily challenge" };

const Style = z.enum(["front", "stalker", "closer"]);
const Uuid = z.string().uuid();

export const MatchRequestSchema = z.object({
  horseId: Uuid,
  opponentIds: z.array(Uuid).min(1).max(3),
  courseId: z.string().min(1).max(40),
  distanceM: z.number().int().positive(),
  surface: z.enum(["turf", "dirt", "synthetic"]),
  going: z.enum(["firm", "good", "soft", "heavy"]),
  tactic: Style.optional(),
});
export type MatchRequest = z.infer<typeof MatchRequestSchema>;

export const GhostRequestSchema = z.object({ horseId: Uuid, raceId: Uuid, tactic: Style.optional() });
export type GhostRequest = z.infer<typeof GhostRequestSchema>;

export const DailyRequestSchema = z.object({
  tactic: Style,
  intensity: z.enum(["conservative", "normal", "all_out"]),
  grade: z.enum(["A", "B", "C", "D", "E"]),
});
export type DailyRequest = z.infer<typeof DailyRequestSchema>;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface QuickHorse {
  id: string;
  name: string;
  appearance: Appearance;
  /** Its natural running style (the default tactic). */
  style: RunningStyle;
  stableId: string;
  stableName: string;
  silks: Silks;
  rating: number | null;
  /** Best trip, metres. */
  bestTripM: number;
  surface: Surface;
}

export interface QuickCourse {
  id: string;
  name: string;
  surfaces: Surface[];
  character: string;
}

export interface GhostSourceView {
  raceId: string;
  name: string;
  track: string;
  distanceM: number;
  surface: Surface;
  going: Going;
  postTimeMs: number;
  runners: number;
  top: { horseId: string; name: string; position: number }[];
}

export interface QuickListItem {
  id: string;
  mode: QuickMode;
  title: string;
  /** "2nd of 4", or "You'd have been 2nd" for a ghost race. */
  line: string;
  position: number;
  createdAtMs: number;
}

export interface DailyBoardLine {
  rank: number;
  stableName: string;
  silks: Silks;
  position: number;
  timeUs: number;
  points: number;
  top: boolean;
  mine: boolean;
  /** The plan, shown once the day is over (before then it would give the puzzle away). */
  plan: DailyRequest | null;
  quickRaceId: string | null;
}

export interface DailyView {
  day: number;
  /** YYYY-MM-DD (UTC). */
  date: string;
  name: string;
  opensAtMs: number;
  closesAtMs: number;
  course: { id: string; name: string; character: string };
  distanceM: number;
  surface: Surface;
  going: Going;
  weather: Weather;
  horse: { id: string; name: string; appearance: Appearance; style: RunningStyle; bestTripM: number; surface: Surface; stats: Record<string, number> };
  gate: number;
  rivals: { gate: number; name: string; tactic: RunningStyle; appearance: Appearance }[];
  /** sha256 of the day's seed, published with the puzzle; the seed itself only after the day. */
  seedCommitment: string;
  /** lb the horse carries with each rider grade (a better rider costs weight). */
  weights: Record<JockeyGrade, number>;
  mine: { quickRaceId: string; position: number; rank: number; points: number; top: boolean; plan: DailyRequest } | null;
  entrants: number;
  board: DailyBoardLine[];
  streak: { current: number; best: number };
  points: number;
  badges: number;
  yesterday: { date: string; seed: string; seedCommitment: string; entrants: number; mine: { rank: number; position: number; top: boolean; quickRaceId: string } | null } | null;
}

export interface QuickHubView {
  serverNowMs: number;
  signedIn: boolean;
  horses: QuickHorse[];
  courses: QuickCourse[];
  trips: number[];
  goings: Going[];
  match: { remaining: number; perDay: number; fieldMax: number };
  ghost: { remaining: number; perDay: number; top: number; sources: GhostSourceView[] };
  daily: DailyView;
  recent: QuickListItem[];
  /** Today's batched note: your horses that beat challengers. */
  notes: { title: string; atMs: number; lines: { winner: string; challenger: string; quickRaceId: string }[] }[];
}

export interface QuickRunnerRow {
  position: number;
  horseId: string;
  name: string;
  stableName: string | null;
  mine: boolean;
  behindMm: number;
  timeUs: number;
  /** Ghost races: where it finished in the real race. */
  officialPosition?: number;
}

export interface QuickRaceView {
  id: string;
  mode: QuickMode;
  badge: string;
  title: string;
  raceName: string;
  track: string;
  distanceM: number;
  surface: Surface;
  going: Going;
  createdAtMs: number;
  /** The viewer's stable ran it. */
  yours: boolean;
  /** The runner to follow (the challenger, your horse, the Club horse). */
  horseId: string;
  horseName: string;
  stableName: string;
  position: number;
  fieldSize: number;
  rows: QuickRunnerRow[];
  /** One plain line on the outcome ("Paper Moon beat Copper Comet by a neck"). */
  headline: string;
  match?: { records: { opponentId: string; opponentName: string; won: number; lost: number; meetings: number }[] };
  ghost?: { sourceRaceId: string; sourceName: string; line: string };
  daily?: {
    day: number;
    date: string;
    plan: DailyRequest;
    points: number;
    rank: number;
    entrants: number;
    top: boolean;
    seedCommitment: string;
    /** Revealed once the day is over (null before). */
    seed: string | null;
    closesAtMs: number;
  };
  /** Plain words for what this was (never official). */
  note: string;
}

export interface MatchOpponent {
  id: string;
  name: string;
  stableName: string;
  silks: Silks;
  appearance: Appearance;
  rating: number | null;
  style: RunningStyle;
}

/** "You'd have finished 2nd" against the first `top` home of a real race (position among them + you). */
export function ghostLine(position: number, top: number): string {
  if (position <= top) return `You'd have finished ${ordinal(position)}`;
  return `You'd have finished outside the first ${top}`;
}

export const GRADE_WORD = (g: JockeyGrade) => `${g === "A" || g === "E" ? "an" : "a"} ${g}-grade rider`;
