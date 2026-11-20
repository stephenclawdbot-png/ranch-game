/**
 * The demand-aware Live card: which races a meeting publishes, chosen from the horses that exist.
 *
 * Why (week one of the beta, 2026-11: 112 testers, 12-38 playing a day): the card published four
 * races in every meeting from a fixed class pattern, half of them for bands no player horse was
 * in (Listed, 50-75, 70-95). 59% of Live races were called off with no player and the ones that
 * ran averaged 2.5 real stables. A handful of players spread over 32 races a day cannot meet.
 *
 * What the plan does, once per meeting, when the meeting is published (a day ahead; packages/db
 * card.ts runs it inside the publishing transaction and stores the result as the race rows):
 *
 *   1. Size. The meeting gets as many races as its players can fill: the player entries the same
 *      meeting drew lately, divided by CARD_TARGET_STABLES_PER_RACE, at least
 *      CARD_MIN_RACES_PER_MEETING and at most the meeting's free slots (RACES_PER_MEETING). A thin
 *      population gets one busy race every meeting; a big one gets the full card back by itself.
 *      A race that fills still opens a sister course and starts early, so a small card never turns
 *      anyone away.
 *   2. Classes. Each race goes to the class that gives the most horses without a race in this
 *      meeting one they may enter (class conditions and the stable's licence), among the classes
 *      at least CARD_MIN_ELIGIBLE_STABLES active stables can enter. Classes that cover nearly as
 *      many take turns from meeting to meeting, and once every horse has a race the rest go to the
 *      classes most stables can enter that the meeting has least of. A band nobody is in is never
 *      published.
 *   3. Cover. Horses that had no race in this meeting or the CARD_COVER_EVERY_MEETINGS - 1 before
 *      it (the few in a band of their own: often the best horses of the most engaged players) get
 *      one now, as an extra race in a free slot. So every horse that can race has one it may enter
 *      at least every second meeting.
 *   4. Trips and surfaces rotate so every (class, trip zone, surface) comes round, skipping trips
 *      that fewer than CARD_TRIP_MIN_HORSES eligible horses are suited to and surfaces none of
 *      those prefers, and never two races at one trip in a meeting when another trip is wanted.
 *
 * Pure and deterministic: the same input gives the same plan (integer maths, no clock).
 */

/** Real stables a Live race should draw: the meeting gets one race per this many recent player entries. */
export const CARD_TARGET_STABLES_PER_RACE = 4;
/** Every meeting publishes at least this many ordinary races, whatever the demand (no time zone waits long). */
export const CARD_MIN_RACES_PER_MEETING = 1;
/** A class is scheduled on demand only when at least this many active stables have a horse for it. */
export const CARD_MIN_ELIGIBLE_STABLES = 3;
/** A horse with no race it may enter in this many meetings running gets a cover race. */
export const CARD_COVER_EVERY_MEETINGS = 2;
/** A trip is run only when at least this many eligible horses are suited to it (when any trip is). */
export const CARD_TRIP_MIN_HORSES = 2;
/** A stable counts towards demand for this long after it last played (or was founded). */
export const CARD_DEMAND_ACTIVE_MS = 3 * 24 * 60 * 60 * 1000;
/** Horses read for one plan at most (the most recently active stables first): beyond this the card is full anyway. */
export const CARD_DEMAND_READ_LIMIT = 800;
/** A class that covers at least this share (permille) of the best class's horses takes turns with it. */
export const CARD_ROTATE_WITHIN_PERMILLE = 800;
/**
 * A trip suits a horse when it is at most this far below, or this far above, the horse's best
 * trip (the form guide's grade C or better; packages/db card.ts JUVENILE_TRIPS).
 */
export const CARD_TRIP_BELOW_M = 450;
export const CARD_TRIP_ABOVE_M = 130;
/** Two races of one meeting are never closer than this in trip (when another trip is wanted). */
export const CARD_TRIP_SPREAD_M = 300;
/** The trip and surface rotation steps this many places a turn: coprime to 3 surfaces, 4 juvenile trips and 10 open trips. */
const ROTATION_STRIDE = 7;

export const CARD_SURFACES = ["turf", "dirt", "synthetic"] as const;
export type CardSurfaceName = (typeof CARD_SURFACES)[number];

/** A player horse that could race, as the plan sees it. */
export interface DemandHorse {
  /** Its keeper stable (any stable key). */
  stable: string;
  wins: number;
  /** Official rating (rating floors use it). */
  rating: number;
  /** Band rating (rating ceilings use it: eligibility.ts bandRating). */
  bandRating: number;
  /** The keeper stable's licence level. */
  licence: number;
  /** Best trip, metres, and preferred surface. */
  distanceM: number;
  surface: CardSurfaceName;
}

/** The conditions the plan checks: class (wins, rating band) and the licence the class needs. */
export interface CardConditions {
  maxWins?: number;
  minRating?: number;
  maxRating?: number;
  /** Licence level the class needs (story.ts licenceForTier). */
  licence: number;
}

/** A class the card can publish. */
export interface CardOption extends CardConditions {
  key: string;
  /** Trips the class is run over. */
  trips: readonly number[];
  /** A class every new horse can enter: what an empty world's card is made of. */
  starter?: boolean;
}

/** A race a meeting already has (a sponsored slot, the claiming race, one published earlier). */
export interface FixedCardRace extends CardConditions {
  distanceM: number;
}

export interface PlannedRace {
  /** CardOption.key. */
  key: string;
  distanceM: number;
  surface: CardSurfaceName;
  /** Active stables with a horse that may enter. */
  eligibleStables: number;
  /** "demand": one of the meeting's sized races; "cover": an extra for horses with no other race. */
  reason: "demand" | "cover";
}

export interface MeetingPlanInput {
  /** Global meeting number (meetings.ts Meeting.number): drives every rotation. */
  meeting: number;
  /** Free ordinary slots the plan may fill. */
  slots: number;
  horses: readonly DemandHorse[];
  /** Player entries this meeting can expect (what the same meeting drew lately). */
  recentEntries: number;
  /** The classes on offer, in card order (the order breaks ties and sets the turns). */
  options: readonly CardOption[];
  /** Races this meeting already has; they count as covering their horses and using their trips. */
  fixed?: readonly FixedCardRace[];
  /** Races of the CARD_COVER_EVERY_MEETINGS - 1 meetings before this one (a horse with one there needs no cover race now). */
  previous?: readonly CardConditions[];
}

/** The horse may enter a race with these conditions (class and licence; the same rules as the entry sheet). */
export function demandEligible(h: DemandHorse, c: CardConditions): boolean {
  if (h.licence < c.licence) return false;
  if (c.maxWins !== undefined && h.wins > c.maxWins) return false;
  if (c.minRating !== undefined && h.rating < c.minRating) return false;
  if (c.maxRating !== undefined && h.bandRating > c.maxRating) return false;
  return true;
}

/** The trip suits the horse (at most CARD_TRIP_BELOW_M under its best trip or CARD_TRIP_ABOVE_M over). */
export function tripSuits(horseBestM: number, tripM: number): boolean {
  return tripM >= horseBestM - CARD_TRIP_BELOW_M && tripM <= horseBestM + CARD_TRIP_ABOVE_M;
}

/** Races a meeting is sized for: one per CARD_TARGET_STABLES_PER_RACE recent entries, within [minimum, slots]. */
export function meetingRaceCount(recentEntries: number, slots: number): number {
  if (slots <= 0) return 0;
  const byDemand = Math.floor(Math.max(0, recentEntries) / CARD_TARGET_STABLES_PER_RACE);
  return Math.max(Math.min(CARD_MIN_RACES_PER_MEETING, slots), Math.min(slots, byDemand));
}

const mod = (a: number, b: number) => ((a % b) + b) % b;
const floorDiv = (a: number, b: number) => Math.floor(a / b);

/** The meeting's ordinary races, in card order (at most `slots`; never empty when slots > 0). */
export function planMeeting(input: MeetingPlanInput): PlannedRace[] {
  const { horses, options } = input;
  const slots = Math.max(0, Math.floor(input.slots));
  if (!slots || !options.length) return [];
  const fixed = input.fixed ?? [];
  const previous = input.previous ?? [];

  const eligible = options.map((o) => horses.map((h) => demandEligible(h, o)));
  const horsesOf = eligible.map((row) => row.filter(Boolean).length);
  const stablesOf = options.map((_, i) => new Set(horses.filter((_h, j) => eligible[i]![j]).map((h) => h.stable)).size);
  const covered = horses.map((h) => fixed.some((f) => demandEligible(h, f)));
  const servedLately = horses.map((h) => previous.some((p) => demandEligible(h, p)));
  const chosenTimes = options.map(() => 0);
  const usedTrips = fixed.map((f) => f.distanceM);
  const out: PlannedRace[] = [];

  /** Horses the option would give a race that have none in this meeting yet (`lately`: nor in the meetings before). */
  const gainOf = (i: number, lately = false) => {
    let n = 0;
    for (let j = 0; j < horses.length; j++) if (eligible[i]![j] && !covered[j] && !(lately && servedLately[j])) n++;
    return n;
  };

  /** Adds a race of option `i`; `cycle` counts that class's turns, so its trips and surfaces all come round. */
  const add = (i: number, reason: PlannedRace["reason"], cycle: number) => {
    const o = options[i]!;
    const k = cycle * ROTATION_STRIDE + out.length;
    const mine = horses.filter((_h, j) => eligible[i]![j]);
    const suited = (d: number) => mine.filter((h) => tripSuits(h.distanceM, d));
    // trips in rotation order: one enough horses are suited to, clear of the meeting's other trips
    const order = o.trips.map((_, t) => o.trips[mod(k + t, o.trips.length)]!);
    const wanted = (d: number) => suited(d).length >= CARD_TRIP_MIN_HORSES;
    const gap = (d: number) => usedTrips.reduce((least, u) => Math.min(least, Math.abs(u - d)), 100_000);
    // ...or, when none is clear, the wanted trip farthest from the others (the first such in rotation order)
    const pool = order.some(wanted) ? order.filter(wanted) : order;
    const distanceM = pool.find((d) => gap(d) >= CARD_TRIP_SPREAD_M) ?? pool.reduce((best, d) => (gap(d) > gap(best) ? d : best), pool[0]!);
    // surfaces in rotation order: one a suited horse prefers when there is one
    const fans = suited(distanceM);
    const surfaces = CARD_SURFACES.map((_, s) => CARD_SURFACES[mod(k + s, CARD_SURFACES.length)]!);
    const surface = surfaces.find((s) => fans.some((h) => h.surface === s)) ?? surfaces[0]!;
    out.push({ key: o.key, distanceM, surface, eligibleStables: stablesOf[i]!, reason });
    usedTrips.push(distanceM);
    chosenTimes[i]!++;
    for (let j = 0; j < horses.length; j++) if (eligible[i]![j]) covered[j] = true;
  };

  /**
   * Among the options within CARD_ROTATE_WITHIN_PERMILLE of the best score, the one whose turn it
   * is this meeting, and how many whole rounds of turns have gone by (the class's own cycle).
   */
  const takeTurn = (scores: readonly number[], offset: number): { pick: number; cycle: number } | null => {
    let best = 0;
    for (const s of scores) if (s > best) best = s;
    if (best <= 0) return null;
    const near = scores.map((s, i) => (s * 1000 >= best * CARD_ROTATE_WITHIN_PERMILLE ? i : -1)).filter((i) => i >= 0);
    return { pick: near[mod(input.meeting + offset, near.length)]!, cycle: floorDiv(input.meeting, near.length) };
  };

  // 1 + 2. The sized races, each to the class that gives the most horses a race. Races the meeting
  // already has for a class enough stables can enter count towards the size.
  const open = options.map((_, i) => stablesOf[i]! >= CARD_MIN_ELIGIBLE_STABLES);
  const fixedBroad = fixed.filter((f) => new Set(horses.filter((h) => demandEligible(h, f)).map((h) => h.stable)).size >= CARD_MIN_ELIGIBLE_STABLES).length;
  const count = Math.max(1, meetingRaceCount(input.recentEntries, slots + fixedBroad) - fixedBroad);
  for (let n = 0; n < count && out.length < slots; n++) {
    const turn =
      takeTurn(options.map((_, i) => (open[i] ? gainOf(i) : 0)), n) ??
      // every horse has a race: the class most stables can enter that the meeting has least of
      takeTurn(options.map((_, i) => (open[i] ? floorDiv(1000 * stablesOf[i]!, 1 + chosenTimes[i]!) : 0)), n) ??
      // no class reaches the minimum (a new or tiny world): whichever class gives most horses a race
      takeTurn(options.map((_, i) => gainOf(i)), n) ??
      // nobody to race at all: the meeting's one race is a class every new horse can enter
      (out.length ? null : takeTurn(options.map((o, i) => (o.starter ? 1 + horsesOf[i]! : horsesOf[i]!)), n));
    if (!turn) break;
    add(turn.pick, "demand", turn.cycle);
  }

  // 3. Cover: horses with no race here or in the meetings just before get one now.
  // Among the classes that serve nearly as many of them, the narrowest: a cover race should draw
  // the horses it is for, not split the meeting's main field.
  while (out.length < slots) {
    const gains = options.map((_, i) => gainOf(i, true));
    let best = 0;
    for (const g of gains) if (g > best) best = g;
    if (best <= 0) break;
    let pick = -1;
    for (let i = 0; i < options.length; i++) {
      if (gains[i]! * 1000 < best * CARD_ROTATE_WITHIN_PERMILLE) continue;
      if (pick < 0 || horsesOf[i]! < horsesOf[pick]!) pick = i;
    }
    add(pick, "cover", input.meeting);
  }
  return out;
}
