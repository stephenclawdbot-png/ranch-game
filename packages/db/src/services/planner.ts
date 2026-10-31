/**
 * Campaign planner (experience review item 8): pin a horse to a future race, a published card
 * race (the 24 h horizon) or an upcoming calendar race (Feature Qualifiers, the Weekend Feature,
 * Season Finals), and check the plan: eligibility now, the freshness peak against the race time,
 * clashes inside the horse's minimum rest, and the entry window. game-core planning.ts holds the
 * rules; this file stores targets and keeps them honest.
 *
 * A target is keyed by card slot index, so a calendar race can be pinned before it is published
 * (its race id is filled in once it is). Up to MAX_TARGETS_PER_HORSE active per horse. Targets
 * leave the plan by themselves, with a note, when the horse runs in the race (settleRace), is
 * scratched from it (scratchEntry), can no longer run in it (sweep), or the race goes by. The
 * sweep also sends two inbox reminders, once each: entries open, and two hours before they close.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { horses, inboxItems, raceEntries, races, raceTargets, stables, type HorseRow, type RaceEntryRow, type RaceRow, type RaceTargetRow } from "../schema";
import { gc, isGenome, toHorseState } from "../gameCore";
import { RULES, seasonNumberAt } from "../rules";
import { DomainError } from "../errors";
import type { Db, Executor, Tx } from "../types";
import { keeperOf } from "./horses";
import { CALENDAR_HOME_COURSE, defaultCardSlot, slotIndexOf, slotKeyOf, specialSlotAt } from "./card";
import { classEligibility, featureQualificationReason, type RaceConditions } from "./races";
import { runTx } from "./tx";

const LIVE_KINDS = ["scheduled", "feature", "final"] as const;
const DAY_MS = 86_400_000;
/** Removed targets show their note this long on the horse page and /week. */
const REMOVED_NOTE_MS = 3 * DAY_MS;
const SEASON_CLOCK = { epochMs: RULES.seasonEpochMs };
const ordinalOf = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

export type TargetRemoval = "ran" | "scratched" | "ineligible" | "missed" | "removed";

/** What the planner knows about a slot: the published race if there is one, else the calendar's. */
interface SlotRace {
  slotIndex: number;
  raceId: string | null;
  name: string;
  raceClass: string;
  postTime: Date;
  entriesCloseAt: Date;
  conditions: RaceConditions;
  status: RaceRow["status"] | "unpublished";
}

function calendarName(index: number): string | null {
  const sp = specialSlotAt(index);
  if (!sp || (sp.kind !== "feature_qualifier" && sp.kind !== "weekend_feature" && sp.kind !== "season_final")) return null;
  return `${CALENDAR_HOME_COURSE[sp.kind]} ${sp.name}`;
}

/** The race in a slot: published (by race id, or the slot's own race), else the calendar race. */
async function slotRace(ex: Executor, index: number, raceId?: string | null): Promise<SlotRace | null> {
  const [row] = raceId ? await ex.select().from(races).where(eq(races.id, raceId)) : await ex.select().from(races).where(eq(races.slotKey, slotKeyOf(index)));
  if (row) return { slotIndex: index, raceId: row.id, name: row.name, raceClass: row.raceClass, postTime: row.postTime, entriesCloseAt: row.entriesCloseAt, conditions: (row.conditions ?? {}) as RaceConditions, status: row.status };
  const name = calendarName(index);
  if (!name) return null;
  const c = defaultCardSlot(index);
  return { slotIndex: index, raceId: null, name, raceClass: c.raceClass, postTime: c.postTime, entriesCloseAt: c.entriesCloseAt, conditions: (c.conditions ?? {}) as RaceConditions, status: "unpublished" };
}

/** A reason the horse can never run in this race (the target is dropped), or null. */
function permanentBlock(h: HorseRow, stableId: string, race: Pick<SlotRace, "conditions" | "raceClass">): string | null {
  if (keeperOf(h) !== stableId) return "no longer in your stable";
  if (h.careerStatus !== "racing") return "retired from racing";
  if (h.starts >= RULES.maxStarts) return "career complete";
  const c = race.conditions;
  if (c.maxWins !== undefined && h.wins > c.maxWins) return classEligibility(h, race);
  if (c.maxRating !== undefined) {
    const why = classEligibility(h, { raceClass: race.raceClass, conditions: { maxRating: c.maxRating } });
    if (why) return why;
  }
  return null;
}

export interface TargetCandidate {
  slotIndex: number;
  raceId: string | null;
  name: string;
  raceClass: string;
  postTimeMs: number;
  /** Not on the card yet (a calendar race beyond the horizon). */
  calendar: boolean;
  /** Why the horse can't run in it now (null = eligible today). */
  reason: string | null;
}

/** Races a horse could be aimed at: the published card ahead, then calendar races further out. */
export async function targetCandidates(db: Db, input: { stableId: string; horseId: string; now: Date }): Promise<TargetCandidate[]> {
  const [h] = await db.select().from(horses).where(eq(horses.id, input.horseId));
  if (!h || keeperOf(h) !== input.stableId) throw new DomainError("NOT_OWNER", "not your horse");
  const nowMs = input.now.getTime();
  const published = await db
    .select()
    .from(races)
    .where(and(inArray(races.kind, [...LIVE_KINDS]), eq(races.status, "open"), gte(races.entriesCloseAt, input.now), lte(races.postTime, new Date(nowMs + RULES.cardHorizonMs)), sql`${races.slotKey} like 'live%:%'`))
    .orderBy(asc(races.postTime))
    .limit(200);
  const out: TargetCandidate[] = [];
  for (const r of published) {
    const idx = slotIndexOf(r.slotKey);
    if (idx === null) continue;
    out.push({ slotIndex: idx, raceId: r.id, name: r.name, raceClass: r.raceClass, postTimeMs: r.postTime.getTime(), calendar: false, reason: classEligibility(h, r) });
  }
  const season = seasonNumberAt(input.now);
  const cal = [...gc.featureCalendar(SEASON_CLOCK, season), ...gc.featureCalendar(SEASON_CLOCK, season + 1)].filter((r) => r.postTimeMs > nowMs + RULES.cardHorizonMs && r.postTimeMs <= nowMs + gc.PLAN_CALENDAR_AHEAD_MS);
  for (const sp of cal) {
    const idx = Math.floor((sp.postTimeMs - RULES.seasonEpochMs) / RULES.slotMs);
    const race = await slotRace(db, idx);
    if (!race) continue;
    out.push({ slotIndex: idx, raceId: race.raceId, name: race.name, raceClass: race.raceClass, postTimeMs: race.postTime.getTime(), calendar: race.status === "unpublished", reason: classEligibility(h, race) });
  }
  return out;
}

/** Pins a race as a target for a horse (idempotent per horse and slot). */
export async function addTarget(db: Db, input: { accountId: string; horseId: string; raceId?: string | null; slotIndex?: number | null; now: Date }): Promise<RaceTargetRow> {
  return runTx(db, async (tx) => {
    const [stable] = await tx.select().from(stables).where(eq(stables.accountId, input.accountId));
    if (!stable) throw new DomainError("NOT_FOUND", "stable not found");
    const [h] = await tx.select().from(horses).where(eq(horses.id, input.horseId)).for("update");
    if (!h || keeperOf(h) !== stable.id) throw new DomainError("NOT_OWNER", "not your horse");
    let index = input.slotIndex ?? null;
    if (input.raceId) {
      const [r] = await tx.select({ slotKey: races.slotKey, kind: races.kind }).from(races).where(eq(races.id, input.raceId));
      index = r && (LIVE_KINDS as readonly string[]).includes(r.kind) ? slotIndexOf(r.slotKey) : null;
      if (index === null) throw new DomainError("INVALID_INPUT", "only Live card races can be targets");
    }
    if (index === null || !Number.isInteger(index)) throw new DomainError("INVALID_INPUT", "pick a race");
    const race = await slotRace(tx, index, input.raceId);
    if (!race) throw new DomainError("NOT_FOUND", "no race in that slot");
    if (race.entriesCloseAt <= input.now || race.status === "settled" || race.status === "cancelled") throw new DomainError("RACE_CLOSED", "that race has closed");
    if (race.postTime.getTime() > input.now.getTime() + gc.PLAN_CALENDAR_AHEAD_MS) throw new DomainError("INVALID_INPUT", "too far ahead to plan");
    const block = permanentBlock(h, stable.id, race);
    if (block) throw new DomainError("NOT_ELIGIBLE", block);
    const active = await tx.select().from(raceTargets).where(and(eq(raceTargets.horseId, h.id), isNull(raceTargets.removedAt)));
    const same = active.find((t) => t.slotIndex === index);
    if (same) return same;
    if (active.length >= gc.MAX_TARGETS_PER_HORSE) throw new DomainError("RACE_LIMIT", `at most ${gc.MAX_TARGETS_PER_HORSE} targets per horse`);
    const [row] = await tx
      .insert(raceTargets)
      .values({ horseId: h.id, stableId: stable.id, slotIndex: index, raceId: race.raceId, name: race.name, raceClass: race.raceClass, postTime: race.postTime, createdAt: input.now })
      .returning();
    return row!;
  });
}

export async function removeTarget(db: Db, input: { accountId: string; targetId: string; now: Date }): Promise<void> {
  const [stable] = await db.select({ id: stables.id }).from(stables).where(eq(stables.accountId, input.accountId));
  if (!stable) throw new DomainError("NOT_FOUND", "stable not found");
  await db
    .update(raceTargets)
    .set({ removedAt: input.now, removedReason: "removed" })
    .where(and(eq(raceTargets.id, input.targetId), eq(raceTargets.stableId, stable.id), isNull(raceTargets.removedAt)));
}

async function dropTarget(ex: Executor, id: string, reason: TargetRemoval, note: string, now: Date): Promise<void> {
  await ex.update(raceTargets).set({ removedAt: now, removedReason: `${reason}: ${note}` }).where(and(eq(raceTargets.id, id), isNull(raceTargets.removedAt)));
}

/** settleRace: the runners' targets on this race (or its slot's sister) are done. */
export async function targetsAfterRaceTx(tx: Tx, race: RaceRow, entries: readonly RaceEntryRow[], positions: ReadonlyMap<string, number>, now: Date): Promise<void> {
  const index = slotIndexOf(race.slotKey);
  const ids = entries.map((e) => e.horseId);
  if (!ids.length) return;
  const rows = await tx
    .select()
    .from(raceTargets)
    .where(and(inArray(raceTargets.horseId, ids), isNull(raceTargets.removedAt), index === null ? eq(raceTargets.raceId, race.id) : or(eq(raceTargets.raceId, race.id), eq(raceTargets.slotIndex, index))));
  for (const t of rows) {
    const p = positions.get(t.horseId);
    await dropTarget(tx, t.id, "ran", `ran in the ${race.name}${p ? ` (${ordinalOf(p)})` : ""}`, now);
  }
}

/** scratchEntry: a target on the race it was scratched from is dropped. */
export async function targetScratchedTx(tx: Executor, race: Pick<RaceRow, "id" | "slotKey" | "name">, horseId: string, now: Date): Promise<void> {
  const index = slotIndexOf(race.slotKey);
  const rows = await tx
    .select({ id: raceTargets.id })
    .from(raceTargets)
    .where(and(eq(raceTargets.horseId, horseId), isNull(raceTargets.removedAt), index === null ? eq(raceTargets.raceId, race.id) : or(eq(raceTargets.raceId, race.id), eq(raceTargets.slotIndex, index))));
  for (const t of rows) await dropTarget(tx, t.id, "scratched", `scratched from the ${race.name}`, now);
}

/** Is the horse entered (and not scratched) in a race of this slot? */
async function enteredIn(ex: Executor, horseId: string, index: number, raceId: string | null): Promise<boolean> {
  const rows = await ex
    .select({ id: raceEntries.id })
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .where(and(eq(raceEntries.horseId, horseId), eq(raceEntries.status, "entered"), or(raceId ? eq(races.id, raceId) : sql`false`, sql`${races.slotKey} = ${slotKeyOf(index)} or ${races.slotKey} like ${`${slotKeyOf(index)}:%`}`)))
    .limit(1);
  return rows.length > 0;
}

/** The entry window: opens when the race is published (card horizon), open while the published race takes entries. */
function windowOf(r: SlotRace, nowMs: number): gc.EntryWindow {
  const w = gc.entryWindow(r.postTime.getTime(), r.entriesCloseAt.getTime(), nowMs, RULES.cardHorizonMs);
  if (r.status === "unpublished") return { ...w, state: "not_open" };
  return { ...w, state: r.status === "open" && nowMs < w.closesAtMs ? "open" : "closed" };
}

export interface SweepReport {
  removed: number;
  reminders: number;
}

/**
 * Keeps targets honest (maintenance, and lazily when a stable looks at its plan): fills in the
 * race once published, drops targets the horse can no longer run in or whose race has gone, and
 * sends the reminders (once each, dedupe key per target).
 */
export async function sweepTargets(db: Db, now: Date, opts: { stableId?: string } = {}): Promise<SweepReport> {
  const active = await db
    .select()
    .from(raceTargets)
    .where(and(isNull(raceTargets.removedAt), opts.stableId ? eq(raceTargets.stableId, opts.stableId) : sql`true`))
    .orderBy(asc(raceTargets.postTime))
    .limit(1000);
  if (!active.length) return { removed: 0, reminders: 0 };
  const horseRows = await db.select().from(horses).where(inArray(horses.id, [...new Set(active.map((t) => t.horseId))]));
  const horseOf = new Map(horseRows.map((h) => [h.id, h]));
  const owners = await db.select({ id: stables.id, accountId: stables.accountId }).from(stables).where(inArray(stables.id, [...new Set(active.map((t) => t.stableId))]));
  const accountOf = new Map(owners.map((s) => [s.id, s.accountId]));
  let removed = 0;
  let reminders = 0;
  for (const t of active) {
    const h = horseOf.get(t.horseId);
    const race = await slotRace(db, t.slotIndex, t.raceId);
    if (!h || !race) continue;
    if (race.raceId && !t.raceId) await db.update(raceTargets).set({ raceId: race.raceId, name: race.name }).where(eq(raceTargets.id, t.id));
    const entered = await enteredIn(db, h.id, t.slotIndex, race.raceId);
    if (!entered && (race.entriesCloseAt <= now || race.status === "cancelled" || race.status === "settled")) {
      await dropTarget(db, t.id, "missed", race.status === "cancelled" ? `the ${race.name} was abandoned` : `entries for the ${race.name} closed without an entry`, now);
      removed++;
      continue;
    }
    const block = permanentBlock(h, t.stableId, race);
    if (block && !entered) {
      await dropTarget(db, t.id, "ineligible", `${h.name} can't run in the ${race.name}: ${block}`, now);
      removed++;
      continue;
    }
    const window = windowOf(race, now.getTime());
    const due = gc.planReminderDue(window, now.getTime(), entered);
    const accountId = accountOf.get(t.stableId);
    if (!due || !accountId || !race.raceId) continue;
    if ((due === "open" && t.remindedOpenAt) || (due === "closing" && t.remindedCloseAt)) continue;
    const when = race.postTime.toISOString().slice(11, 16);
    const rows = await db
      .insert(inboxItems)
      .values({
        accountId,
        kind: "plan_reminder",
        dedupeKey: `plan-${due}:${t.id}`,
        title: due === "open" ? `Entries are open for ${h.name}'s target: the ${race.name} (${when} UTC)` : `Two hours left to enter ${h.name} in the ${race.name} (${when} UTC)`,
        data: { targetId: t.id, reminder: due, href: `/race/${race.raceId}` },
        raceId: race.raceId,
        horseId: h.id,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: inboxItems.id });
    await db
      .update(raceTargets)
      .set(due === "open" ? { remindedOpenAt: now } : { remindedCloseAt: now })
      .where(eq(raceTargets.id, t.id));
    if (rows.length) reminders++;
  }
  return { removed, reminders };
}

export interface TargetView {
  id: string;
  horseId: string;
  horseName: string;
  slotIndex: number;
  raceId: string | null;
  name: string;
  raceClass: string;
  postTimeMs: number;
  /** Not on the published card yet. */
  calendar: boolean;
  entry: gc.EntryWindow;
  entered: boolean;
  /** Why the horse can't run in it today (rating band, conditions, starts, injury...), null when it can. */
  eligibility: string | null;
  freshness: gc.FreshnessOutlook;
  clashes: string[];
}

export interface RemovedTargetView {
  id: string;
  horseId: string;
  horseName: string;
  name: string;
  postTimeMs: number;
  removedAtMs: number;
  note: string;
}

export interface PlanView {
  targets: TargetView[];
  removed: RemovedTargetView[];
}

/** The stable's plan (or one horse's): every active target with its checks, and recent removals. */
export async function planView(db: Db, input: { stableId: string; horseId?: string | null; now: Date }): Promise<PlanView> {
  await sweepTargets(db, input.now, { stableId: input.stableId });
  const nowMs = input.now.getTime();
  const scope = and(eq(raceTargets.stableId, input.stableId), input.horseId ? eq(raceTargets.horseId, input.horseId) : sql`true`);
  const active = await db.select().from(raceTargets).where(and(scope, isNull(raceTargets.removedAt))).orderBy(asc(raceTargets.postTime));
  const gone = await db
    .select()
    .from(raceTargets)
    .where(and(scope, gte(raceTargets.removedAt, new Date(nowMs - REMOVED_NOTE_MS)), sql`${raceTargets.removedReason} <> 'removed'`))
    .orderBy(desc(raceTargets.removedAt))
    .limit(10);
  const ids = [...new Set([...active, ...gone].map((t) => t.horseId))];
  const horseRows = ids.length ? await db.select().from(horses).where(inArray(horses.id, ids)) : [];
  const horseOf = new Map(horseRows.map((h) => [h.id, h]));
  const targets: TargetView[] = [];
  const byHorse = new Map<string, RaceTargetRow[]>();
  for (const t of active) byHorse.set(t.horseId, [...(byHorse.get(t.horseId) ?? []), t]);
  for (const [horseId, list] of byHorse) {
    const h = horseOf.get(horseId);
    if (!h) continue;
    const state = isGenome(h.genome) ? toHorseState(h) : null;
    const slots = new Map<string, SlotRace>();
    for (const t of list) {
      const r = await slotRace(db, t.slotIndex, t.raceId);
      if (r) slots.set(t.id, r);
    }
    const plan = list.flatMap((t) => {
      const r = slots.get(t.id);
      return r ? [{ key: t.id, postTimeMs: r.postTime.getTime(), live: true, fatigue: state ? gc.raceFatigue(state, Number(r.conditions.distanceM ?? 1600)) : 0 }] : [];
    });
    const clashes = gc.targetClashes(plan, RULES.liveStartsPerDay);
    let lastHard = state?.condition.lastHardWorkMs ?? null;
    for (const t of list) {
      const r = slots.get(t.id);
      if (!r) continue;
      const entered = await enteredIn(db, h.id, t.slotIndex, r.raceId);
      const postMs = r.postTime.getTime();
      let eligibility = classEligibility(h, r);
      if (!eligibility && h.injuredUntil && h.injuredUntil > r.postTime) eligibility = "still injured at the off";
      if (!eligibility && h.lockKind && h.lockKind !== "race") eligibility = h.lockKind === "market" ? "listed on the market" : "booked for a covering";
      if (!eligibility) eligibility = await featureQualificationReason(db, h, { postTime: r.postTime, conditions: r.conditions });
      targets.push({
        id: t.id,
        horseId: h.id,
        horseName: h.name,
        slotIndex: t.slotIndex,
        raceId: r.raceId,
        name: r.name,
        raceClass: r.raceClass,
        postTimeMs: postMs,
        calendar: r.status === "unpublished",
        entry: windowOf(r, nowMs),
        entered,
        eligibility,
        freshness: gc.freshnessOutlook(lastHard, postMs),
        clashes: clashes.filter((c) => c.a === t.id || c.b === t.id).map((c) => `${slots.get(c.a === t.id ? c.b : c.a)?.name ?? "another target"}: ${c.reason}`),
      });
      // the race itself is hard work: the next target's freshness counts from it
      lastHard = Math.max(lastHard ?? 0, postMs);
    }
  }
  targets.sort((a, b) => a.postTimeMs - b.postTimeMs);
  return {
    targets,
    removed: gone.map((t) => ({ id: t.id, horseId: t.horseId, horseName: horseOf.get(t.horseId)?.name ?? "Your horse", name: t.name, postTimeMs: t.postTime.getTime(), removedAtMs: t.removedAt!.getTime(), note: (t.removedReason ?? "").replace(/^\w+: /, "") })),
  };
}

/** Active targets of a stable by race id (for "Aiming at" marks on lists). */
export async function activeTargetsOf(ex: Executor, stableId: string): Promise<RaceTargetRow[]> {
  return ex.select().from(raceTargets).where(and(eq(raceTargets.stableId, stableId), isNull(raceTargets.removedAt))).orderBy(asc(raceTargets.postTime));
}
