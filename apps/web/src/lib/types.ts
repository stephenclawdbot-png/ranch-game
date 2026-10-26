/**
 * Shapes the server sends to pages and the browser. Types only: safe to import from client
 * components (the server modules that build them never are).
 */
import type { Horse, RaceClass, RaceConfig, RunningStyle, Silks, Surface, Going, Weather } from "@thoroughbred/shared";

export type RaceKind = "live" | "story";
export type RideIntensity = "conservative" | "normal" | "all_out";

export interface RacePlan {
  tactic: RunningStyle;
  intensity: RideIntensity;
}

export interface FieldEntry {
  /** 0 until the gates are drawn at entry close. */
  gate: number;
  tactic: RunningStyle;
  horse: Horse;
  stableName: string;
  /** A player's horse (not a house horse). */
  isPlayer: boolean;
  /** The viewer's own horse. */
  mine: boolean;
}

export interface RaceCard {
  id: string;
  kind: RaceKind;
  config: RaceConfig;
  /** Sorted by gate once drawn (entry order before). Never includes the seed. */
  field: FieldEntry[];
  seedCommitment: string;
  /**
   * open: entries open; closed: field locked, waiting for the off; live: from post time
   * until the finish has been broadcast; finished: the result can be revealed.
   */
  status: "open" | "closed" | "live" | "finished";
  /** True once the field is locked (gates drawn, house horses filled). */
  fieldLocked: boolean;
  entriesCloseAtMs: number;
  /** Stable entries an entry costs (Live 1, Feature/Graded 2, Story 0). */
  entryCost: number;
  /** Field size the lock fills to with house horses, and the hard maximum. */
  targetRunners: number;
  maxRunners: number;
  engineVersion: string;
}

export interface RaceSummary {
  id: string;
  kind: RaceKind;
  name: string;
  distanceM: number;
  surface: Surface;
  going: Going;
  weather: Weather;
  raceClass: RaceClass;
  purse: number;
  postTimeMs: number;
  entriesCloseAtMs: number;
  entryCost: number;
  /** Entered so far (open) or the locked field size. */
  fieldSize: number;
  targetRunners: number;
  phase: "open" | "closed" | "live" | "finished";
  /** The viewer's horses entered in this race. */
  mine: number;
  /** When the result became official. Only present once finished. */
  endsAtMs?: number;
  /** Only present once the race has finished on the broadcast clock. */
  winner?: { horseId: string; name: string; stableName: string; timeUs: number };
}

export interface RiskView {
  permille: number;
  label: "low" | "moderate" | "elevated" | "high";
  careerEndingShare: number;
  factors: string[];
}

export interface StableHorse {
  id: string;
  /** Shared Horse (current stats, appearance in the stable's silks). */
  horse: Horse;
  stage: string;
  careerStatus: "racing" | "retired" | "pasture";
  starts: number;
  maxStarts: number;
  /** Official rating (0-140). */
  rating: number;
  /** 0 (fresh) .. 1000 (spent), recovering in real time. */
  fatigue: number;
  /** Freshness bar 0..1000 for display. */
  freshness: number;
  condition: "fresh" | "ok" | "tired";
  injury: { severity: string; untilMs: number | null } | null;
  /** Race the horse is entered in (locked), if any. */
  lockedRaceId: string | null;
  ranToday: number;
  /** Why the horse can't race right now (null = can race). */
  block: string | null;
  /** Injury risk for a normal ride at its best trip on good going. */
  risk: RiskView;
}

export interface ActiveEntry {
  raceId: string;
  raceName: string;
  kind: RaceKind;
  horseId: string;
  horseName: string;
  postTimeMs: number;
  status: string;
}

export interface InboxView {
  id: string;
  kind: string;
  raceId: string | null;
  horseId: string | null;
  /** Only once read: the title can name the finishing position. */
  title: string | null;
  createdAtMs: number;
  read: boolean;
  data: Record<string, unknown> | null;
}

export interface RunView {
  raceId: string;
  raceName: string;
  kind: RaceKind;
  horseId: string;
  horseName?: string;
  position: number;
  fieldSize: number;
  prize: number;
  postTimeMs: number;
  distanceM: number;
  surface: Surface;
  ratingBefore: number;
  ratingAfter: number | null;
}

export interface EntryBankView {
  balance: number;
  cap: number;
  allowance: number;
  refillAvailable: boolean;
  refillPrice: number;
}

export interface PlayerView {
  accountId: string;
  stableName: string;
  silks: Silks;
  credits: number;
  entries: EntryBankView;
  stalls: { slots: number; used: number };
  horses: StableHorse[];
  active: ActiveEntry[];
  inbox: InboxView[];
  runs: RunView[];
  /** Closed playtest: this stable belongs to an invited tester (see /beta). */
  tester: boolean;
  serverNowMs: number;
}

export interface HorseDetailView {
  horse: Horse;
  kind: "player" | "house";
  stableName: string;
  trainer: string | null;
  mine: boolean;
  /** Present for the owner's own horses. */
  status: StableHorse | null;
  runs: RunView[];
  pedigree: { sire: { id: string; name: string } | null; dam: { id: string; name: string } | null };
  /** Standing at public stud (a player's stallion or a Club house stallion). */
  stud: { fee: number; club: boolean } | null;
  /** The owner's next steps beyond racing (null for other stables' horses). */
  actions: { cover: boolean; stud: boolean; sell: boolean } | null;
}

/** The viewer's own result in a race (only after the broadcast is over). */
export interface MyRaceResult {
  raceId: string;
  settled: boolean;
  /** True the first time the owner sees this result (its inbox item was unread): stage the reveal. */
  firstView: boolean;
  runners: { horseId: string; horseName: string; position: number; prize: number; storyReward: number; firstWin: boolean; ratingBefore: number; ratingAfter: number | null }[];
}

export interface ApiError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}
