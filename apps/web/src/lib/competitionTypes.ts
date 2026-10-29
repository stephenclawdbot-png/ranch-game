/**
 * Shapes for the competition and story screens (Daily Cup, leagues, Hall of Fame, Story
 * chapters). Types only: safe to import from client components.
 */
import type { Going, Horse, RaceReplay, RunningStyle, Silks, Surface, Weather } from "@thoroughbred/shared";
import type { Grade } from "./aptitude";

// ---------------------------------------------------------------------------
// Daily Cup
// ---------------------------------------------------------------------------

export interface CupConditions {
  name: string;
  distanceM: number;
  surface: Surface;
  going: Going;
  weather: Weather;
}

export interface CupFieldRunner {
  gate: number;
  name: string;
  style: RunningStyle;
  silks: Silks;
}

export type CupBadge = "gold" | "silver" | "bronze" | "top10" | "finisher";

export interface CupRow {
  rank: number;
  entryId: string;
  stableName: string;
  silks: Silks;
  horseName: string;
  timeUs: number;
  /** Place against the fixed Club field (1 = beat the whole field). */
  position: number;
  /** 0 = best, 1000 = worst. */
  percentile: number;
  badge: CupBadge;
  mine: boolean;
}

export interface CupHorseOption {
  id: string;
  name: string;
  style: RunningStyle;
  /** Form-guide fit for today's Cup conditions. */
  grade: Grade;
  loss: number;
  /** Why it can't run (null = it can). */
  block: string | null;
}

export interface CupView {
  day: string;
  opensAtMs: number;
  closesAtMs: number;
  serverNowMs: number;
  conditions: CupConditions;
  seedCommitment: string;
  field: CupFieldRunner[];
  entrants: number;
  participationCredits: number;
  board: { top: CupRow[]; near: CupRow[] };
  mine: CupRow | null;
  /** The viewer's horses (signed in, not yet run today). */
  horses: CupHorseOption[] | null;
  yesterday: { day: string; winner: CupRow | null; mine: CupRow | null; seed: string } | null;
}

export interface CupRunView {
  entryId: string;
  day: string;
  mine: boolean;
  horseName: string;
  stableName: string;
  conditions: CupConditions;
  timeUs: number;
  position: number;
  fieldSize: number;
  rank: number;
  of: number;
  percentile: number;
  badge: CupBadge;
  /** True while the day is open: the replay's seed is withheld until the Cup closes. */
  sealed: boolean;
  seedCommitment: string;
  replay: RaceReplay;
  entrantId: string;
}

// ---------------------------------------------------------------------------
// Leagues and seasons
// ---------------------------------------------------------------------------

export type LeagueZone = "promote" | "relegate" | null;

export interface LeagueRowView {
  rank: number;
  stableName: string;
  silks: Silks;
  points: number;
  wins: number;
  runs: number;
  bestFinish: number;
  mine: boolean;
  zone: LeagueZone;
}

export interface SeasonRowView {
  rank: number;
  stableName: string;
  silks: Silks;
  points: number;
  wins: number;
  runs: number;
  mine: boolean;
}

export interface CalendarRaceView {
  id: string;
  name: string;
  kind: "weekend_feature" | "feature_qualifier" | "season_final";
  postTimeMs: number;
  division: string | null;
  distanceM: number;
  surface: Surface;
}

export interface LeagueView {
  serverNowMs: number;
  weekStart: string;
  weekEndsAtMs: number;
  joined: boolean;
  tier: number;
  tierName: string;
  tierCount: number;
  group: number;
  capacity: number;
  promote: number;
  relegate: number;
  rows: LeagueRowView[];
  history: { weekStart: string; tierName: string; points: number; finalRank: number | null; movement: number | null }[];
  season: { number: number; startsAtMs: number; endsAtMs: number; owners: number; rows: SeasonRowView[]; mine: SeasonRowView | null };
  calendar: CalendarRaceView[];
  rules: { racePoints: number[]; startPoint: number; weeklyCap: number };
}

// ---------------------------------------------------------------------------
// Hall of Fame
// ---------------------------------------------------------------------------

export interface HallView {
  inducted: { key: string; category: string; title: string; horseId: string | null; stableName: string | null; season: number | null; atMs: number }[];
  records: { surface: Surface; distanceM: number; timeUs: number; horseId: string; horseName: string; stableName: string; raceId: string; atMs: number }[];
  champions: { horseId: string; name: string; stableName: string; liveWins: number; liveRuns: number; gradedWins: number; earnings: number; rating: number; retired: boolean }[];
  bloodlines: { horseId: string; name: string; sex: string; stableName: string; offspring: number; winners: number; wins: number }[];
  seasonWinners: { season: number; stableName: string; silks: Silks; points: number }[];
  mine: {
    stableName: string;
    achievements: { id: string; title: string; description: string; earned: boolean; earnedAtMs: number | null }[];
    titles: string[];
    rivals: { stableName: string; silks: Silks; closeFinishes: number; yourWins: number; lastAtMs: number }[];
  } | null;
}

// ---------------------------------------------------------------------------
// Trophy Room (the stable's own honours)
// ---------------------------------------------------------------------------

/** gold / silver / bronze cups for Live wins by class; rosettes for Story wins and places. */
export type TrophyTier = "gold" | "silver" | "bronze" | "first" | "second" | "third";

export interface TrophyView {
  raceId: string;
  raceName: string;
  horseId: string;
  horseName: string;
  position: number;
  atMs: number;
  prize: number;
  tier: TrophyTier;
}

export interface TrophyRoomView {
  stableName: string;
  silks: Silks;
  totals: { wins: number; places: number; cups: number; earnings: number };
  cups: TrophyView[];
  rosettes: TrophyView[];
  achievements: { id: string; title: string; description: string; earned: boolean; earnedAtMs: number | null }[];
  honours: { key: string; title: string; detail: string; atMs: number | null }[];
  stars: { horseId: string; name: string; appearance: Horse["appearance"]; wins: number; starts: number; earnings: number; status: "racing" | "stud" | "retired" | "deceased" }[];
}

// ---------------------------------------------------------------------------
// Story
// ---------------------------------------------------------------------------

export interface RivalStableView {
  id: string;
  name: string;
  trainer: string;
  personality: string;
  bio: string;
  greeting: string;
  silks: Silks;
  style: RunningStyle;
  debut: string;
  met: boolean;
  /** Story head-to-head: races where your runner finished ahead of all theirs / behind one of theirs. */
  record: { ahead: number; behind: number };
}

export interface StoryRaceView {
  key: string;
  order: number;
  name: string;
  track: string;
  distanceM: number;
  surface: Surface;
  going: Going;
  weather: Weather;
  raceClass: string;
  fieldSize: number;
  rivals: string[];
  intro: string;
  win: string;
  loss: string;
  won: boolean;
  firstWinReward: number;
  /** Your best-suited horse right now (null when none can race). */
  bestHorse: { id: string; name: string; grade: Grade; loss: number } | null;
}

export interface ChapterView {
  id: string;
  number: number;
  title: string;
  tagline: string;
  intro: string;
  outro: string;
  winsToComplete: number;
  wins: number;
  unlocked: boolean;
  complete: boolean;
  current: boolean;
  licenceRequired: { level: number; name: string };
  licenceEarned: { level: number; name: string; unlocks: string };
  earned: number;
  cap: number;
  races: StoryRaceView[];
}

export interface StoryView {
  licence: { level: number; name: string; unlocks: string[] };
  current: string;
  chapters: ChapterView[];
  rivals: RivalStableView[];
  recent: { raceId: string; name: string; raceKey: string | null; position: number; fieldSize: number; postTimeMs: number; horseName: string }[];
}

export interface StoryRaceCreated {
  raceId: string;
  postTimeMs: number;
  horseId: string;
  raceKey: string;
  pick?: { horseId: string; horseName: string; reason: string };
}
