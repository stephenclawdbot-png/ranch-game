/**
 * Horse lifecycle: care, training plans, retirement, Legacy Farm, release to the Club,
 * insurance, stud listing. Nothing here (or anywhere) changes a horse because time
 * passed, except healing and pregnancy completion (see maintenance.ts).
 */
import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { utcDay } from "../crypto";
import { DomainError } from "../errors";
import { careLog, horseLeaseListings, horses, pregnancies, trainingPlans, type HorseRow } from "../schema";
import { RULES, stageFor } from "../rules";
import { gc, isGenome, statePatch, toHorseState } from "../gameCore";
import type { Db, Executor } from "../types";
import { recordPlayDay, stableOf } from "./accounts";
import { grantCreditsTx, spendCreditsTx } from "./ledger";
import { audit, runTx } from "./tx";
import { claimChosenName } from "./naming";
import { careerTribute, momentHorse, sendMomentsTx } from "./moments";

export async function getHorse(ex: Executor, horseId: string): Promise<HorseRow | null> {
  const [h] = await ex.select().from(horses).where(eq(horses.id, horseId));
  return h ?? null;
}

/**
 * The horses standing in this stable's barn: its own horses that are at home plus horses it
 * holds on lease (leasing.ts). Horses it owns that are away on lease are NOT here (they stand in
 * the lessee's stall): see `listLeasedOutHorses`. Ownership checks never use this list.
 */
export async function listStableHorses(ex: Executor, stableId: string): Promise<HorseRow[]> {
  return ex.select().from(horses).where(keptBy(stableId)).orderBy(asc(horses.createdAt), asc(horses.id));
}

/** SQL condition: the horse stands in this stable (owned and at home, or leased in). */
export function keptBy(stableId: string) {
  return or(and(eq(horses.ownerStableId, stableId), isNull(horses.lesseeStableId)), eq(horses.lesseeStableId, stableId))!;
}

/** Horses this stable owns that are away on lease (shown as "On lease to ..."). */
export async function listLeasedOutHorses(ex: Executor, stableId: string): Promise<HorseRow[]> {
  return ex
    .select()
    .from(horses)
    .where(and(eq(horses.ownerStableId, stableId), isNotNull(horses.lesseeStableId)))
    .orderBy(asc(horses.createdAt), asc(horses.id));
}

/** The stable that may act on a horse day to day (care, training, entries): the lessee while on lease, else the owner. */
export function keeperOf(h: Pick<HorseRow, "ownerStableId" | "lesseeStableId">): string | null {
  return h.lesseeStableId ?? h.ownerStableId;
}

export async function lockHorse(ex: Executor, horseId: string): Promise<HorseRow> {
  const [h] = await ex.select().from(horses).where(eq(horses.id, horseId)).for("update");
  if (!h) throw new DomainError("NOT_FOUND", "horse not found");
  return h;
}

/**
 * Locks the horse and checks the account's stable OWNS it: the owner-only acts (sell, list, breed,
 * retire, Legacy Farm, release, rename, stud fees, USDG). A horse away on lease is refused
 * (HORSE_ON_LEASE) unless `allowOnLease` (insurance: the owner's alone, even on lease); the
 * lessee is never its owner (NOT_OWNER).
 */
export async function lockOwnedHorse(ex: Executor, accountId: string, horseId: string, opts: { allowOnLease?: boolean } = {}): Promise<{ horse: HorseRow; stableId: string }> {
  const stable = await stableOf(ex, accountId);
  const horse = await lockHorse(ex, horseId);
  if (horse.ownerStableId !== stable.id) {
    throw new DomainError("NOT_OWNER", horse.lesseeStableId === stable.id ? "this horse is on lease to you: only its owner can do that" : "not your horse");
  }
  if (horse.lesseeStableId && !opts.allowOnLease) throw new DomainError("HORSE_ON_LEASE", "this horse is away on lease: wait until it comes home");
  return { horse, stableId: stable.id };
}

/**
 * Locks the horse and checks the account's stable KEEPS it (keeperOf): care, vet, training, race
 * and Cup entries. That is the lessee while the horse is on lease, the owner otherwise.
 */
export async function lockKeptHorse(ex: Executor, accountId: string, horseId: string): Promise<{ horse: HorseRow; stableId: string; leased: boolean }> {
  const stable = await stableOf(ex, accountId);
  const horse = await lockHorse(ex, horseId);
  if (keeperOf(horse) !== stable.id) {
    const away = horse.ownerStableId === stable.id;
    throw new DomainError(away ? "HORSE_ON_LEASE" : "NOT_OWNER", away ? "this horse is away on lease" : "not your horse");
  }
  return { horse, stableId: stable.id, leased: horse.lesseeStableId === stable.id };
}

/** Withdraws the horse's open lease offer (the horse is retiring, leaving or being listed). */
export async function withdrawLeaseOffersTx(ex: Executor, horseId: string, now: Date): Promise<number> {
  const rows = await ex
    .update(horseLeaseListings)
    .set({ status: "cancelled", closedAt: now })
    .where(and(eq(horseLeaseListings.horseId, horseId), eq(horseLeaseListings.status, "active")))
    .returning({ id: horseLeaseListings.id });
  return rows.length;
}

/** The horse's open lease offer id, if any. */
export async function openLeaseOfferOf(ex: Executor, horseId: string): Promise<string | null> {
  const [r] = await ex
    .select({ id: horseLeaseListings.id })
    .from(horseLeaseListings)
    .where(and(eq(horseLeaseListings.horseId, horseId), eq(horseLeaseListings.status, "active")));
  return r?.id ?? null;
}

export async function isCarrying(ex: Executor, horseId: string): Promise<boolean> {
  const [p] = await ex
    .select({ id: pregnancies.id })
    .from(pregnancies)
    .where(and(eq(pregnancies.damId, horseId), eq(pregnancies.status, "carrying")));
  return !!p;
}

// ---------------------------------------------------------------------------
// Care (one counted session per horse per UTC day; unique index backs it)
// ---------------------------------------------------------------------------

export interface CareInput {
  accountId: string;
  horseId: string;
  now: Date;
  /** e.g. { feed: "oats", groom: true, turnout: true } */
  actions: Record<string, unknown>;
  /** Care quality earned this session, permille points added to the rolling quality. */
  quality?: number;
}

export interface CareResult {
  horse: HorseRow;
  stageChanged: boolean;
}

export async function recordCare(db: Db, input: CareInput): Promise<CareResult> {
  return runTx(db, async (tx) => {
    const { horse } = await lockKeptHorse(tx, input.accountId, input.horseId);
    const day = utcDay(input.now);
    const inserted = await tx
      .insert(careLog)
      .values({ horseId: horse.id, accountId: input.accountId, day, actions: input.actions, quality: input.quality ?? 0 })
      .onConflictDoNothing({ target: [careLog.horseId, careLog.day] })
      .returning({ id: careLog.id });
    if (!inserted[0]) throw new DomainError("ALREADY_CARED_TODAY", "this horse has already been cared for today");
    const careSessions = horse.careSessions + 1;
    const stage = stageFor(careSessions, horse.starts);
    // game-core care (feed quality for the horse's needs, bond, healing bonus) when the horse
    // has a real genome; the counted-session rule itself is the unique (horse, day) index.
    if (isGenome(horse.genome)) {
      const state = { ...toHorseState(horse), care: { ...toHorseState(horse).care, lastCareDay: null } };
      const requested = typeof input.actions.feed === "string" ? input.actions.feed : null;
      const feed = (gc.FEEDS as readonly string[]).includes(requested ?? "") ? (requested as gc.Feed) : gc.recommendedFeed(state, input.now.getTime());
      const res = gc.recordCare(state, feed, input.now.getTime());
      const patch = statePatch(res.state, input.now.getTime());
      const [updated] = await tx
        .update(horses)
        .set({
          careSessions,
          stage,
          careQuality: patch.careQuality,
          bond: patch.bond,
          injury: patch.injury,
          injuredUntil: patch.injuredUntil,
          stats: patch.stats ?? horse.stats,
          dynamics: { ...(horse.dynamics as Record<string, unknown>), lastCareDay: res.state.care.lastCareDay },
          updatedAt: input.now,
        })
        .where(eq(horses.id, horse.id))
        .returning();
      await recordPlayDay(tx, input.accountId, input.now);
      return { horse: updated!, stageChanged: stage !== horse.stage };
    }
    // Care speeds recovery (never slows it).
    let injuredUntil = horse.injuredUntil;
    if (injuredUntil && injuredUntil > input.now) {
      injuredUntil = new Date(Math.max(input.now.getTime(), injuredUntil.getTime() - RULES.careHealMs));
    }
    const [updated] = await tx
      .update(horses)
      .set({
        careSessions,
        stage,
        careQuality: Math.min(1000, Math.max(0, horse.careQuality + (input.quality ?? 0))),
        bond: Math.min(1000, horse.bond + 10),
        injuredUntil,
        updatedAt: input.now,
      })
      .where(eq(horses.id, horse.id))
      .returning();
    await recordPlayDay(tx, input.accountId, input.now);
    return { horse: updated!, stageChanged: stage !== horse.stage };
  });
}

// ---------------------------------------------------------------------------
// Training plans
// ---------------------------------------------------------------------------

export async function setTrainingPlan(
  db: Db,
  input: { accountId: string; horseId: string; weekStart: string; plan: unknown; cost?: number },
): Promise<{ planId: string }> {
  return runTx(db, async (tx) => {
    const { horse } = await lockKeptHorse(tx, input.accountId, input.horseId);
    if (horse.careerStatus !== "racing") throw new DomainError("HORSE_RETIRED", "retired horses do not train");
    if (input.cost && input.cost > 0) {
      await spendCreditsTx(tx, {
        accountId: input.accountId,
        amount: input.cost,
        idempotencyKey: `training:${horse.id}:${input.weekStart}`,
        kind: "training",
      });
    }
    const [row] = await tx
      .insert(trainingPlans)
      .values({ horseId: horse.id, weekStart: input.weekStart, plan: input.plan, createdBy: input.accountId })
      .onConflictDoUpdate({ target: [trainingPlans.horseId, trainingPlans.weekStart], set: { plan: input.plan, updatedAt: new Date() } })
      .returning({ id: trainingPlans.id });
    return { planId: row!.id };
  });
}

// ---------------------------------------------------------------------------
// Retirement, Legacy Farm, release
// ---------------------------------------------------------------------------

/** Voluntary racing retirement (final). The horse may still breed while breedings remain. */
export async function retireHorse(db: Db, input: { accountId: string; horseId: string; now: Date }): Promise<HorseRow> {
  return runTx(db, async (tx) => {
    const { horse } = await lockOwnedHorse(tx, input.accountId, input.horseId);
    if (horse.careerStatus !== "racing") throw new DomainError("HORSE_RETIRED", "already retired");
    if (horse.lockKind === "race") throw new DomainError("HORSE_LOCKED", "horse is entered in a race");
    const [h] = await tx
      .update(horses)
      .set({ careerStatus: "retired", retirementReason: "choice", retiredAt: input.now, updatedAt: input.now })
      .where(eq(horses.id, horse.id))
      .returning();
    await withdrawLeaseOffersTx(tx, horse.id, input.now);
    await audit(tx, { actor: input.accountId, action: "horse.retire", entityType: "horse", entityId: horse.id, data: { reason: "choice", starts: horse.starts } });
    await sendMomentsTx(tx, { accountId: input.accountId, horseName: horse.name, drafts: [gc.retiredMoment(momentHorse(horse), "choice", await careerTribute(tx, h!))], now: input.now });
    return h!;
  });
}

/** Moves a horse to the Legacy Farm (Pasture / Legend). Permanent; frees its stall. */
export async function moveToLegacyFarm(db: Db, input: { accountId: string; horseId: string; now: Date }): Promise<HorseRow> {
  return runTx(db, async (tx) => {
    const { horse } = await lockOwnedHorse(tx, input.accountId, input.horseId);
    if (horse.careerStatus === "pasture") return horse;
    if (horse.lockKind) throw new DomainError("HORSE_LOCKED", "horse is entered in a race or listed");
    if (await isCarrying(tx, horse.id)) throw new DomainError("HORSE_IN_FOAL", "wait until she has foaled");
    const [h] = await tx
      .update(horses)
      .set({
        careerStatus: "pasture",
        retirementReason: horse.retirementReason ?? "choice",
        retiredAt: horse.retiredAt ?? input.now,
        pasturedAt: input.now,
        studFee: null,
        studFeeUsdg: null,
        updatedAt: input.now,
      })
      .where(eq(horses.id, horse.id))
      .returning();
    await withdrawLeaseOffersTx(tx, horse.id, input.now);
    await audit(tx, { actor: input.accountId, action: "horse.legacy_farm", entityType: "horse", entityId: horse.id });
    await sendMomentsTx(tx, { accountId: input.accountId, horseName: horse.name, drafts: [gc.legacyMoment(momentHorse(horse), await careerTribute(tx, h!))], now: input.now });
    return h!;
  });
}

/** Releases a horse to the Club for a few credits. Allowed for bound horses too; frees the stall. */
export async function releaseToClub(db: Db, input: { accountId: string; horseId: string; now: Date }): Promise<{ payout: number }> {
  return runTx(db, async (tx) => {
    const { horse, stableId } = await lockOwnedHorse(tx, input.accountId, input.horseId);
    if (horse.lockKind) throw new DomainError("HORSE_LOCKED", "horse is entered in a race or listed");
    if (await isCarrying(tx, horse.id)) throw new DomainError("HORSE_IN_FOAL", "wait until she has foaled");
    await tx
      .update(horses)
      .set({ ownerStableId: null, releasedAt: input.now, releasedFromStableId: stableId, studFee: null, studFeeUsdg: null, updatedAt: input.now })
      .where(eq(horses.id, horse.id));
    await withdrawLeaseOffersTx(tx, horse.id, input.now);
    await grantCreditsTx(tx, { accountId: input.accountId, amount: RULES.releasePayout, idempotencyKey: `release:${horse.id}:${stableId}`, kind: "adjustment", memo: "released to the Club" });
    await audit(tx, { actor: input.accountId, action: "horse.release", entityType: "horse", entityId: horse.id, data: { fromStable: stableId } });
    return { payout: RULES.releasePayout };
  });
}

export async function renameHorse(db: Db, input: { accountId: string; horseId: string; name: string }): Promise<string> {
  const check = gc.validateHorseName(input.name);
  if (!check.ok) throw new DomainError("INVALID_INPUT", check.message, { problem: check.problem });
  return runTx(db, async (tx) => {
    const { horse } = await lockOwnedHorse(tx, input.accountId, input.horseId);
    if (horse.starts > 0) throw new DomainError("NOT_ELIGIBLE", "a horse can only be renamed before its first start");
    if (gc.nameKey(horse.name) === gc.nameKey(check.name) && horse.name === check.name) return check.name;
    const name = await claimChosenName(tx, check.name, { exceptHorseId: horse.id });
    await tx.update(horses).set({ name }).where(eq(horses.id, horse.id));
    await audit(tx, { actor: input.accountId, action: "horse.rename", entityType: "horse", entityId: horse.id, data: { from: horse.name, to: name } });
    return name;
  });
}

/** Career-ending-injury insurance (one premium, burned to the treasury). */
export async function buyInsurance(db: Db, input: { accountId: string; horseId: string }): Promise<void> {
  await runTx(db, async (tx) => {
    // The owner insures (and is paid out), even while the horse is away on lease.
    const { horse } = await lockOwnedHorse(tx, input.accountId, input.horseId, { allowOnLease: true });
    if (horse.insured) return;
    if (horse.careerStatus !== "racing") throw new DomainError("HORSE_RETIRED", "only racing horses can be insured");
    const premium = isGenome(horse.genome) ? gc.insurancePremium(toHorseState(horse)) : RULES.insurancePremium;
    await spendCreditsTx(tx, { accountId: input.accountId, amount: premium, idempotencyKey: `insurance:${horse.id}`, kind: "insurance_premium", sink: "treasury" });
    await tx.update(horses).set({ insured: true }).where(eq(horses.id, horse.id));
  });
}

/** Stand a stallion at public stud (fee in credits) or withdraw him (null). */
export async function setStudFee(db: Db, input: { accountId: string; horseId: string; fee: number | null; now?: Date }): Promise<void> {
  await runTx(db, async (tx) => {
    const { horse } = await lockOwnedHorse(tx, input.accountId, input.horseId);
    if (input.fee !== null && (horse.sex !== "male" || horse.gelded || horse.careerStatus === "pasture")) {
      throw new DomainError("BREEDING_NOT_ELIGIBLE", "only entire stallions not on the Legacy Farm can stand at stud");
    }
    if (input.fee !== null && (!Number.isSafeInteger(input.fee) || input.fee < 0)) throw new DomainError("INVALID_INPUT", "bad fee");
    if (input.fee !== null && isGenome(horse.genome)) {
      const ceiling = gc.studFeeCeiling(toHorseState(horse));
      if (input.fee > ceiling) throw new DomainError("INVALID_INPUT", `the stud fee can be at most ${ceiling} credits (his appraisal)`);
    }
    await tx.update(horses).set({ studFee: input.fee, studFeeUsdg: null }).where(eq(horses.id, horse.id));
    // standing at stud can't be leased: withdraw an open lease offer instead of leaving it stale
    if (input.fee !== null) await withdrawLeaseOffersTx(tx, horse.id, input.now ?? new Date());
  });
}

/** Number of starts a horse has on the given UTC day (by race post time); `liveOnly` counts Live races only. */
export async function startsOnDay(ex: Executor, horseId: string, at: Date, opts: { liveOnly?: boolean } = {}): Promise<number> {
  const rows = await ex.execute(sql`
    select count(*)::int as n from race_entries e join races r on r.id = e.race_id
     where e.horse_id = ${horseId} and r.status <> 'cancelled' and e.status = 'entered'
       ${opts.liveOnly ? sql`and r.kind in ('scheduled','feature','final')` : sql``}
       and r.post_time >= (${utcDay(at)}::date)::timestamp at time zone 'UTC'
       and r.post_time < (${utcDay(at)}::date + 1)::timestamp at time zone 'UTC'`);
  const list = (Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? [])) as { n: number }[];
  return Number(list[0]?.n ?? 0);
}

/** The horse's owner stable (never the lessee). */
export async function stableIdOfHorse(ex: Executor, horseId: string): Promise<string | null> {
  const [r] = await ex.select({ s: horses.ownerStableId }).from(horses).where(eq(horses.id, horseId));
  return r?.s ?? null;
}

