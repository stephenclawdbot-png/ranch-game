/**
 * Simulated players. Each agent acts only through the server functions the app's API routes
 * call (apps/web/src/server: game.ts, economy.ts, horseLife.ts, competition.ts, story.ts,
 * founding.ts), with a fresh session per visit like `requireSession` gives a route. Every
 * decision is drawn from the agent's own seeded Rng; every call is wrapped so a refused action
 * (a DomainError, which a real client would show as a message) is counted, and anything else
 * is recorded as an unexpected exception.
 *
 * Cohorts:
 * - casual: one evening visit (and skips some days): care, the Daily Cup, a Story race, a
 *   couple of Live Quick Picks, the free Paddock Pack; now and then an entry from the sheet
 *   with a vet check (and physio for a tired horse); with credits to spare, now and then
 *   sponsors a race (the prestige sink, sponsor.ts).
 * - grinder: visits every couple of hours, keeps every fit horse entered in the race that
 *   suits it best (entryOptions fit), goes for Feature Qualifiers and the Weekend Feature when
 *   a horse can run (with race-day extras and a booked jockey), climbs the Story licences,
 *   trains, refills entries, buys upgrades and the odd horse on the market; a rich grinder
 *   occasionally sponsors a race.
 * - breeder: covers every mare the season allows (retiring mares to the paddock), foals and
 *   names, stands a stallion at stud, sells surplus stock once the market lets them, moves
 *   spent horses to the Legacy Farm.
 * - farmer: one main plus alt accounts run by the same person. Alts farm credits on the card
 *   and pass them to the main through the two channels the rules allow: covering their mares
 *   with the main's stallion (the main sets the fee to what the alt holds) and buying the
 *   main's horses at the listing ceiling. Alts also sell their tradeable horses to the main at
 *   the floor. `detected` groups share a wallet signal, so the market's linked-account guard
 *   can see them.
 */
import * as gc from "@thoroughbred/game-core";
import { DomainError, RULES, recordAccountSignal, stableOf, type Db } from "@thoroughbred/db";
import { enterLive, entryOptions, playerView, quickPickLive, raceList, refill } from "@/server/game";
import { breedingView, buy, coverMare, foalAndName, listForSale, marketView, MAX_STUD_FEE, packsView, pull, standAtStud } from "@/server/economy";
import { careAction, careerAction, facilitiesView, facilityAction, graduateAction, horseLifeView, nurseryView, savePlanAction, trainAction, vetAction } from "@/server/horseLife";
import { cupView, leagueView, runCup } from "@/server/competition";
import { createChapterRace, storyView } from "@/server/story";
import { sponsorAction, sponsorView } from "@/server/sponsor";
import { foundStable } from "@/server/founding";
import type { Session } from "@/server/session";
import type { RaceDayOffer, RaceSummary, StableHorse } from "@/lib/types";
import type { Cohort } from "./config";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** UTC offsets (minutes, November, no DST) of the timezones agents are spread over. */
const TIMEZONES: readonly [string, number][] = [
  ["Europe/London", 0],
  ["Europe/Berlin", 60],
  ["America/New_York", -300],
  ["America/Los_Angeles", -480],
  ["Australia/Sydney", 660],
];

/** Per-agent counters the metrics read alongside the database. */
export interface AgentStats {
  visits: number;
  liveEntries: number;
  storyRaces: number;
  cupRuns: number;
  careSessions: number;
  trainingSessions: number;
  trainingInjuries: number;
  vetTreatments: number;
  refills: number;
  facilities: number;
  packsFree: number;
  packsPaid: number;
  covers: number;
  foaled: number;
  studStands: number;
  listings: number;
  purchases: number;
  retired: number;
  legacy: number;
  fqEntries: number;
  wfEntries: number;
  /** Live entries that bought race-day extras or a jockey, and the credits they spent. */
  raceDayEntries: number;
  raceDaySpend: number;
  /** Farmer channels: credits passed alt -> main. */
  washStudFees: number;
  washMarket: number;
  /** Races sponsored and the credits spent on them. */
  sponsorships: number;
  sponsorSpend: number;
  /** Refused actions by DomainError code. */
  refused: Record<string, number>;
}

function emptyStats(): AgentStats {
  return {
    visits: 0, liveEntries: 0, storyRaces: 0, cupRuns: 0, careSessions: 0, trainingSessions: 0, trainingInjuries: 0, vetTreatments: 0, refills: 0,
    facilities: 0, packsFree: 0, packsPaid: 0, covers: 0, foaled: 0, studStands: 0, listings: 0, purchases: 0, retired: 0, legacy: 0, fqEntries: 0,
    wfEntries: 0, raceDayEntries: 0, raceDaySpend: 0, washStudFees: 0, washMarket: 0, sponsorships: 0, sponsorSpend: 0, refused: {},
  };
}

export interface Agent {
  index: number;
  cohort: Cohort;
  name: string;
  accountId: string;
  stableId: string;
  timezone: string;
  rng: gc.Rng;
  /** Visit times as minutes after UTC midnight (before the daily jitter). */
  visitMinutes: number[];
  /** Chance of skipping a whole day (casual players drop in and out). */
  skipPermille: number;
  /** Farmer group and role. */
  group: number | null;
  role: "main" | "alt" | null;
  detected: boolean;
  stats: AgentStats;
}

export interface UnexpectedError {
  atMs: number;
  agent: string;
  action: string;
  message: string;
}

/** Shared state of one run: the database, every agent and the error log. */
export class World {
  readonly agents: Agent[] = [];
  readonly errors: UnexpectedError[] = [];
  /** Actions attempted, by name (for the report's activity table). */
  readonly actions: Record<string, number> = {};

  constructor(
    readonly db: Db,
    readonly seed: string,
  ) {}

  /** A fresh session, like requireSession() gives each request (licence level, facilities). */
  async session(a: Agent): Promise<Session> {
    return { accountId: a.accountId, stable: await stableOf(this.db, a.accountId) };
  }

  /**
   * Runs one player action. A DomainError (the server refusing, e.g. "no entries left") is
   * counted against the agent and yields null; any other error is logged as unexpected.
   */
  async act<T>(a: Agent, action: string, now: Date, fn: () => Promise<T>): Promise<T | null> {
    this.actions[action] = (this.actions[action] ?? 0) + 1;
    try {
      return await fn();
    } catch (e) {
      if (e instanceof DomainError) {
        const k = `${action}:${e.code}`;
        a.stats.refused[k] = (a.stats.refused[k] ?? 0) + 1;
        return null;
      }
      const message = e instanceof Error ? `${e.message}${e.cause ? ` <- ${String((e.cause as Error).message ?? e.cause)}` : ""}` : String(e);
      this.errors.push({ atMs: now.getTime(), agent: a.name, action, message });
      return null;
    }
  }

  key(a: Agent, purpose: string, now: Date): string {
    return `h${a.index}-${purpose}-${now.getTime().toString(36)}`;
  }
}

// ---------------------------------------------------------------------------
// Founding
// ---------------------------------------------------------------------------

const SILK_COLOURS = ["#1f4e9c", "#8e2323", "#2e7d32", "#f3e7c9", "#d9a441", "#4a148c", "#263238", "#e65100"];
const PATTERNS = ["solid", "hoops", "stripes", "chevron", "diamonds", "sash", "quartered", "stars"];
const NAME_A = ["Copper", "Hollow", "Larch", "Meadow", "Raven", "Summer", "Thorn", "Willow", "Ash", "Brook", "Cedar", "Fern"];
const NAME_B = ["Gate", "Lane", "Ridge", "Downs", "Field", "Yard", "Farm", "Stud", "Park", "Barn"];

function visitPlan(cohort: Cohort, role: "main" | "alt" | null, rng: gc.Rng, offsetMin: number): number[] {
  const local = (h: number) => (((Math.round(h * 60) - offsetMin) % 1440) + 1440) % 1440;
  if (cohort === "casual") return [local(18 + rng.int(5) + rng.int(60) / 60)];
  if (cohort === "breeder") return [local(8 + rng.int(2)), local(13 + rng.int(2)), local(20 + rng.int(2))];
  if (cohort === "farmer" && role === "alt") return [local(9 + rng.int(3)), local(19 + rng.int(3))];
  // grinders and farmer mains: every two hours from 07:00 to 23:00 local
  const first = 7 + rng.int(60) / 60;
  return Array.from({ length: 9 }, (_, i) => local(first + 2 * i));
}

/** Founds a stable through the same path as POST /api/account (founding.ts). */
export async function foundAgent(world: World, input: { index: number; cohort: Cohort; group: number | null; role: "main" | "alt" | null; detected: boolean; now: Date }): Promise<Agent> {
  const rng = new gc.Rng(gc.seedFrom("season-harness", world.seed, "agent", input.index));
  const [timezone, offset] = TIMEZONES[rng.int(TIMEZONES.length)]!;
  const name = `${rng.pick(NAME_A)} ${rng.pick(NAME_B)} ${input.index + 1}`;
  const silks = { pattern: rng.pick(PATTERNS), primary: rng.pick(SILK_COLOURS), secondary: rng.pick(SILK_COLOURS), cap: rng.pick(SILK_COLOURS) };
  const acc = await foundStable(world.db, { stableName: name, silks, timezone, inviteCode: null, now: input.now });
  const agent: Agent = {
    index: input.index,
    cohort: input.cohort,
    name,
    accountId: acc.accountId,
    stableId: acc.stableId,
    timezone,
    rng,
    visitMinutes: visitPlan(input.cohort, input.role, rng, offset).sort((a, b) => a - b),
    skipPermille: input.cohort === "casual" ? 150 : input.cohort === "breeder" ? 50 : 0,
    group: input.group,
    role: input.role,
    detected: input.detected,
    stats: emptyStats(),
  };
  // A detected farmer group shares one wallet (the signal betaMoney records on wallet link).
  if (input.detected && input.group !== null) {
    await recordAccountSignal(world.db, { accountId: acc.accountId, kind: "wallet", value: `0x${gc.sha256Hex(`farm-group-${input.group}`).slice(0, 40)}` });
  }
  return agent;
}

/** Today's visit instants for an agent (jittered ±20 minutes; empty when the agent skips the day). */
export function visitsOn(world: World, a: Agent, dayStartMs: number): number[] {
  // Its own stream per (agent, day): the schedule never shifts when a decision draws more.
  const rng = new gc.Rng(gc.seedFrom("season-harness", world.seed, "visits", a.index, dayStartMs));
  if (a.skipPermille && rng.chance(a.skipPermille)) return [];
  return a.visitMinutes.map((m) => dayStartMs + Math.max(0, Math.min(1439, m + rng.range(-20, 20))) * MIN);
}

// ---------------------------------------------------------------------------
// Shared routines
// ---------------------------------------------------------------------------

interface VisitCtx {
  world: World;
  a: Agent;
  now: Date;
  /** First and last visit of the agent's day (daily chores run once). */
  first: boolean;
  last: boolean;
}

async function careAll(c: VisitCtx, s: Session, horses: { id: string }[]): Promise<void> {
  for (const h of horses) {
    const r = await c.world.act(c.a, "care", c.now, () => careAction(c.world.db, s, h.id, {}, c.now));
    if (r?.counted) c.a.stats.careSessions++;
  }
  const n = await c.world.act(c.a, "nursery", c.now, () => nurseryView(c.world.db, s, c.now));
  for (const g of n?.graduates ?? []) await c.world.act(c.a, "graduate", c.now, () => graduateAction(c.world.db, s, g.id, c.now));
}

async function dailyCup(c: VisitCtx, s: Session): Promise<void> {
  const v = await c.world.act(c.a, "cup_view", c.now, () => cupView(c.world.db, s, c.now));
  const horse = v && !v.mine ? v.horses?.find((h) => !h.block) : undefined;
  if (!horse) return;
  if (await c.world.act(c.a, "cup_run", c.now, () => runCup(c.world.db, s, { horseId: horse.id }, c.now))) c.a.stats.cupRuns++;
}

/** Up to `max` first wins in the current Story chapter (instant races, Quick Pick horse). */
async function storyRaces(c: VisitCtx, s: Session, max: number): Promise<void> {
  for (let i = 0; i < max; i++) {
    const v = await c.world.act(c.a, "story_view", c.now, () => storyView(c.world.db, s, c.now));
    const chapter = v?.chapters.find((ch) => ch.unlocked && !ch.complete);
    const race = chapter?.races.find((r) => !r.won && r.bestHorse);
    if (!race) return;
    const ok = await c.world.act(c.a, "story_race", c.now, () => createChapterRace(c.world.db, s, { raceKey: race.key, instant: true }, c.now));
    if (!ok) return;
    c.a.stats.storyRaces++;
  }
}

async function freePack(c: VisitCtx, s: Session): Promise<void> {
  const v = await c.world.act(c.a, "packs_view", c.now, () => packsView(c.world.db, s, c.now));
  if (!v?.paddock.freeAvailable || v.stalls.free <= 0) return;
  if (await c.world.act(c.a, "pack_free", c.now, () => pull(c.world.db, s, { packType: "paddock", free: true, key: c.world.key(c.a, "free", c.now) }, c.now))) c.a.stats.packsFree++;
}

async function paidPack(c: VisitCtx, s: Session): Promise<boolean> {
  const v = await c.world.act(c.a, "packs_view", c.now, () => packsView(c.world.db, s, c.now));
  if (!v?.paddock.enabled) return false;
  const ok = await c.world.act(c.a, "pack_paid", c.now, () => pull(c.world.db, s, { packType: "paddock", free: false, key: c.world.key(c.a, "paid", c.now) }, c.now));
  if (ok) c.a.stats.packsPaid++;
  return !!ok;
}

async function quickPicks(c: VisitCtx, s: Session, max: number): Promise<number> {
  let n = 0;
  for (let i = 0; i < max; i++) {
    const pick = await c.world.act(c.a, "live_quick_pick", c.now, () => quickPickLive(c.world.db, s, c.now));
    if (!pick) break;
    n++;
    c.a.stats.liveEntries++;
  }
  return n;
}

const isQualifier = (r: Pick<RaceSummary, "name">) => r.name.includes("Feature Qualifier");
const isWeekendFeature = (r: Pick<RaceSummary, "name">) => r.name.includes("Weekend Feature");

/** What a stable buys on race day for one entry, given the sheet's offer and its credits. */
type RaceDayPolicy = (race: RaceSummary, horse: StableHorse, offer: RaceDayOffer, credits: number) => gc.RaceDayChoice;

/** Credits a choice costs on this sheet. */
function raceDayCost(offer: RaceDayOffer, choice: gc.RaceDayChoice): number {
  return offer.extras.filter((x) => choice.extras.includes(x.key)).reduce((a, x) => a + x.price, 0) + (offer.jockeys.find((j) => j.key === choice.jockey)?.price ?? 0);
}

/** Never spend the last RACE_DAY_RESERVE credits on extras: drop the jockey first, then everything. */
const RACE_DAY_RESERVE = 1_500;
function affordable(offer: RaceDayOffer, choice: gc.RaceDayChoice, credits: number): gc.RaceDayChoice {
  if (raceDayCost(offer, choice) <= credits - RACE_DAY_RESERVE) return choice;
  const noJockey = { ...choice, jockey: "apprentice" as const };
  return raceDayCost(offer, noJockey) <= credits - RACE_DAY_RESERVE ? noJockey : gc.NO_RACE_DAY;
}

const offered = (offer: RaceDayOffer, k: gc.RaceExtraKey) => offer.extras.some((x) => x.key === k);

/**
 * Grinders on race day: for a Feature Qualifier or the Weekend Feature, the works (a vet check,
 * shoes when the going calls for them, physio for a tired horse, a top jockey when they can
 * afford one, else a journeyman); in an ordinary race, physio for a tired horse half the time.
 */
function grinderRaceDay(rng: gc.Rng): RaceDayPolicy {
  return (race, horse, offer, credits) => {
    const tired = horse.fatigue > gc.TIRED_THRESHOLD;
    if (!isQualifier(race) && !isWeekendFeature(race)) {
      return tired && offered(offer, "physio") && rng.chance(500) ? affordable(offer, { extras: ["physio"], jockey: "apprentice" }, credits) : gc.NO_RACE_DAY;
    }
    const extras: gc.RaceExtraKey[] = ["vet_check"];
    for (const k of ["soft_shoes", "firm_shoes"] as const) if (offered(offer, k)) extras.push(k);
    if (tired) extras.push("physio");
    return affordable(offer, { extras, jockey: credits > 8_000 ? "top" : "journeyman" }, credits);
  };
}

/** Casuals, the odd time they use the sheet: a vet check, and physio for a tired horse. */
const casualRaceDay: RaceDayPolicy = (_race, horse, offer, credits) =>
  affordable(offer, { extras: horse.fatigue > gc.TIRED_THRESHOLD ? ["physio", "vet_check"] : ["vet_check"], jockey: "apprentice" }, credits);

/**
 * The grinder's entry sheet: every free, fit horse goes into the race that suits it best among
 * the next few hours of the card (entryOptions' fit loss, the same number the entry sheet
 * shows). Feature Qualifiers and the Weekend Feature take any eligible horse first.
 */
async function smartEntries(c: VisitCtx, s: Session, view: SheetView, opts: SheetOpts): Promise<void> {
  const left = await sheetEntries(c, s, view, opts);
  // Nothing on the next few hours suits a fresh horse well: let Live Quick Pick find it a race.
  if (left > 0) await quickPicks(c, s, Math.min(left, 2));
}

type SheetView = { horses: StableHorse[]; entries: { balance: number }; credits?: number };
type SheetOpts = { lookaheadMs: number; tiredOk: boolean; raceDay?: RaceDayPolicy; maxEntries?: number };

/** Returns how many free, fit horses are still without a race. */
async function sheetEntries(c: VisitCtx, s: Session, view: SheetView, opts: SheetOpts): Promise<number> {
  const free = new Map(view.horses.filter((h) => h.careerStatus === "racing" && !h.block && h.ranToday < RULES.liveStartsPerDay && (opts.tiredOk || h.condition !== "tired")).map((h) => [h.id, h]));
  if (!free.size) return 0;
  let balance = view.entries.balance;
  let credits = view.credits ?? 0;
  let made = 0;
  const list = await c.world.act(c.a, "race_list", c.now, () => raceList(c.world.db, c.now, s.stable.id, { upcoming: 64, recent: 0 }));
  const horizon = c.now.getTime() + opts.lookaheadMs;
  const card = (list?.upcoming ?? []).filter((r) => r.phase === "open" && r.mine === 0 && r.entriesCloseAtMs > c.now.getTime() + MIN);
  const features = card.filter((r) => isQualifier(r) || isWeekendFeature(r));
  const regular = card.filter((r) => !isQualifier(r) && !isWeekendFeature(r) && r.postTimeMs <= horizon);
  for (const race of [...features, ...regular]) {
    if (!free.size || balance < race.entryCost || made >= (opts.maxEntries ?? Infinity)) break;
    const sheet = await c.world.act(c.a, "entry_options", c.now, () => entryOptions(c.world.db, s, race.id, c.now));
    if (!sheet) continue;
    const special = isQualifier(race) || isWeekendFeature(race);
    // Fit first, then freshness (Quick Pick's own trade-off: 15 a run today, 40 when tired).
    const cost = (o: { horseId: string; fitLoss: number }) => o.fitLoss + free.get(o.horseId)!.ranToday * 15 + (free.get(o.horseId)!.condition === "tired" ? 40 : 0);
    const fits = sheet.options.filter((o) => o.reason === null && free.has(o.horseId) && (special || o.fitLoss <= 25)).sort((x, y) => cost(x) - cost(y));
    const best = fits[0];
    if (!best) continue;
    const horse = free.get(best.horseId)!;
    const raceDay = opts.raceDay ? opts.raceDay(race, horse, sheet.raceDay, credits - race.entryFee) : gc.NO_RACE_DAY;
    const extrasCost = raceDayCost(sheet.raceDay, raceDay);
    const entered = await c.world.act(c.a, "live_enter", c.now, () => enterLive(c.world.db, s, race.id, best.horseId, { tactic: horse.horse.style, intensity: "normal" }, c.now, raceDay));
    if (!entered) continue;
    free.delete(best.horseId);
    balance -= race.entryCost;
    credits -= race.entryFee + extrasCost;
    made++;
    if (extrasCost > 0) {
      c.a.stats.raceDayEntries++;
      c.a.stats.raceDaySpend += extrasCost;
    }
    c.a.stats.liveEntries++;
    if (isQualifier(race)) c.a.stats.fqEntries++;
    if (isWeekendFeature(race)) c.a.stats.wfEntries++;
  }
  return balance > 0 ? free.size : 0;
}

/**
 * Sponsor a race (the prestige sink): with more than `threshold` credits, a `permille` chance
 * per visit of sponsoring one race the stable can afford while keeping `threshold / 2` back.
 * The pick is uniform: a random day of the week ahead, then a random race on sale that day.
 */
async function maybeSponsor(c: VisitCtx, s: Session, credits: number, threshold: number, permille: number): Promise<void> {
  if (credits <= threshold || !c.a.rng.chance(permille)) return;
  const first = await c.world.act(c.a, "sponsor_view", c.now, () => sponsorView(c.world.db, s, c.now));
  if (!first || first.rules.upcoming >= first.rules.maxUpcoming) return;
  // a random day of the week ahead, then a random race on it that leaves half the threshold
  const day = first.days.filter((d) => d.onSale > 0);
  if (!day.length) return;
  const date = c.a.rng.pick(day).date;
  const v = date === first.date ? first : await c.world.act(c.a, "sponsor_view", c.now, () => sponsorView(c.world.db, s, c.now, { date }));
  const options = (v?.slots ?? []).filter((x) => x.block === null && credits - x.price >= threshold / 2);
  if (!options.length) return;
  const pick = c.a.rng.pick(options);
  const r = await c.world.act(c.a, "sponsor", c.now, () => sponsorAction(c.world.db, s, { slot: pick.slot, key: c.world.key(c.a, `sponsor-${pick.slot}`, c.now) }, c.now));
  if (!r) return;
  c.a.stats.sponsorships++;
  c.a.stats.sponsorSpend += r.price;
}

/** Light work only (open to yearlings), cycled to fill the plan's slots. */
const LIGHT_PLAN = ["gate_practice", "swimming", "rest", "swimming"];

/**
 * One session for each horse that can use it, the way the training tab offers it
 * (horseLifeView: the plan's next workout, blocked reasons). Yearlings get a light-work plan
 * first (the default plan opens with speed work, which they can't do). Tired horses rest.
 */
async function train(c: VisitCtx, s: Session, horses: StableHorse[], reserve: number, credits: number): Promise<void> {
  for (const h of horses) {
    if (h.careerStatus !== "racing" || h.lockedRaceId || h.injury || h.condition === "tired" || credits < reserve) continue;
    if (h.stage === "foal" || h.stage === "weanling") continue;
    const life = await c.world.act(c.a, "horse_life", c.now, () => horseLifeView(c.world.db, s, h.id, c.now));
    // A "rest" next is no work to buy (and with a Trainer's 4th slot on a 3-slot plan the server
    // refuses it as week_full although the tab offers it).
    if (!life?.training.available || !life.training.nextWorkout || life.training.nextWorkout === "rest") continue;
    if (life.training.lightOnly && life.training.plan.some((w) => w !== "rest" && !life.training.workouts.find((x) => x.key === w)?.allowed)) {
      const slots = Array.from({ length: life.training.slots }, (_, i) => LIGHT_PLAN[i % LIGHT_PLAN.length]!);
      if (!(await c.world.act(c.a, "training_plan", c.now, () => savePlanAction(c.world.db, s, h.id, slots, c.now)))) continue;
    }
    const r = await c.world.act(c.a, "train", c.now, () => trainAction(c.world.db, s, h.id, { expectedSession: life.training.sessionsUsed }, c.now));
    if (!r?.ran) continue;
    c.a.stats.trainingSessions++;
    credits -= r.cost;
    if (r.injured) c.a.stats.trainingInjuries++;
  }
}

async function vets(c: VisitCtx, s: Session, horses: StableHorse[]): Promise<void> {
  for (const h of horses.filter((x) => x.injury && x.careerStatus === "racing")) {
    const r = await c.world.act(c.a, "vet", c.now, () => vetAction(c.world.db, s, h.id, c.now));
    if (r?.treated) c.a.stats.vetTreatments++;
  }
}

/** Buys the next level of the first facility on the wish list it can afford above `reserve`. */
async function upgrade(c: VisitCtx, s: Session, wish: readonly string[], reserve: number): Promise<void> {
  const v = await c.world.act(c.a, "facilities_view", c.now, () => facilitiesView(c.world.db, s));
  if (!v) return;
  for (const key of wish) {
    const item = v.items.find((i) => i.key === key);
    if (!item || item.nextCost === null || v.credits - item.nextCost < reserve) continue;
    const r = await c.world.act(c.a, "facility", c.now, () => facilityAction(c.world.db, s, item.key as Parameters<typeof facilityAction>[2], item.level + 1, c.now));
    if (r?.bought) c.a.stats.facilities++;
    return;
  }
}

/** Retires mares that should breed this season and covers every mare that can (best Club or player stud it can afford). */
async function breedMares(c: VisitCtx, s: Session, opts: { retireMares: boolean; feeCap: number; preferSireOf?: string }): Promise<void> {
  let v = await c.world.act(c.a, "breeding_view", c.now, () => breedingView(c.world.db, s, c.now));
  if (!v) return;
  // Mares racing with no path to 25 starts this season: retire them to the paddock to breed now.
  if (opts.retireMares) {
    for (const m of v.mares.filter((x) => x.block === "not_breeding_eligible" && x.careerStatus === "racing" && x.stage !== "foal" && x.stage !== "weanling" && x.stage !== "yearling")) {
      if (await c.world.act(c.a, "retire", c.now, () => careerAction(c.world.db, s, m.id, "retire", c.now))) c.a.stats.retired++;
    }
    v = (await c.world.act(c.a, "breeding_view", c.now, () => breedingView(c.world.db, s, c.now))) ?? v;
  }
  let credits = v.credits;
  for (const mare of v.mares.filter((m) => m.block === null)) {
    const studs = v.studs.filter((x) => x.block === null && x.studFee <= opts.feeCap && x.studFee + v!.baseFee <= credits);
    const own = v.stallions.filter((x) => x.block === null);
    const preferred = opts.preferSireOf ? studs.find((x) => x.id === opts.preferSireOf) : undefined;
    // Pick by the sire's racing class: rating first, then the cheaper fee.
    const sire = preferred ?? [...studs, ...own.map((o) => ({ ...o, studFee: 0, club: false }))].sort((x, y) => y.rating - x.rating || x.studFee - y.studFee)[0];
    if (!sire || credits < v.baseFee + sire.studFee) continue;
    const r = await c.world.act(c.a, "cover", c.now, () => coverMare(c.world.db, s, { sireId: sire.id, damId: mare.id, key: c.world.key(c.a, `cover-${mare.id.slice(0, 8)}`, c.now) }, c.now));
    if (!r) continue;
    c.a.stats.covers++;
    credits -= v.baseFee + sire.studFee;
  }
}

async function foalDue(c: VisitCtx, s: Session): Promise<void> {
  const v = await c.world.act(c.a, "breeding_view", c.now, () => breedingView(c.world.db, s, c.now));
  for (const p of v?.pregnancies ?? []) {
    if (p.status !== "carrying" || p.dueAtMs > c.now.getTime()) continue;
    if (await c.world.act(c.a, "foal", c.now, () => foalAndName(c.world.db, s, { pregnancyId: p.id }, c.now))) c.a.stats.foaled++;
  }
}

/**
 * Stands the best eligible stallion at stud at `fee`. With `retireColtFrom` set, a racing colt
 * with at least that many starts (the most raced one) is retired to stud first when there is none.
 */
async function standStallion(c: VisitCtx, s: Session, fee: number, retireColtFrom: number | null): Promise<string | null> {
  const v = await c.world.act(c.a, "breeding_view", c.now, () => breedingView(c.world.db, s, c.now));
  if (!v) return null;
  const standing = v.stallions.find((x) => x.studFee !== null && x.careerStatus !== "pasture");
  if (standing) return standing.id;
  let candidate = v.stallions.filter((x) => x.careerStatus === "retired" && x.used < x.lifetime).sort((a, b) => b.rating - a.rating)[0];
  if (!candidate && retireColtFrom !== null) {
    const colt = v.stallions
      .filter((x) => x.careerStatus === "racing" && x.starts >= retireColtFrom && (x.stage === "juvenile" || x.stage === "prime" || x.stage === "veteran"))
      .sort((a, b) => b.starts - a.starts)[0];
    if (colt && (await c.world.act(c.a, "retire", c.now, () => careerAction(c.world.db, s, colt.id, "retire", c.now)))) {
      c.a.stats.retired++;
      candidate = colt;
    }
  }
  if (!candidate) return null;
  const ok = await c.world.act(c.a, "stand_at_stud", c.now, () => standAtStud(c.world.db, s, { horseId: candidate.id, fee }));
  if (ok === null) return null;
  c.a.stats.studStands++;
  return candidate.id;
}

/** Lists up to `max` tradeable horses (the market's own lock and seller checks) at `priceOf`. */
async function sellSurplus(c: VisitCtx, s: Session, pick: (h: { id: string; rating: number; careerStatus: string; stage: string }) => boolean, priceOf: (h: { appraisal: number; floor: number; ceiling: number }) => number, max: number): Promise<void> {
  const v = await c.world.act(c.a, "market_view", c.now, () => marketView(c.world.db, s, c.now));
  if (!v?.seller.ok) return;
  let n = 0;
  for (const h of v.horses) {
    if (n >= max) break;
    if (h.lock !== null || h.listingId || !pick(h)) continue;
    const price = Math.max(h.floor, Math.min(h.ceiling, Math.round(priceOf(h))));
    if (await c.world.act(c.a, "market_list", c.now, () => listForSale(c.world.db, s, { horseId: h.id, price, days: 7 }, c.now))) {
      c.a.stats.listings++;
      n++;
    }
  }
}

/** Buys the best listing (racing age first, then rating) priced within `maxOverAppraisal` of its appraisal that it can afford above `reserve`. */
async function shop(c: VisitCtx, s: Session, reserve: number, maxOverAppraisal: number): Promise<void> {
  const v = await c.world.act(c.a, "market_view", c.now, () => marketView(c.world.db, s, c.now));
  if (!v || v.stalls.free <= 0) return;
  const pick = v.listings
    .filter((l) => l.price <= l.appraisal * maxOverAppraisal && v.credits - l.price >= reserve && l.careerStatus === "racing")
    .sort((a, b) => Number(RACING_STAGES.has(b.stage)) - Number(RACING_STAGES.has(a.stage)) || b.rating - a.rating || a.price - b.price)[0];
  if (!pick) return;
  if (await c.world.act(c.a, "market_buy", c.now, () => buy(c.world.db, s, pick.listingId, c.now))) c.a.stats.purchases++;
}

const RACING_STAGES = new Set(["juvenile", "prime", "veteran"]);

/** When the stalls are full: retired horses with every breeding used go to the Legacy Farm (broodmares are kept). */
async function makeRoom(c: VisitCtx, s: Session): Promise<void> {
  const v = await c.world.act(c.a, "breeding_view", c.now, () => breedingView(c.world.db, s, c.now));
  if (!v || v.stalls.used < v.stalls.slots) return;
  const spare = [...v.mares, ...v.stallions].find((h) => h.careerStatus === "retired" && h.studFee === null && (h.used >= h.lifetime || h.block === "lifetime_limit"));
  if (spare && (await c.world.act(c.a, "legacy", c.now, () => careerAction(c.world.db, s, spare.id, "legacy", c.now)))) c.a.stats.legacy++;
}

// ---------------------------------------------------------------------------
// Cohort visits
// ---------------------------------------------------------------------------

/** One visit of one agent at `now`. Mains are passed to their alts for the farmer channels. */
export async function visit(world: World, a: Agent, now: Date, first: boolean, last: boolean, main: Agent | null): Promise<void> {
  a.stats.visits++;
  const c: VisitCtx = { world, a, now, first, last };
  const s = await world.session(a);
  // Opening the app: the home/stable payload (drives the card, the day-2 gift foal).
  const view = await world.act(a, "player_view", now, () => playerView(world.db, s, now));
  if (!view) return;
  const horses = view.horses;
  switch (a.cohort) {
    case "casual":
      await careAll(c, s, horses);
      if (a.rng.chance(700)) await dailyCup(c, s);
      if (a.rng.chance(500)) await storyRaces(c, s, 1);
      // Now and then a casual opens the entry sheet instead and adds a vet check (rarely more).
      if (a.rng.chance(CASUAL_SHEET_PERMILLE)) await sheetEntries(c, s, view, { lookaheadMs: 2 * HOUR, tiredOk: false, raceDay: casualRaceDay, maxEntries: 1 });
      await quickPicks(c, s, 1 + a.rng.int(3));
      await freePack(c, s);
      await maybeSponsor(c, s, view.credits, 12_000, 150);
      return;
    case "grinder":
      return grinderVisit(c, s, view);
    case "breeder":
      return breederVisit(c, s, view);
    case "farmer":
      return a.role === "main" ? mainVisit(c, s, view) : altVisit(c, s, view, main);
  }
}

type View = NonNullable<Awaited<ReturnType<typeof playerView>>>;

/** Chance per visit (permille) that a casual enters from the sheet with race-day extras. */
const CASUAL_SHEET_PERMILLE = 120;

async function fresh(c: VisitCtx, s: Session): Promise<View | null> {
  return c.world.act(c.a, "player_view", c.now, () => playerView(c.world.db, s, c.now));
}

async function grinderVisit(c: VisitCtx, s: Session, view: View): Promise<void> {
  const { a, now, world } = c;
  if (c.first) {
    await careAll(c, s, view.horses);
    await vets(c, s, view.horses);
    await dailyCup(c, s);
    await world.act(a, "league_view", now, () => leagueView(world.db, s, now));
    await freePack(c, s);
    await upgrade(c, s, ["entries", "trainer", "stableHand", "stalls"], 3_000);
    if (a.rng.chance(300)) await shop(c, s, 2_500, 1.15);
    // Morning work, after the night's rest: one session for every horse that isn't tired.
    const mv = (await fresh(c, s)) ?? view;
    await train(c, s, mv.horses, 1_500, mv.credits);
    // Story licences open the better Live classes: two first-win attempts a day while the
    // licence is below Features (Story runs count towards a horse's starts per day).
    if (s.stable.licenceLevel < 4) await storyRaces(c, s, 2);
  }
  let v = (await fresh(c, s)) ?? view;
  // Grinders use their entries: tired horses run too (fresh ones are preferred).
  await smartEntries(c, s, v, { lookaheadMs: 3 * HOUR, tiredOk: true, raceDay: grinderRaceDay(a.rng) });
  if (c.last) {
    v = (await fresh(c, s)) ?? v;
    if (v.entries.balance < RULES.entryRefillBelow && v.credits > 2_000) {
      if (await world.act(a, "refill", now, () => refill(world.db, s, now))) a.stats.refills++;
      v = (await fresh(c, s)) ?? v;
      await smartEntries(c, s, v, { lookaheadMs: 6 * HOUR, tiredOk: true, raceDay: grinderRaceDay(a.rng) });
    }
    // a rich grinder now and then puts the stable's name on a race
    await maybeSponsor(c, s, ((await fresh(c, s)) ?? v).credits, 30_000, 100);
  }
}

async function breederVisit(c: VisitCtx, s: Session, view: View): Promise<void> {
  const { a } = c;
  if (c.first) {
    await careAll(c, s, view.horses);
    await dailyCup(c, s);
    await freePack(c, s);
    await foalDue(c, s);
    await breedMares(c, s, { retireMares: true, feeCap: 2_000 });
    // A colt goes to stud once he has shown something on the track.
    await standStallion(c, s, 600 + 100 * a.rng.int(10), 8);
    await makeRoom(c, s);
    await upgrade(c, s, ["stalls", "stableHand"], 4_000);
    // Tradeable stock to sell on: paid Paddock foals aren't Club-bred (free-pack and starter horses are).
    if (((await fresh(c, s))?.credits ?? 0) > 5_000) await paidPack(c, s);
  }
  await quickPicks(c, s, 2);
  if (c.last) {
    await foalDue(c, s);
    // Surplus: every tradeable youngster beyond the two best racers, at the appraisal plus a margin.
    await sellSurplus(c, s, (h) => h.careerStatus === "racing", (h) => h.appraisal * (1 + a.rng.int(30) / 100), 2);
    if (a.rng.chance(200)) await storyRaces(c, s, 1);
  }
}

async function mainVisit(c: VisitCtx, s: Session, view: View): Promise<void> {
  if (c.first) {
    await careAll(c, s, view.horses);
    await vets(c, s, view.horses);
    await dailyCup(c, s);
    await freePack(c, s);
    // The wash stallion: a starter colt retired to stud on day one.
    await standStallion(c, s, 0, 0);
    // Horses the alts can buy at the ceiling: paid Paddock foals are tradeable at once.
    const credits = (await fresh(c, s))?.credits ?? 0;
    if (credits > 4_000) await paidPack(c, s);
    await sellSurplus(c, s, (h) => h.stage === "foal" || h.stage === "weanling", (h) => h.ceiling, 2);
    // Buy what the alts list at the floor.
    await shop(c, s, 0, 0.75);
    const fv = (await fresh(c, s)) ?? view;
    await train(c, s, fv.horses, 1_500, fv.credits);
  }
  if (c.first && s.stable.licenceLevel < 4) await storyRaces(c, s, 2);
  const v = (await fresh(c, s)) ?? view;
  await smartEntries(c, s, v, { lookaheadMs: 3 * HOUR, tiredOk: true });
}

async function altVisit(c: VisitCtx, s: Session, view: View, main: Agent | null): Promise<void> {
  await careAll(c, s, view.horses);
  await dailyCup(c, s);
  if (c.first && s.stable.licenceLevel < 2) await storyRaces(c, s, 1);
  // The evening visit passes value to the main first, while the mares aren't entered in races.
  if (c.last && main) await passToMain(c, s, main);
  await quickPicks(c, s, 4);
  await freePack(c, s);
}

async function passToMain(c: VisitCtx, s: Session, main: Agent): Promise<void> {
  const { a, now, world } = c;
  // Channel 1: the main's stallion covers the alt's mare for whatever the alt holds.
  const ms = await world.session(main);
  const before = (await fresh(c, s))?.credits ?? 0;
  const sire = await standStallion({ ...c, a: main }, ms, 0, 0);
  if (sire && before > RULES.breedingBaseFee + 500) {
    const fee = Math.min(MAX_STUD_FEE, before - RULES.breedingBaseFee - 100);
    await world.act(main, "stand_at_stud", now, () => standAtStud(world.db, ms, { horseId: sire, fee }));
    await breedMares(c, s, { retireMares: true, feeCap: MAX_STUD_FEE, preferSireOf: sire });
    await world.act(main, "stand_at_stud", now, () => standAtStud(world.db, ms, { horseId: sire, fee: 0 }));
  }
  const afterStud = (await fresh(c, s))?.credits ?? 0;
  if (before - afterStud > RULES.breedingBaseFee) a.stats.washStudFees += before - afterStud - RULES.breedingBaseFee;
  // Channel 2: buy the main's ceiling-priced foals.
  const m = await world.act(a, "market_view", now, () => marketView(world.db, s, now));
  const mainName = (await world.session(main)).stable.name;
  for (const l of m?.listings.filter((x) => x.sellerStableName === mainName) ?? []) {
    if ((m?.credits ?? 0) < l.price) continue;
    const r = await world.act(a, "market_buy", now, () => buy(world.db, s, l.listingId, now));
    if (r) {
      a.stats.purchases++;
      a.stats.washMarket += r.price;
    }
  }
  // Horses the other way: tradeable alt horses to the main at the floor.
  await sellSurplus(c, s, (h) => h.careerStatus === "racing" && h.stage !== "foal", (h) => h.floor, 1);
}

export { DAY, HOUR, MIN };
