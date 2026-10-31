/**
 * Horse life (Feature A): daily care on the player's LOCAL day, the weekly training plan and
 * player-triggered sessions, vet treatment, Pedigree Scan, foal graduation and stable
 * facilities (stalls, entry tiers, trainer, vet, stable hand).
 *
 * Every rule comes from @thoroughbred/game-core (recordCare, train, treatInjury, stallCost,
 * FACILITY_COSTS, ENTRY_TIER_COST ...); these services add locking, idempotency and the
 * double-entry ledger. Nothing here charges or harms a horse because time passed: care is
 * optional and missing a day only pauses growth.
 *
 * Idempotency:
 *   - care: one counted session per horse per local date (care_log unique (horse, day)); a
 *     repeat returns `counted: false` instead of failing;
 *   - training: the caller passes the session number it saw (`expectedSession`); a double
 *     tap finds the counter already moved and is a no-op. The ledger key is per (horse,
 *     week, session);
 *   - vet: once per injury per local date (ledger key);
 *   - facilities: the caller passes the level it is buying (`toLevel`); buying a level
 *     that is already owned is a no-op.
 */
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { utcWeekStart } from "../crypto";
import { DomainError } from "../errors";
import { accounts, careLog, horses, ledgerTransactions, stables, trainingPlans, type HorseRow, type StableRow } from "../schema";
import { RULES, stageFor } from "../rules";
import { gc, isGenome, statePatch, toHorseState } from "../gameCore";
import type { Db, Executor, Tx } from "../types";
import { lockStableOf, recordPlayDay, stableOf } from "./accounts";
import { completeGoal } from "./dailyGoals";
import { localDate } from "./entries";
import { keptBy, lockKeptHorse, lockOwnedHorse } from "./horses";
import { getBalance, spendCreditsTx } from "./ledger";
import { logHorseEventTx } from "./horseLog";
import { audit, runTx } from "./tx";
import { sendMomentsTx } from "./moments";

// ---------------------------------------------------------------------------
// Facilities
// ---------------------------------------------------------------------------

/**
 * Stable hand: a one-off hire that cares for every horse in one tap ("Care for all"). It is a
 * convenience only: each horse still gets at most one counted session per local day, with the
 * feed game-core recommends. Not in game-core yet (decision taken in Feature A; see report).
 */
export const STABLE_HAND_COST = 2_500;

export type FacilityKey = "stalls" | "entries" | "trainer" | "vet" | "stableHand";
export const FACILITY_KEYS: readonly FacilityKey[] = ["stalls", "entries", "trainer", "vet", "stableHand"];

export interface FacilityLevels {
  trainer: number;
  vet: number;
  stableHand: number;
}

const int = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : lo);

/** Facility levels stored on the stable row (jsonb). */
export function facilityLevels(stable: Pick<StableRow, "facilities">): FacilityLevels {
  const f = (stable.facilities ?? {}) as Record<string, unknown>;
  return {
    trainer: int(f.trainer, 0, gc.FACILITY_COSTS.trainer.length),
    vet: int(f.vet, 0, gc.FACILITY_COSTS.vet.length),
    stableHand: int(f.stableHand, 0, 1),
  };
}

export interface FacilityOffer {
  key: FacilityKey;
  /** Current level (stalls: the stall count; entries: the tier). */
  level: number;
  minLevel: number;
  maxLevel: number;
  /** Cost of the next level in credits, or null when maxed. */
  nextCost: number | null;
}

/** Current level and next-level price of every facility (prices from game-core). */
export function facilityOffers(stable: Pick<StableRow, "facilities" | "stallSlots" | "entryAllowance">): FacilityOffer[] {
  const lv = facilityLevels(stable);
  const tier = Math.max(0, stable.entryAllowance - gc.ENTRY_DAILY_BASE);
  const stalls = stable.stallSlots;
  return [
    { key: "stalls", level: stalls, minLevel: gc.BASE_STALLS, maxLevel: gc.MAX_STALLS, nextCost: stalls < gc.MAX_STALLS ? gc.stallCost(stalls + 1) : null },
    { key: "entries", level: tier, minLevel: 0, maxLevel: gc.ENTRY_FACILITY_TIERS, nextCost: tier < gc.ENTRY_FACILITY_TIERS ? gc.ENTRY_TIER_COST[tier]! : null },
    { key: "trainer", level: lv.trainer, minLevel: 0, maxLevel: gc.FACILITY_COSTS.trainer.length, nextCost: gc.FACILITY_COSTS.trainer[lv.trainer] ?? null },
    { key: "vet", level: lv.vet, minLevel: 0, maxLevel: gc.FACILITY_COSTS.vet.length, nextCost: gc.FACILITY_COSTS.vet[lv.vet] ?? null },
    { key: "stableHand", level: lv.stableHand, minLevel: 0, maxLevel: 1, nextCost: lv.stableHand < 1 ? STABLE_HAND_COST : null },
  ];
}

export interface BuyFacilityResult {
  stable: StableRow;
  /** False when `toLevel` was already owned (a retry): nothing was charged. */
  bought: boolean;
  cost: number;
}

/** Buys the next level of a facility, paid in credits (burned). Idempotent by `toLevel`. */
export async function buyFacility(db: Db, input: { accountId: string; facility: FacilityKey; toLevel: number; now: Date }): Promise<BuyFacilityResult> {
  if (!FACILITY_KEYS.includes(input.facility)) throw new DomainError("INVALID_INPUT", "unknown facility");
  if (!Number.isInteger(input.toLevel)) throw new DomainError("INVALID_INPUT", "bad level");
  return runTx(db, async (tx) => {
    const stable = await lockStableOf(tx, input.accountId);
    const offer = facilityOffers(stable).find((o) => o.key === input.facility)!;
    if (input.toLevel <= offer.level) return { stable, bought: false, cost: 0 };
    if (input.toLevel !== offer.level + 1 || offer.nextCost === null || input.toLevel > offer.maxLevel) {
      throw new DomainError("INVALID_INPUT", offer.nextCost === null ? "that facility is fully upgraded" : "upgrade one level at a time");
    }
    const cost = offer.nextCost;
    const res = await spendCreditsTx(tx, {
      accountId: input.accountId,
      amount: cost,
      idempotencyKey: `facility:${stable.id}:${input.facility}:${input.toLevel}`,
      kind: input.facility === "stalls" ? "stall_slot" : "facility",
      memo: `${input.facility} level ${input.toLevel}`,
    });
    if (res.duplicate) return { stable, bought: false, cost: 0 };
    let patch: Partial<StableRow>;
    if (input.facility === "stalls") patch = { stallSlots: input.toLevel };
    else if (input.facility === "entries") patch = { entryAllowance: gc.dailyAllowance(input.toLevel), entryCap: gc.bankCap(input.toLevel) };
    else patch = { facilities: { ...((stable.facilities ?? {}) as Record<string, unknown>), [input.facility]: input.toLevel } };
    const [updated] = await tx.update(stables).set(patch).where(eq(stables.id, stable.id)).returning();
    await audit(tx, {
      actor: input.accountId,
      action: "stable.facility",
      entityType: "stable",
      entityId: stable.id,
      data: { facility: input.facility, from: offer.level, to: input.toLevel, cost },
    });
    return { stable: updated!, bought: true, cost };
  });
}

// ---------------------------------------------------------------------------
// Care (once per horse per LOCAL day)
// ---------------------------------------------------------------------------

export async function accountTimezone(ex: Executor, accountId: string): Promise<string> {
  const [a] = await ex.select({ tz: accounts.timezone }).from(accounts).where(eq(accounts.id, accountId));
  return a?.tz ?? "UTC";
}

/** The player's local calendar date (care day). */
export async function careDayOf(ex: Executor, accountId: string, now: Date): Promise<string> {
  return localDate(await accountTimezone(ex, accountId), now);
}

/** Latest care day per horse (null when never cared for). */
export async function lastCareDays(ex: Executor, horseIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!horseIds.length) return out;
  const rows = await ex
    .select({ horseId: careLog.horseId, day: careLog.day })
    .from(careLog)
    .where(inArray(careLog.horseId, horseIds))
    .orderBy(desc(careLog.day));
  for (const r of rows) if (!out.has(r.horseId)) out.set(r.horseId, r.day);
  return out;
}

export interface CareActions {
  feed?: string;
  groom?: boolean;
  turnout?: boolean;
}

export interface CareSessionResult {
  horse: HorseRow;
  /** False when this horse was already cared for today (nothing changed). */
  counted: boolean;
  day: string;
  stageBefore: string;
  stageAfter: string;
  /** The session that brought a yearling to racing age. */
  graduated: boolean;
  feed: string;
  /** Care quality of this session, permille (right feed 1000). */
  quality: number;
}

function vetAware(injury: gc.Injury | null, vetLevel: number): gc.Injury | null {
  return injury && injury.vetLevel < vetLevel ? { ...injury, vetLevel: Math.min(3, vetLevel) } : injury;
}

async function careTx(tx: Tx, accountId: string, horse: HorseRow, day: string, now: Date, actions: CareActions, vetLevel: number): Promise<CareSessionResult> {
  const stageBefore = horse.stage;
  const noop = (feed: string): CareSessionResult => ({ horse, counted: false, day, stageBefore, stageAfter: stageBefore, graduated: false, feed, quality: 0 });
  if (horse.careerStatus === "pasture") {
    // Legacy Farm horses are looked after by the farm; nothing to count.
    return noop(String(actions.feed ?? "maintenance"));
  }
  const last = (await lastCareDays(tx, [horse.id])).get(horse.id);
  // `>=` (not `===`): a timezone change can never yield a second session for the same day.
  if (last && last >= day) return noop(String(actions.feed ?? ""));
  const nowMs = now.getTime();
  const valid = isGenome(horse.genome);
  const state = valid ? { ...toHorseState(horse), care: { ...toHorseState(horse).care, lastCareDay: null } } : null;
  const requested = typeof actions.feed === "string" ? actions.feed : null;
  const feed: gc.Feed =
    requested && (gc.FEEDS as readonly string[]).includes(requested) ? (requested as gc.Feed) : state ? gc.recommendedFeed(state, nowMs) : "maintenance";
  const quality = state ? gc.careQualityFor(state, feed, nowMs) : 650;
  const inserted = await tx
    .insert(careLog)
    .values({ horseId: horse.id, accountId, day, actions: { feed, groom: actions.groom !== false, turnout: actions.turnout !== false }, quality, createdAt: now })
    .onConflictDoNothing({ target: [careLog.horseId, careLog.day] })
    .returning({ id: careLog.id });
  if (!inserted[0]) return noop(feed);
  const careSessions = horse.careSessions + 1;
  const stage = stageFor(careSessions, horse.starts);
  let updated: HorseRow | undefined;
  if (state) {
    const res = gc.recordCare({ ...state, injury: vetAware(state.injury, vetLevel) }, feed, nowMs);
    let next = res.state;
    if (next.injury && gc.isHealed(next.injury, nowMs)) next = { ...next, injury: null };
    const patch = statePatch(next, nowMs);
    [updated] = await tx
      .update(horses)
      .set({
        careSessions,
        stage,
        careQuality: patch.careQuality,
        bond: patch.bond,
        injury: patch.injury,
        injuredUntil: patch.injuredUntil,
        stats: patch.stats ?? horse.stats,
        dynamics: { ...(horse.dynamics as Record<string, unknown>), lastCareDay: next.care.lastCareDay },
        updatedAt: now,
      })
      .where(eq(horses.id, horse.id))
      .returning();
  } else {
    let injuredUntil = horse.injuredUntil;
    if (injuredUntil && injuredUntil > now) injuredUntil = new Date(Math.max(nowMs, injuredUntil.getTime() - RULES.careHealMs));
    [updated] = await tx
      .update(horses)
      .set({ careSessions, stage, bond: Math.min(1000, horse.bond + 6), injuredUntil, updatedAt: now })
      .where(eq(horses.id, horse.id))
      .returning();
  }
  const graduated = horse.careSessions < RULES.careToRacing && careSessions >= RULES.careToRacing;
  // Today's "care for a horse" goal, on the same transaction (a no-op once it has paid).
  await completeGoal(tx, { accountId, goal: "care", now });
  return { horse: updated!, counted: true, day, stageBefore, stageAfter: stage, graduated, feed, quality };
}

/** One care session (feed, groom, turnout) for one of the player's horses, on their local day. */
export async function careForHorse(db: Db, input: { accountId: string; horseId: string; now: Date } & CareActions): Promise<CareSessionResult> {
  return runTx(db, async (tx) => {
    const stable = await stableOf(tx, input.accountId);
    const { horse } = await lockKeptHorse(tx, input.accountId, input.horseId);
    const day = await careDayOf(tx, input.accountId, input.now);
    const res = await careTx(tx, input.accountId, horse, day, input.now, input, facilityLevels(stable).vet);
    if (res.counted) await recordPlayDay(tx, input.accountId, input.now);
    return res;
  });
}

/** Stable hand: cares for every horse not yet cared for today, with the recommended feed. */
export async function careForAll(db: Db, input: { accountId: string; now: Date; horseIds?: string[] }): Promise<CareSessionResult[]> {
  return runTx(db, async (tx) => {
    const stable = await lockStableOf(tx, input.accountId);
    if (facilityLevels(stable).stableHand < 1) throw new DomainError("NOT_ELIGIBLE", "hire a stable hand to care for every horse in one tap");
    const day = await careDayOf(tx, input.accountId, input.now);
    const rows = await tx
      .select()
      .from(horses)
      .where(and(keptBy(stable.id), ne(horses.careerStatus, "pasture")))
      .orderBy(horses.id)
      .for("update");
    const wanted = input.horseIds ? new Set(input.horseIds) : null;
    const out: CareSessionResult[] = [];
    for (const h of rows) {
      if (wanted && !wanted.has(h.id)) continue;
      out.push(await careTx(tx, input.accountId, h, day, input.now, {}, facilityLevels(stable).vet));
    }
    if (out.some((r) => r.counted)) await recordPlayDay(tx, input.accountId, input.now);
    return out;
  });
}

// ---------------------------------------------------------------------------
// Training: the weekly plan (3 slots, 4 with a Trainer) and player-triggered sessions
// ---------------------------------------------------------------------------

/** The plan in force: the most recent one saved for the horse (plans carry over week to week). */
export async function currentTrainingPlan(ex: Executor, horseId: string): Promise<gc.TrainingPlan | null> {
  const [row] = await ex.select({ plan: trainingPlans.plan }).from(trainingPlans).where(eq(trainingPlans.horseId, horseId)).orderBy(desc(trainingPlans.weekStart)).limit(1);
  const p = gc.TrainingPlanSchema.safeParse(row?.plan);
  return p.success ? p.data : null;
}

/** Sessions used in the current (UTC, Monday-based) training week. */
export function sessionsUsedThisWeek(state: gc.HorseState, nowMs: number): number {
  return state.training.week === gc.weekIndex(nowMs) ? state.training.sessionsThisWeek : 0;
}

/** Saves this week's plan (free: credits are charged per session run). */
export async function saveTrainingPlan(db: Db, input: { accountId: string; horseId: string; slots: string[]; now: Date }): Promise<gc.TrainingPlan> {
  return runTx(db, async (tx) => {
    const stable = await stableOf(tx, input.accountId);
    const { horse } = await lockKeptHorse(tx, input.accountId, input.horseId);
    if (!isGenome(horse.genome)) throw new DomainError("NOT_ELIGIBLE", "this horse can't follow a plan");
    if (horse.careerStatus !== "racing") throw new DomainError("HORSE_RETIRED", "retired horses do not train");
    const slots = gc.slotsFor(facilityLevels(stable).trainer);
    const parsed = gc.TrainingPlanSchema.safeParse({ slots: input.slots });
    if (!parsed.success || parsed.data.slots.length !== slots) throw new DomainError("INVALID_INPUT", `a plan has ${slots} slots`);
    const allowed = new Set(gc.allowedWorkouts(toHorseState(horse)));
    if (allowed.size === 0) throw new DomainError("HORSE_NOT_OF_AGE", "foals and weanlings don't train yet");
    const bad = parsed.data.slots.find((w) => !allowed.has(w));
    if (bad) throw new DomainError("NOT_ELIGIBLE", `${gc.WORKOUTS[bad].label} isn't open to this horse yet`);
    await tx
      .insert(trainingPlans)
      .values({ horseId: horse.id, weekStart: utcWeekStart(input.now), plan: parsed.data, createdBy: input.accountId })
      .onConflictDoUpdate({ target: [trainingPlans.horseId, trainingPlans.weekStart], set: { plan: parsed.data, updatedAt: input.now } });
    return parsed.data;
  });
}

export interface TrainingSessionResult {
  horse: HorseRow;
  /** False when `expectedSession` was stale (a retry): nothing ran or was charged. */
  ran: boolean;
  workout: gc.Workout | null;
  cost: number;
  arrows: gc.StatArrows | null;
  injured: boolean;
  overworked: boolean;
  sessionsUsed: number;
}

const TRAIN_BLOCK: Record<string, [ConstructorParameters<typeof DomainError>[0], string]> = {
  foal: ["HORSE_NOT_OF_AGE", "foals and weanlings don't train yet"],
  not_light: ["NOT_ELIGIBLE", "yearlings do light work only"],
  injured: ["HORSE_INJURED", "rest only while injured"],
  retired: ["HORSE_RETIRED", "retired horses do not train"],
  week_full: ["NOT_ELIGIBLE", "this week's sessions are used; a new week starts on Monday"],
  insufficient_credits: ["INSUFFICIENT_FUNDS", "not enough credits for this session"],
};

/** Runs the plan's next session now (or `workout`). Charges the workout's credit cost once. */
export async function runTrainingSession(
  db: Db,
  input: { accountId: string; horseId: string; now: Date; expectedSession?: number; workout?: string },
): Promise<TrainingSessionResult> {
  return runTx(db, async (tx) => {
    const stable = await stableOf(tx, input.accountId);
    const { horse } = await lockKeptHorse(tx, input.accountId, input.horseId);
    if (!isGenome(horse.genome)) throw new DomainError("NOT_ELIGIBLE", "this horse can't train");
    if (horse.careerStatus !== "racing") throw new DomainError("HORSE_RETIRED", "retired horses do not train");
    if (horse.lockKind) throw new DomainError("HORSE_LOCKED", "horse is entered in a race or listed");
    const nowMs = input.now.getTime();
    const state = toHorseState(horse);
    const used = sessionsUsedThisWeek(state, nowMs);
    if (input.expectedSession !== undefined && input.expectedSession !== used) {
      return { horse, ran: false, workout: null, cost: 0, arrows: null, injured: false, overworked: false, sessionsUsed: used };
    }
    let workout: gc.Workout | null;
    if (input.workout !== undefined) {
      const w = gc.WorkoutSchema.safeParse(input.workout);
      if (!w.success) throw new DomainError("INVALID_INPUT", "unknown workout");
      workout = w.data;
    } else {
      // A plan saved before a Trainer upgrade has fewer slots than the week now allows: pad it
      // with rest sessions exactly as the training view shows it, so the extra slot can be run.
      const saved = (await currentTrainingPlan(tx, horse.id)) ?? gc.DEFAULT_PLAN;
      const slots = gc.slotsFor(facilityLevels(stable).trainer);
      const padded = [...saved.slots, ...Array<gc.Workout>(Math.max(0, slots - saved.slots.length)).fill("rest" as gc.Workout)].slice(0, slots);
      workout = gc.nextPlannedWorkout({ ...saved, slots: padded }, state, nowMs);
    }
    const lv = facilityLevels(stable);
    if (!workout) throw new DomainError(...TRAIN_BLOCK.week_full!);
    const res = gc.train(
      { ...state, injury: vetAware(state.injury, lv.vet) },
      workout,
      { nowMs, trainerLevel: lv.trainer, vetLevel: lv.vet, credits: await getBalance(tx, input.accountId) },
      gc.seedFrom("train", horse.id, gc.weekIndex(nowMs), used),
    );
    if (!res.ok) throw new DomainError(...(TRAIN_BLOCK[res.block ?? "week_full"] ?? TRAIN_BLOCK.week_full!));
    if (res.cost > 0) {
      await spendCreditsTx(tx, {
        accountId: input.accountId,
        amount: res.cost,
        idempotencyKey: `training:${horse.id}:${gc.weekIndex(nowMs)}:${used}`,
        kind: "training",
        memo: gc.WORKOUTS[workout].label,
      });
    }
    const patch = statePatch(res.state, nowMs);
    // The horse's log keeps what the session did (the toast is gone after a few seconds).
    const gains: Record<string, number> = {};
    for (const k of gc.STAT_KEYS) {
      const d = res.state.training.realisation[k] - state.training.realisation[k];
      if (d !== 0) gains[k] = d;
    }
    await logHorseEventTx(tx, {
      horseId: horse.id,
      kind: "training",
      stableId: stable.id,
      at: input.now,
      dedupeKey: `${gc.weekIndex(nowMs)}:${used}`,
      data: {
        workout,
        label: gc.WORKOUTS[workout].label,
        cost: res.cost,
        session: used + 1,
        gains,
        fatigueBefore: gc.fatigueAt(state, nowMs),
        fatigueAfter: gc.fatigueAt(res.state, nowMs),
        fitnessBefore: state.condition.fitness,
        fitnessAfter: res.state.condition.fitness,
        realisation: res.state.training.realisation,
        overworked: res.overworked,
        injured: res.injured,
        ...(res.injured && patch.injuredUntil ? { backAtMs: patch.injuredUntil.getTime() } : {}),
      },
    });
    const [updated] = await tx
      .update(horses)
      .set({
        fitness: patch.fitness,
        fatigue: patch.fatigue,
        fatigueAt: patch.fatigueAt,
        bond: patch.bond,
        injury: patch.injury,
        injuredUntil: patch.injuredUntil,
        stats: patch.stats ?? horse.stats,
        dynamics: { ...(horse.dynamics as Record<string, unknown>), ...patch.dynamics },
        updatedAt: input.now,
      })
      .where(eq(horses.id, horse.id))
      .returning();
    await recordPlayDay(tx, input.accountId, input.now);
    return { horse: updated!, ran: true, workout, cost: res.cost, arrows: res.arrows, injured: res.injured, overworked: res.overworked, sessionsUsed: used + 1 };
  });
}

// ---------------------------------------------------------------------------
// Vet treatment, Pedigree Scan, graduation
// ---------------------------------------------------------------------------

/** Vet treatment during recovery: +24 h of healing for VET_TREATMENT_COST credits, once per injury per local day. */
export async function treatHorseInjury(db: Db, input: { accountId: string; horseId: string; now: Date }): Promise<{ horse: HorseRow; treated: boolean; cost: number }> {
  return runTx(db, async (tx) => {
    const stable = await stableOf(tx, input.accountId);
    const { horse } = await lockKeptHorse(tx, input.accountId, input.horseId);
    const nowMs = input.now.getTime();
    if (!isGenome(horse.genome)) throw new DomainError("NOT_ELIGIBLE", "no treatment available");
    const state = toHorseState(horse);
    if (!state.injury || gc.isHealed(state.injury, nowMs)) throw new DomainError("NOT_ELIGIBLE", "this horse isn't injured");
    const day = await careDayOf(tx, input.accountId, input.now);
    const res = await spendCreditsTx(tx, {
      accountId: input.accountId,
      amount: gc.VET_TREATMENT_COST,
      idempotencyKey: vetTreatmentKey(horse.id, state.injury.atMs, day),
      kind: "vet",
      memo: "vet treatment",
    });
    if (res.duplicate) return { horse, treated: false, cost: 0 };
    let next = gc.treatInjury({ ...state, injury: vetAware(state.injury, facilityLevels(stable).vet) });
    if (next.injury && gc.isHealed(next.injury, nowMs)) next = { ...next, injury: null };
    const patch = statePatch(next, nowMs);
    const [updated] = await tx
      .update(horses)
      .set({ injury: patch.injury, injuredUntil: patch.injuredUntil, updatedAt: input.now })
      .where(eq(horses.id, horse.id))
      .returning();
    await logHorseEventTx(tx, {
      horseId: horse.id,
      kind: "vet",
      stableId: stable.id,
      at: input.now,
      dedupeKey: vetTreatmentKey(horse.id, state.injury.atMs, day),
      data: { cost: gc.VET_TREATMENT_COST, backAtMs: patch.injuredUntil ? patch.injuredUntil.getTime() : null },
    });
    return { horse: updated!, treated: true, cost: gc.VET_TREATMENT_COST };
  });
}

/** The ledger key of a vet treatment (one per injury per local day). */
export function vetTreatmentKey(horseId: string, injuryAtMs: number, day: string): string {
  return `vet:${horseId}:${injuryAtMs}:${day}`;
}

/** Whether this injury was already treated on the given local day. */
export async function vetTreatedOn(ex: Executor, horseId: string, injuryAtMs: number, day: string): Promise<boolean> {
  const [row] = await ex
    .select({ id: ledgerTransactions.id })
    .from(ledgerTransactions)
    .where(eq(ledgerTransactions.idempotencyKey, vetTreatmentKey(horseId, injuryAtMs, day)));
  return !!row;
}

/** Pedigree Scan: narrows the revealed potential ranges for good (PEDIGREE_SCAN_COST credits, once). */
export async function scanPedigree(db: Db, input: { accountId: string; horseId: string; now: Date }): Promise<{ horse: HorseRow; scanned: boolean; cost: number }> {
  return runTx(db, async (tx) => {
    const { horse } = await lockOwnedHorse(tx, input.accountId, input.horseId);
    if (horse.scanned) return { horse, scanned: false, cost: 0 };
    const res = await spendCreditsTx(tx, {
      accountId: input.accountId,
      amount: gc.PEDIGREE_SCAN_COST,
      idempotencyKey: `scan:${horse.id}`,
      kind: "pedigree_scan",
      memo: "Pedigree Scan",
    });
    if (res.duplicate) return { horse, scanned: false, cost: 0 };
    const [updated] = await tx.update(horses).set({ scanned: true, updatedAt: input.now }).where(eq(horses.id, horse.id)).returning();
    // The scan's result as a moment: the narrowed ranges (and big heart, if the scan revealed it).
    if (isGenome(horse.genome)) {
      await sendMomentsTx(tx, { accountId: input.accountId, horseName: horse.name, drafts: [gc.scanMoment(toHorseState(horse), toHorseState(updated!))], now: input.now });
    }
    return { horse: updated!, scanned: true, cost: gc.PEDIGREE_SCAN_COST };
  });
}

/** True for a horse that reached racing age through care and hasn't been welcomed to the yard yet. */
export function awaitingGraduation(h: Pick<HorseRow, "careSessions" | "starts" | "origin" | "dynamics" | "careerStatus">): boolean {
  const dyn = (h.dynamics ?? {}) as { graduatedAtMs?: number };
  return h.careerStatus === "racing" && h.origin !== "starter" && h.origin !== "house" && h.careSessions >= RULES.careToRacing && h.starts === 0 && !dyn.graduatedAtMs;
}

/** "Ready to race": marks a nursery graduate as welcomed to the yard. Idempotent. */
export async function graduateFoal(db: Db, input: { accountId: string; horseId: string; now: Date }): Promise<HorseRow> {
  return runTx(db, async (tx) => {
    const { horse } = await lockOwnedHorse(tx, input.accountId, input.horseId);
    if (horse.careSessions < RULES.careToRacing) {
      throw new DomainError("HORSE_NOT_OF_AGE", `${RULES.careToRacing - horse.careSessions} more care sessions to racing age`);
    }
    const dyn = (horse.dynamics ?? {}) as Record<string, unknown>;
    if (dyn.graduatedAtMs) return horse;
    const [updated] = await tx
      .update(horses)
      .set({ dynamics: { ...dyn, graduatedAtMs: input.now.getTime() }, updatedAt: input.now })
      .where(eq(horses.id, horse.id))
      .returning();
    await audit(tx, { actor: input.accountId, action: "horse.graduate", entityType: "horse", entityId: horse.id, data: { careSessions: horse.careSessions } });
    return updated!;
  });
}
