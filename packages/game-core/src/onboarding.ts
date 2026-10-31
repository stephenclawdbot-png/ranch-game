/**
 * Onboarding (§10): a starter stable of 3 modest, race-ready horses (Club-bred, never
 * tradeable), a guaranteed-competitive first maiden (we pick a fair *field*; the race itself
 * is simulated honestly), and a day-2 gift foal from the Club's broodmare.
 */
import type { Horse, RaceConfig, RaceEntry, Silks } from "@thoroughbred/shared";
import type { Breed, HorseState, Rarity } from "./types";
import { generateFoundationGenome, preferredDistanceM, preferredSurface } from "./genome";
import { CARE_TO_RACING, createHorseState } from "./lifecycle";
import { clubRunner, meanStat } from "./field";
import { dayIndex } from "./time";
import { Rng, seedFrom } from "./rng";

const STARTER_NAMES = ["First Light", "Lucky Penny", "Brave Heart", "Quiet Storm", "Paper Moon", "Copper Kettle", "Little Comet", "Hope Springs", "Fair Wind", "Bright Idea", "Steady On", "Open Gate"];

export interface StarterInput {
  ownerId: string;
  /** Stable-level seed (e.g. deriveSeed(secret, "starter:"+ownerId)). */
  seed: string;
  nowMs: number;
  season: number;
  idPrefix?: string;
}

/** Three modest starters: a sprinter (Quarter Horse), a miler (Thoroughbred), a stayer (Arabian). */
export const STARTER_PLAN: { breed: Breed; rarity: Rarity; sex: "colt" | "filly" }[] = [
  { breed: "quarterHorse", rarity: "common", sex: "colt" },
  { breed: "thoroughbred", rarity: "uncommon", sex: "filly" },
  { breed: "arabian", rarity: "common", sex: "colt" },
];

export function createStarterStable(input: StarterInput): HorseState[] {
  const rng = new Rng(`${input.seed}|starter-names`);
  const names = [...STARTER_NAMES];
  return STARTER_PLAN.map((p, i) => {
    const name = names.splice(rng.int(names.length), 1)[0]!;
    const genome = generateFoundationGenome(seedFrom("starter", input.seed, i), { season: input.season, rarity: p.rarity, breed: p.breed });
    return createHorseState({
      id: `${input.idPrefix ?? input.ownerId}-starter-${i + 1}`,
      name,
      sex: p.sex,
      ownerId: input.ownerId,
      sireId: null,
      damId: null,
      generation: 0,
      genome,
      bornAtMs: input.nowMs,
      bornSeason: input.season,
      location: "stable",
      binding: "club_bred",
      careSessions: CARE_TO_RACING,
    });
  });
}

/** Club strength relative to the player's horse (permille of its mean stat). */
export const FIRST_MAIDEN_STRENGTH: readonly [number, number] = [920, 1010];
export const FIRST_MAIDEN_RUNNERS = 6;

/**
 * The first maiden: trip and surface suit the player's horse, and the Club field is drawn
 * slightly below to level with it, so the horse is competitive — but the race is a normal,
 * honest simulation and can be lost.
 */
export function firstMaidenRace(player: Horse, state: HorseState, seed: string, postTimeMs: number): { race: RaceConfig; entries: RaceEntry[] } {
  const rng = new Rng(`${seed}|first-maiden`);
  const distanceM = Math.max(1000, Math.min(2400, preferredDistanceM(state.genome)));
  const surface = preferredSurface(state.genome);
  const level = meanStat(player);
  const entries: RaceEntry[] = [{ gate: 1, tactic: player.style, horse: player }];
  for (let i = 0; i < FIRST_MAIDEN_RUNNERS - 1; i++) {
    const strength = Math.round((level * rng.range(FIRST_MAIDEN_STRENGTH[0], FIRST_MAIDEN_STRENGTH[1])) / 1000);
    const h = clubRunner(seed, { id: `maiden-club-${i + 1}`, strength, spread: 40, distanceM, surface });
    entries.push({ gate: i + 2, tactic: h.style, horse: h });
  }
  // Shuffle gates so the player's horse is not always on the rail.
  const gates = entries.map((_, i) => i + 1);
  for (let i = gates.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [gates[i], gates[j]] = [gates[j]!, gates[i]!];
  }
  const shuffled = entries.map((e, i) => ({ ...e, gate: gates[i]! }));
  return {
    race: { id: `first-maiden-${state.id}`, name: "Welcome Maiden Stakes", distanceM, surface, weather: "clear", going: "good", raceClass: "maiden", postTimeMs, purse: 600 },
    entries: shuffled,
  };
}

/** The gift foal arrives from the player's second real day on (any later day is fine). */
export function giftFoalDue(accountCreatedAtMs: number, nowMs: number, alreadyGiven: boolean): boolean {
  return !alreadyGiven && dayIndex(nowMs) >= dayIndex(accountCreatedAtMs) + 1;
}

export function createGiftFoal(input: StarterInput & { name: string }): HorseState {
  const rng = new Rng(`${input.seed}|gift`);
  const genome = generateFoundationGenome(seedFrom("gift-foal", input.seed), { season: input.season, rarity: rng.chance(400) ? "uncommon" : "common" });
  return createHorseState({
    id: `${input.idPrefix ?? input.ownerId}-gift-foal`,
    name: input.name,
    sex: rng.chance(500) ? "colt" : "filly",
    ownerId: input.ownerId,
    sireId: null,
    damId: null,
    generation: 0,
    genome,
    bornAtMs: input.nowMs,
    bornSeason: input.season,
    location: "stable",
    binding: "club_bred",
  });
}

/** Default stable silks if the player skips the editor. */
export const DEFAULT_SILKS: Silks = { primary: "#1d3557", secondary: "#f1faee", pattern: "hoops", cap: "#e63946" };

// ---------------------------------------------------------------------------
// Stable steps: the first-week guide on Home (2026-10-31, owner-approved)
// ---------------------------------------------------------------------------

/**
 * One step of the first-week guide. Each completes from the real server event (the care
 * session, the saved plan, the Live entry ...), once per account, and pays its credits once.
 */
export type StableStepKey =
  | "care"
  | "train_plan"
  | "enter_live"
  | "watch_live"
  | "read_why"
  | "daily_cup"
  | "pick"
  | "quick_race"
  | "pin_target"
  | "breeding_preview";

/** A feature a step needs before it can be offered (detected on the server at run time). */
export type GuideFeature = "quickRaces";

export interface StableStepDef {
  key: StableStepKey;
  /** Credits paid once when the step completes (ledger kind `stable_step`). */
  credits: number;
  /** Only offered when this feature exists in the running build; otherwise skipped. */
  requires?: GuideFeature;
}

/**
 * The guide, in order: look after a horse, plan its week, race it Live, watch and understand
 * the result, then the daily and weekly tools (Cup, picks, quick races, the planner) and a
 * first look at breeding. Total with every step and the bonus: 830 credits (770 without quick
 * races), about a quarter of the starter grant and roughly six days of daily goals; a one-off
 * per account, so it never changes the steady-state economy (KNOBS §10a, season harness).
 */
export const STABLE_STEPS: readonly StableStepDef[] = [
  { key: "care", credits: 50 },
  { key: "train_plan", credits: 60 },
  { key: "enter_live", credits: 80 },
  { key: "watch_live", credits: 60 },
  { key: "read_why", credits: 60 },
  { key: "daily_cup", credits: 60 },
  { key: "pick", credits: 60 },
  { key: "quick_race", credits: 60, requires: "quickRaces" },
  { key: "pin_target", credits: 70 },
  { key: "breeding_preview", credits: 70 },
];

/** Paid once when every step on offer is done (ledger kind `stable_step`); also earns the "Learned the Ropes" plaque. */
export const STABLE_STEPS_BONUS = 200;

export type GuideFeatures = Readonly<Partial<Record<GuideFeature, boolean>>>;

export function isStableStepKey(x: unknown): x is StableStepKey {
  return typeof x === "string" && STABLE_STEPS.some((s) => s.key === x);
}

/** The steps on offer in this build: a step whose feature is missing is skipped, not shown locked. */
export function stableStepsFor(features: GuideFeatures = {}): StableStepDef[] {
  return STABLE_STEPS.filter((s) => !s.requires || features[s.requires] === true);
}

/** Everything the guide can pay in this build: every step on offer plus the finishing bonus. */
export function stableStepsTotal(features: GuideFeatures = {}): number {
  return stableStepsFor(features).reduce((sum, s) => sum + s.credits, 0) + STABLE_STEPS_BONUS;
}

export interface StableStepsProgress {
  steps: { key: StableStepKey; credits: number; done: boolean }[];
  /** The first step not done yet, in order (null when complete). */
  next: StableStepKey | null;
  done: number;
  total: number;
  complete: boolean;
}

/** Progress through the guide from the set of completed step keys. */
export function stableStepsProgress(done: ReadonlySet<string>, features: GuideFeatures = {}): StableStepsProgress {
  const steps = stableStepsFor(features).map((s) => ({ key: s.key, credits: s.credits, done: done.has(s.key) }));
  const count = steps.filter((s) => s.done).length;
  return { steps, next: steps.find((s) => !s.done)?.key ?? null, done: count, total: steps.length, complete: count === steps.length };
}

// ---------------------------------------------------------------------------
// The first week on Home (2026-11-01, owner-approved after the first-hour playtest)
// ---------------------------------------------------------------------------

/**
 * Jobs on the first-week list that pay nothing: the paid Stable steps above carry the guide's
 * rewards (and the daily goals pay for racing, care and the Cup), so these only point the way.
 * Each is ticked from the stable's own records, never from a click on the list.
 */
export type FirstWeekExtraKey = "first_race" | "rename" | "qualifier" | "career_story";
export type FirstWeekKey = StableStepKey | FirstWeekExtraKey;

/** The list shows from founding day until this many days later (day 0 to day 6), then hides for good. */
export const FIRST_WEEK_DAYS = 7;
/** How many jobs to do the list shows at once (the rest wait under "All"). */
export const FIRST_WEEK_SHOWN = 3;

/**
 * The order a new trainer meets things: the first race and its "why" (both usually done in the
 * first minutes), care and training, a Live race and its result, naming a horse while it still
 * can be, the daily and weekly tools, a Feature Qualifier, a look at breeding, a career story.
 */
export const FIRST_WEEK_ORDER: readonly FirstWeekKey[] = [
  "first_race",
  "read_why",
  "care",
  "train_plan",
  "enter_live",
  "watch_live",
  "rename",
  "daily_cup",
  "qualifier",
  "pick",
  "quick_race",
  "pin_target",
  "breeding_preview",
  "career_story",
];

/** What the stable's records say about the unpaid jobs. */
export interface FirstWeekFacts {
  guided: boolean;
  /** UTC days since founding (0 on founding day). */
  daysSinceFounding: number;
  /** A race of the stable's has a result (Story or Live). */
  firstRace: boolean;
  /** The player has renamed a horse. */
  renamed: boolean;
  /** A horse at home can still be renamed (it hasn't started yet). */
  canRename: boolean;
  /** The stable has entered a Feature Qualifier. */
  qualifier: boolean;
  /** The player has read one of their horses' career stories. */
  careerStory: boolean;
}

export interface FirstWeekItem {
  key: FirstWeekKey;
  /** Credits the job pays (a paid Stable step's own credits; 0 for the extras). Never paid twice. */
  credits: number;
  done: boolean;
}

export interface FirstWeekList {
  items: FirstWeekItem[];
  /** The next jobs to do, in order (at most FIRST_WEEK_SHOWN). */
  next: FirstWeekKey[];
  done: number;
  total: number;
  /** Shown on Home: a guided stable in its first week with something left to do. */
  visible: boolean;
  /** The last day (days since founding) the list shows. */
  lastDay: number;
}

export function isFirstWeekKey(x: unknown): x is FirstWeekKey {
  return typeof x === "string" && (FIRST_WEEK_ORDER as readonly string[]).includes(x);
}

/**
 * The first-week list: the paid Stable steps on offer and the unpaid extras, in the order a new
 * trainer meets them, each done from the records. Renaming is only on the list while it can be
 * done (or once it was). Hidden once everything is done or the first week is over.
 */
export function firstWeekList(steps: StableStepsProgress, f: FirstWeekFacts, shown = FIRST_WEEK_SHOWN): FirstWeekList {
  const paid = new Map(steps.steps.map((s) => [s.key as FirstWeekKey, s]));
  const extra: Record<FirstWeekExtraKey, { offered: boolean; done: boolean }> = {
    first_race: { offered: true, done: f.firstRace },
    rename: { offered: f.renamed || f.canRename, done: f.renamed },
    qualifier: { offered: true, done: f.qualifier },
    career_story: { offered: true, done: f.careerStory },
  };
  const items: FirstWeekItem[] = [];
  for (const key of FIRST_WEEK_ORDER) {
    const p = paid.get(key);
    if (p) items.push({ key, credits: p.credits, done: p.done });
    else if (key in extra) {
      const e = extra[key as FirstWeekExtraKey];
      if (e.offered) items.push({ key, credits: 0, done: e.done });
    }
  }
  const done = items.filter((i) => i.done).length;
  const lastDay = FIRST_WEEK_DAYS - 1;
  return {
    items,
    next: items.filter((i) => !i.done).slice(0, shown).map((i) => i.key),
    done,
    total: items.length,
    visible: f.guided && f.daysSinceFounding >= 0 && f.daysSinceFounding <= lastDay && done < items.length,
    lastDay,
  };
}

// ---------------------------------------------------------------------------
// Progressive unlocks (2026-10-31, owner-approved)
// ---------------------------------------------------------------------------

/** Features a brand-new stable meets a little later, so day one isn't every system at once. */
export type UnlockFeature = "tote" | "market" | "leasing" | "claiming" | "jockey_contracts";
export const UNLOCK_FEATURES: readonly UnlockFeature[] = ["tote", "market", "leasing", "claiming", "jockey_contracts"];

/** Market and leasing open from the stable's third day (founding day + 2, the free-pack day). */
export const UNLOCK_MARKET_DAYS = 2;
/** Licence level reached by finishing Story chapter 1: opens market, leasing, claiming and jockey contracts. */
export const UNLOCK_CHAPTER_LICENCE = 2;

export type UnlockReason = "existing_stable" | "wallet" | "watched_live" | "day_three" | "story_chapter" | "already_used";

export interface UnlockFacts {
  /** False for stables founded before the guide shipped: they keep everything. */
  guided: boolean;
  /** Signed in with a wallet: they came for the USDG features (the tote and the market). */
  wallet: boolean;
  /** Has watched the result of one of its own Live races. */
  watchedLiveRace: boolean;
  /** UTC days since founding (0 on founding day). */
  daysSinceFounding: number;
  licenceLevel: number;
  /** A feature the stable already used stays open, whatever else holds. */
  used?: Readonly<Partial<Record<UnlockFeature, boolean>>>;
}

/**
 * Why each feature is open, or null while it is still to come. Never takes anything away: an
 * existing stable has everything, a used feature stays open, and every rule only ever opens.
 */
export function unlockState(f: UnlockFacts): Record<UnlockFeature, UnlockReason | null> {
  const chapter = f.licenceLevel >= UNLOCK_CHAPTER_LICENCE;
  const day3 = f.daysSinceFounding >= UNLOCK_MARKET_DAYS;
  const rule = (feature: UnlockFeature): UnlockReason | null => {
    if (!f.guided) return "existing_stable";
    if (f.used?.[feature]) return "already_used";
    switch (feature) {
      case "tote":
        return f.wallet ? "wallet" : f.watchedLiveRace ? "watched_live" : null;
      case "market":
      case "leasing":
        return f.wallet ? "wallet" : chapter ? "story_chapter" : day3 ? "day_three" : null;
      case "claiming":
      case "jockey_contracts":
        return chapter ? "story_chapter" : null;
    }
  };
  return { tote: rule("tote"), market: rule("market"), leasing: rule("leasing"), claiming: rule("claiming"), jockey_contracts: rule("jockey_contracts") };
}

/** The "Unlocked" moment for each feature (Stable news): what opened, what it is, where it lives. */
export const UNLOCK_MOMENT: Readonly<Record<UnlockFeature, { title: string; body: string; href: string }>> = {
  tote: {
    title: "Unlocked: the tote",
    body: "You've watched your first Live race. Now you can back a runner in other stables' races: credits go into a shared pool, the odds are published, and bets close at the off. Never on a race your own horse runs in.",
    href: "/wiki/tote",
  },
  market: {
    title: "Unlocked: the market",
    body: "Buy and sell horses for Stable Credits in the Sales Ring. Buying needs a free stall; Club-bred starters stay with you.",
    href: "/market",
  },
  leasing: {
    title: "Unlocked: leasing",
    body: "Rent a racer from another stable and share its prize money, or lend one of yours out. It's on the market's Lease tab.",
    href: "/market#lease",
  },
  claiming: {
    title: "Unlocked: claiming races",
    body: "In a claiming race every runner is for sale at its claim price. Enter only a horse you'd be happy to sell, or claim one you like.",
    href: "/wiki/claiming-races",
  },
  jockey_contracts: {
    title: "Unlocked: jockey contracts",
    body: "Sign a jockey for a regular rider who knows your horses, or make an offer in Sunday's transfer window.",
    href: "/jockeys",
  },
};

// ---------------------------------------------------------------------------
// The day-3 bloodline nudge (2026-11-01, owner-approved)
// ---------------------------------------------------------------------------

/** From the stable's third day (founding day + 2, like the market) the head lad suggests a bloodline. */
export const BLOODLINE_NUDGE_DAYS = 2;

/** A mare the stable could breed from: a filly or mare it owns and has at home, not in foal. */
export interface BloodlineMare {
  id: string;
  name: string;
  /** Still racing (retiring her first is the suggestion) or already retired (she can breed now). */
  racing: boolean;
  rating: number;
}

export interface BloodlineFacts {
  guided: boolean;
  daysSinceFounding: number;
  /** "Not now" was tapped (the coach mark id `bloodline`), or a starter was retired from the nudge. */
  dismissed: boolean;
  /** The stable has requested a covering (any breeding event). */
  hasBred: boolean;
  mares: readonly BloodlineMare[];
}

/**
 * Wilf's day-3 suggestion: start a bloodline. Shown once to a guided stable from its third day,
 * until dismissed, and never to a stable that has already bred. A retired mare comes first (she
 * can breed straight away); otherwise the starter to retire is the lowest-rated racing filly, so
 * the best racers keep racing. Null when there is no mare to suggest.
 */
export function bloodlineNudge(f: BloodlineFacts): { horseId: string; name: string; retired: boolean } | null {
  if (!f.guided || f.dismissed || f.hasBred || f.daysSinceFounding < BLOODLINE_NUDGE_DAYS) return null;
  const pick = [...f.mares].sort((a, b) => Number(a.racing) - Number(b.racing) || a.rating - b.rating || a.id.localeCompare(b.id))[0];
  return pick ? { horseId: pick.id, name: pick.name, retired: !pick.racing } : null;
}

/** The mentor who welcomes a new stable and runs the first-week guide. */
export const MENTOR = { name: "Wilf Ashby", role: "Head lad" } as const;

// ---------------------------------------------------------------------------
// Welcome back
// ---------------------------------------------------------------------------

/** Away at least this long and Home opens with a "welcome back" card. Never a penalty, just a catch-up. */
export const WELCOME_BACK_AFTER_MS = 24 * 3_600_000;
/** The card stays until dismissed, or this long after the visit that raised it. */
export const WELCOME_BACK_SHOW_MS = 6 * 3_600_000;

/** True when a visit at `nowMs` after the last one at `lastVisitMs` is a "welcome back". */
export function isWelcomeBack(lastVisitMs: number | null, nowMs: number): boolean {
  return lastVisitMs !== null && nowMs - lastVisitMs >= WELCOME_BACK_AFTER_MS;
}
