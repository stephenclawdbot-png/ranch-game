/**
 * Shapes the server sends to pages and the browser. Types only: safe to import from client
 * components (the server modules that build them never are).
 */
import type { Horse, RaceClass, RaceConfig, RunningStyle, Silks, Surface, Going, Weather } from "@thoroughbred/shared";
import type { GeneticsSummary, JockeyKey, RaceExtraKey } from "@thoroughbred/game-core";

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
  /** The player stable's photo (null: show the silks). */
  stablePhotoUrl?: string | null;
  /** The viewer's own horse. */
  mine: boolean;
  /** Racecard form figures, oldest -> newest ("3-1-2"; 0 = unplaced beyond 9), null if unraced. */
  form: string | null;
  /** Official rating at entry. */
  rating: number | null;
  /** Handicap weight carried, lb (Live handicaps, set when the field locks); null at level weights or before the lock. */
  weightLb?: number | null;
  /** Race-day equipment and a hired jockey, as racecard tags ("Soft shoes", "Vet-checked", "Top jockey"); empty for none. */
  gear: string[];
  /** Who rides (Live races): frozen at the lock, or the booked jockey before it; null when unknown. */
  jockey?: RunnerJockey | null;
  /** Claiming races: the runner's claim price and the number of claims lodged on it (never who). */
  claim?: { price: number; claims: number } | null;
  /** The runner's stable (null for a Club horse): its public page is /stables/<id>. */
  stableId?: string | null;
  /** The viewer's rival stable's runner, or the viewer's nemesis horse (from public results only). */
  rival?: "rival" | "nemesis" | null;
}

/** A claim's state (services/claiming.ts): lodged → drawn / lost at the lock → claimed / void after the race; refunded on a scratch or abandoned race. */
export type ClaimStatus = "lodged" | "drawn" | "lost" | "claimed" | "void" | "refunded";

/** One jockey the entry sheet offers: the stable's own (free) or a Club freelancer (a fee by grade and purse). */
export interface RiderOption {
  id: string;
  name: string;
  /** Racecard name with any apprentice claim ("T. Ashby (5)"). */
  cardName: string;
  grade: "A" | "B" | "C" | "D" | "E";
  stage: "apprentice" | "prime" | "veteran";
  own: boolean;
  fee: number;
  /** Null when free to ride; otherwise why not ("Booked within 10 minutes"). */
  busy: string | null;
}

/** Race-day extras and jockeys on offer for one race, priced in credits (entry sheet). */
export interface RaceDayOffer {
  extras: { key: RaceExtraKey; label: string; tag: string; effect: string; price: number }[];
  /** Legacy jockey tiers; empty since named jockeys (`riders`) replaced them. */
  jockeys: { key: JockeyKey; label: string; effect: string; price: number }[];
  /** Live races: your jockeys (free) and Club freelancers (a fee); `defaultId` = your best free jockey. */
  riders?: { own: RiderOption[]; freelancers: RiderOption[]; defaultId: string | null };
}

/** The jockey on a racecard runner (frozen at the lock, or booked before it). */
export interface RunnerJockey {
  /** Null for an unnamed rider (a Club rider when no freelancer was free, or an old jockey tier). */
  id: string | null;
  name: string;
  /** "T. Ashby (5)": the claim shows only where it comes off a handicap weight. */
  cardName: string;
  claimLb: number;
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
  /** The course the race runs with (course character, engine 1.3.0), or null when it runs course-less. */
  course?: { name: string; character: string } | null;
  /** The stable that sponsored this race (its silks go on the racecard header). */
  sponsor?: RaceSponsorView;
  /** How the ground is moving into race day at its course (game-core climate.ts); null when unknown. */
  groundTrend?: "drying" | "softening" | "steady" | null;
  /** Racecourse name (`conditions.track`; game-core `courseByName` maps it to its course). */
  track?: string;
  /** A claiming race: the rules in one line and the viewer's own claim (if any). */
  claiming?: { rules: string; myClaim: { horseId: string; price: number; status: ClaimStatus } | null };
}

/** A race's sponsor as the card shows it ("Sponsor a race"). */
export interface RaceSponsorView {
  stableName: string;
  silks: Silks;
  /** The viewer's stable is the sponsor. */
  mine: boolean;
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
  /** Credit entry fee on top of the stable entries (top classes only; 0 for most races). */
  entryFee: number;
  /** Entered so far (open) or the locked field size. */
  fieldSize: number;
  targetRunners: number;
  /** Player stables entered (Club runners never count): "N stables entered". */
  stables: number;
  /** First post time of the race meeting the race belongs to (game-core meetings.ts). */
  meetingStartMs: number;
  phase: "open" | "closed" | "live" | "finished";
  /** The viewer's horses entered in this race. */
  mine: number;
  /** Sister courses running the same race in the same slot (original rows only). */
  alsoAt?: string[];
  /** When the result became official. Only present once finished. */
  endsAtMs?: number;
  /** Only present once the race has finished on the broadcast clock. */
  winner?: { horseId: string; name: string; stableName: string; timeUs: number };
  /** The race's sponsor (sister courses show the original's). */
  sponsor?: RaceSponsorView;
  /** A claiming race (every runner is for sale at its claim price). */
  claiming?: boolean;
}

export interface RiskView {
  permille: number;
  label: "low" | "moderate" | "elevated" | "high";
  careerEndingShare: number;
  factors: string[];
  /** The injuries most likely IF the horse is hurt in this context: "sore shins, knocked joint; if serious, tendon strain". */
  likely?: string;
}

export interface StableHorse {
  id: string;
  /** Public registration number, e.g. "G2-04571". */
  regNo: string;
  /** Shared Horse (current stats, appearance in the stable's silks). */
  horse: Horse;
  /** One-line genetics, e.g. "bay roan · Sabino · 88% TB" (null for legacy rows). */
  geneticsLine: string | null;
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
  /** `name`: the injury's catalogue name, or its severity for old injuries ("Minor injury"). */
  injury: { severity: string; name: string; untilMs: number | null } | null;
  /** Race the horse is entered in (locked), if any. */
  lockedRaceId: string | null;
  ranToday: number;
  /** Why the horse can't race right now (null = can race). */
  block: string | null;
  /** Injury risk for a normal ride at its best trip on good going. */
  risk: RiskView;
  /** Held on lease from another stable (the stable view's "Leased from" chip). */
  lease?: LeaseChip | null;
}

/** A horse held on lease, as the lessee's stable shows it. */
export interface LeaseChip {
  leaseId: string;
  fromStable: string;
  endsAtMs: number;
  /** The lessee's share of every purse, percent. */
  sharePct: number;
  earned: number;
  races: number;
  allowAllOut: boolean;
  maxLiveStartsPerWeek: number;
  returnPending: boolean;
}

/** One of the stable's own horses away on lease ("On lease to ..."). */
export interface LeasedOutHorse {
  id: string;
  leaseId: string;
  horse: Horse;
  toStable: string;
  endsAtMs: number;
  ownerSharePct: number;
  /** The owner's share earned so far. */
  earned: number;
  races: number;
  returnPending: boolean;
}

/** Lease details on the horse page (owner, lessee, or anyone: it races in the lessee's colours). */
export interface HorseLeaseInfo {
  leaseId: string;
  /** The viewer's side, or "public". */
  role: "owner" | "lessee" | "public";
  ownerStableName: string;
  lesseeStableName: string;
  endsAtMs: number;
  ownerSharePct: number;
  races: number;
  ownerEarned: number;
  lesseeEarned: number;
  allowAllOut: boolean;
  maxLiveStartsPerWeek: number;
  returnPending: boolean;
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
  /** The full form line (/me/races). */
  line?: FormLineView;
}

export interface EntryBankView {
  balance: number;
  cap: number;
  allowance: number;
  refillAvailable: boolean;
  refillPrice: number;
}

export interface DailyGoalView {
  goal: "race" | "care" | "cup";
  label: string;
  done: boolean;
  credits: number;
}

export interface PlayerView {
  accountId: string;
  stableName: string;
  silks: Silks;
  /** The stable's photo, if it has one (else the silks show). */
  photoUrl: string | null;
  credits: number;
  entries: EntryBankView;
  stalls: { slots: number; used: number };
  /** Weekly upkeep so far this week (used horses and what they would cost), for the stable page. */
  upkeep: { horses: number; due: number };
  horses: StableHorse[];
  /** The stable's own horses away on lease (they stand in the lessee's stall). */
  leasedOut?: LeasedOutHorse[];
  active: ActiveEntry[];
  inbox: InboxView[];
  runs: RunView[];
  /** The player has run any race of any kind (Story, Live or Daily Cup), ever: retires "Your first race". */
  hasRaced: boolean;
  /** Today's three goals, on the player's local day. */
  goals: DailyGoalView[];
  /** Closed playtest: this stable belongs to an invited tester (see /beta). */
  tester: boolean;
  serverNowMs: number;
  /** Stable news: discoveries and milestones (moments) and the Sunday League recap, newest first. */
  news?: MomentView[];
}

/** A tribute card's numbers (game-core Tribute). */
export interface TributeView {
  starts: number;
  wins: number;
  places: number;
  shows: number;
  earnings: number;
  peakOr: number;
  bestWin: { raceId: string; raceName: string; purse: number; atMs: number } | null;
}

/** A moment (packages/db moments.ts) or a League recap, as stable news and horse-page highlights. */
export interface MomentView {
  id: string;
  /** game-core MomentKind, or "week_recap". */
  kind: string;
  horseId: string | null;
  horseName: string | null;
  title: string;
  /** What this means. */
  body: string;
  href: string;
  raceId: string | null;
  tribute: TributeView | null;
  createdAtMs: number;
  /** Not dismissed yet (its horse-page highlight still shows). */
  fresh: boolean;
}

/** /legacy: the stable's horses retired for good, each with its tribute or memorial. */
export interface LegacyFarmView {
  stableName: string;
  horses: {
    id: string;
    name: string;
    regNo: string;
    appearance: Horse["appearance"];
    sex: Horse["sex"];
    tribute: TributeView;
    /** A horse lost to a race injury: a memorial, not a tribute. */
    died: { atMs: number; raceId: string | null; raceName: string | null; cause?: string | null } | null;
    retiredAtMs: number | null;
  }[];
}

export interface HorseDetailView {
  horse: Horse;
  /** Public registration number, e.g. "G2-04571". */
  regNo: string;
  kind: "player" | "house";
  stableName: string;
  trainer: string | null;
  /** The viewer keeps the horse: may care for, train and race it (the owner, or the lessee while on lease). */
  mine: boolean;
  /** The viewer owns the horse (owner-only acts: sell, breed, retire, lease out). */
  owned?: boolean;
  /** The active lease, when the horse is on lease. */
  lease?: HorseLeaseInfo | null;
  /** Present for the viewer's own (kept) horses. */
  status: StableHorse | null;
  runs: RunView[];
  /** The form book: every start's full form line (no result before settlement) and the splits. */
  form: HorseFormView;
  /** A sire's offspring splits (stallions with runners only). */
  sireLine: { runners: number; splits: SplitsView } | null;
  pedigree: { sire: { id: string; name: string; regNo: string | null } | null; dam: { id: string; name: string; regNo: string | null } | null };
  /** Three generations of ancestors above this horse (null parent = foundation stock). */
  tree: PedigreeNode;
  /** Standing at public stud (a player's stallion or a Club house stallion). */
  stud: {
    fee: number;
    club: boolean;
    /** A registered stallion standing for a USDG fee instead (micro-USDG). */
    feeUsdg?: number | null;
    /** "Resting · available again in 7 h" after a covering (game-core STUD_COOLDOWN_MS); null when he can cover now. */
    resting?: string | null;
  } | null;
  /** The owner's next steps beyond racing (null for other stables' horses). */
  actions: { cover: boolean; stud: boolean; sell: boolean } | null;
  /** Coat genetics, markings, breed mix, build, inbreeding, revealed quirks (stud-book info). */
  genetics: GeneticsSummary | null;
}

export interface PedigreeNode {
  id: string;
  name: string;
  regNo: string;
  sex: Horse["sex"];
  appearance: Horse["appearance"];
  starts: number;
  wins: number;
  generation: number;
  sire: PedigreeNode | null;
  dam: PedigreeNode | null;
}

/** A named injury as the result screen and the horse page show it. */
export interface InjuryCard {
  severity: string;
  /** Catalogue name, or the severity for old injuries ("Minor injury"). */
  name: string;
  /** Body area ("Front leg") and one plain line, when the injury has a catalogue kind. */
  area: string | null;
  description: string | null;
  careerEnding: boolean;
  fatal: boolean;
  /** Hours of healing left (0 when healed or fatal). */
  hoursLeft: number;
}

/** The viewer's own result in a race (only after the broadcast is over). */
export interface MyRaceResult {
  raceId: string;
  settled: boolean;
  /** True the first time the owner sees this result (its inbox item was unread): stage the reveal. */
  firstView: boolean;
  runners: {
    horseId: string;
    horseName: string;
    position: number;
    prize: number;
    storyReward: number;
    firstWin: boolean;
    ratingBefore: number;
    ratingAfter: number | null;
    /** One honest line from the rating rule on why the mark moved (or held); null when there is nothing to explain. */
    ratingWhy: string | null;
    /** The owner's horse at the off (from its entry): fatigue and hours since its last hard work (Why card "try next"). */
    atOff?: { fatigue: number; hoursSinceHardWork: number | null } | null;
    /** An injury picked up in this race, named (game-core injuries.ts). */
    injury?: InjuryCard | null;
  }[];
}

/** /api/me/races: one cursor page of the stable's settled runs, plus the filter's totals. */
export interface MyRacesView {
  rows: RunView[];
  /** For the current filter (places = 2nd or 3rd). */
  summary: { runs: number; wins: number; places: number; credits: number };
  /** Feed to `cursor` for the next page; null on the last. */
  nextCursor: string | null;
}

export interface ApiError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Form book (form lines, splits, the horse's log)
// ---------------------------------------------------------------------------

/**
 * One start as a full form line (packages/db formBook.ts formLineOf). `result` is null until the
 * race has settled (a Live race settles once its broadcast is over): no spoilers.
 */
export interface FormLineView {
  raceId: string;
  horseId: string;
  horseName?: string;
  status: "settled" | "running" | "declared";
  postTimeMs: number;
  raceName: string;
  raceClass: string;
  kind: RaceKind;
  course: string | null;
  distanceM: number;
  surface: Surface;
  going: Going;
  fieldSize: number;
  gate: number | null;
  tactic: string;
  /** Keeper only (null for other viewers and old entries). */
  intensity: string | null;
  extras: string[];
  jockey: { tier: string | null; name: string | null };
  weightLb: number | null;
  extraWeightLb: number | null;
  /** Condition at the off, permille. Keeper only. */
  fatigue: number | null;
  freshness: number | null;
  purse: number;
  ratingBefore: number;
  result: {
    position: number;
    beatenMm: number | null;
    marginLabel: string | null;
    winningTimeUs: number | null;
    timeUs: number | null;
    ratingAfter: number | null;
    prize: number;
  } | null;
}

export interface SplitBucketView {
  key: string;
  runs: number;
  wins: number;
  seconds: number;
  thirds: number;
  avgBeatenMm: number | null;
  small: boolean;
}

export interface SplitsView {
  total: SplitBucketView;
  groups: { dimension: string; buckets: SplitBucketView[] }[];
  best: { dimension: string; bucket: SplitBucketView } | null;
  worst: { dimension: string; bucket: SplitBucketView } | null;
  /** Fewer runs than this in a bucket: a small sample. */
  minRuns: number;
}

/** A horse's form book: every start (newest first) and the splits of the settled ones. */
export interface HorseFormView {
  lines: FormLineView[];
  splits: SplitsView;
}

/** One entry in a horse's log (packages/db horseLog.ts). */
export interface HorseLogEntryView {
  key: string;
  kind: string;
  atMs: number;
  raceId?: string | null;
  horseId?: string | null;
  data: Record<string, unknown>;
  line?: FormLineView;
}

export interface HorseLogView {
  entries: HorseLogEntryView[];
  nextCursor: string | null;
}

/** /api/me/formbook: the stable's splits (all horses, or one). */
export interface StableFormBookView {
  horseId: string | null;
  splits: SplitsView;
}
