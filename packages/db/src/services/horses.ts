/**
 * Horse lifecycle: care, training plans, retirement, Legacy Farm, release to the Club,
 * insurance, stud listing. Nothing here (or anywhere) changes a horse because time
 * passed, except healing and pregnancy completion (see maintenance.ts).
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { utcDay } from "../crypto";
import { DomainError } from "../errors";
import { careLog, horses, pregnancies, trainingPlans, type HorseRow } from "../schema";
import { RULES, stageFor } from "../rules";
import type { Db, Executor } from "../types";
import { recordPlayDay, stableOf } from "./accounts";
import { grantCreditsTx, spendCreditsTx } from "./ledger";
import { audit, runTx } from "./tx";

export async function getHorse(ex: Executor, horseId: string): Promise<HorseRow | null> {
  const [h] = await ex.select().from(horses).where(eq(horses.id, horseId));
  return h ?? null;
}

export async function listStableHorses(ex: Executor, stableId: string): Promise<HorseRow[]> {
  return ex.select().from(horses).where(eq(horses.ownerStableId, stableId)).orderBy(asc(horses.createdAt), asc(horses.id));
}

export async function lockHorse(ex: Executor, horseId: string): Promise<HorseRow> {
  const [h] = await ex.select().from(horses).where(eq(horses.id, horseId)).for("update");
  if (!h) throw new DomainError("NOT_FOUND", "horse not found");
  return h;
}

/** Locks the horse and checks the account's stable owns it. */
export async function lockOwnedHorse(ex: Executor, accountId: string, horseId: string): Promise<{ horse: HorseRow; stableId: string }> {
  const stable = await stableOf(ex, accountId);
  const horse = await lockHorse(ex, horseId);
  if (horse.ownerStableId !== stable.id) throw new DomainError("NOT_OWNER", "not your horse");
  return { horse, stableId: stable.id };
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
    const { horse } = await lockOwnedHorse(tx, input.accountId, input.horseId);
    const day = utcDay(input.now);
    const inserted = await tx
      .insert(careLog)
      .values({ horseId: horse.id, accountId: input.accountId, day, actions: input.actions, quality: input.quality ?? 0 })
      .onConflictDoNothing({ target: [careLog.horseId, careLog.day] })
      .returning({ id: careLog.id });
    if (!inserted[0]) throw new DomainError("ALREADY_CARED_TODAY", "this horse has already been cared for today");
    const careSessions = horse.careSessions + 1;
    const stage = stageFor(careSessions, horse.starts);
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
    const { horse } = await lockOwnedHorse(tx, input.accountId, input.horseId);
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
    await audit(tx, { actor: input.accountId, action: "horse.retire", entityType: "horse", entityId: horse.id, data: { reason: "choice", starts: horse.starts } });
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
        updatedAt: input.now,
      })
      .where(eq(horses.id, horse.id))
      .returning();
    await audit(tx, { actor: input.accountId, action: "horse.legacy_farm", entityType: "horse", entityId: horse.id });
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
      .set({ ownerStableId: null, releasedAt: input.now, releasedFromStableId: stableId, studFee: null, updatedAt: input.now })
      .where(eq(horses.id, horse.id));
    await grantCreditsTx(tx, { accountId: input.accountId, amount: RULES.releasePayout, idempotencyKey: `release:${horse.id}:${stableId}`, kind: "adjustment", memo: "released to the Club" });
    await audit(tx, { actor: input.accountId, action: "horse.release", entityType: "horse", entityId: horse.id, data: { fromStable: stableId } });
    return { payout: RULES.releasePayout };
  });
}

export async function renameHorse(db: Db, input: { accountId: string; horseId: string; name: string }): Promise<void> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 32) throw new DomainError("INVALID_INPUT", "name must be 1-32 characters");
  await runTx(db, async (tx) => {
    const { horse } = await lockOwnedHorse(tx, input.accountId, input.horseId);
    if (horse.starts > 0) throw new DomainError("NOT_ELIGIBLE", "a horse can only be renamed before its first start");
    await tx.update(horses).set({ name }).where(eq(horses.id, horse.id));
  });
}

/** Career-ending-injury insurance (one premium, burned to the treasury). */
export async function buyInsurance(db: Db, input: { accountId: string; horseId: string }): Promise<void> {
  await runTx(db, async (tx) => {
    const { horse } = await lockOwnedHorse(tx, input.accountId, input.horseId);
    if (horse.insured) return;
    if (horse.careerStatus !== "racing") throw new DomainError("HORSE_RETIRED", "only racing horses can be insured");
    await spendCreditsTx(tx, { accountId: input.accountId, amount: RULES.insurancePremium, idempotencyKey: `insurance:${horse.id}`, kind: "insurance_premium", sink: "treasury" });
    await tx.update(horses).set({ insured: true }).where(eq(horses.id, horse.id));
  });
}

/** Stand a stallion at public stud (fee in credits) or withdraw him (null). */
export async function setStudFee(db: Db, input: { accountId: string; horseId: string; fee: number | null }): Promise<void> {
  await runTx(db, async (tx) => {
    const { horse } = await lockOwnedHorse(tx, input.accountId, input.horseId);
    if (input.fee !== null && (horse.sex !== "male" || horse.gelded || horse.careerStatus === "pasture")) {
      throw new DomainError("BREEDING_NOT_ELIGIBLE", "only entire stallions not on the Legacy Farm can stand at stud");
    }
    if (input.fee !== null && (!Number.isSafeInteger(input.fee) || input.fee < 0)) throw new DomainError("INVALID_INPUT", "bad fee");
    await tx.update(horses).set({ studFee: input.fee }).where(eq(horses.id, horse.id));
  });
}

/** Number of starts a horse has on the given UTC day (by race post time). */
export async function startsOnDay(ex: Executor, horseId: string, at: Date): Promise<number> {
  const rows = await ex.execute(sql`
    select count(*)::int as n from race_entries e join races r on r.id = e.race_id
     where e.horse_id = ${horseId} and r.status <> 'cancelled'
       and r.post_time >= (${utcDay(at)}::date)::timestamp at time zone 'UTC'
       and r.post_time < (${utcDay(at)}::date + 1)::timestamp at time zone 'UTC'`);
  const list = (Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? [])) as { n: number }[];
  return Number(list[0]?.n ?? 0);
}

export async function stableIdOfHorse(ex: Executor, horseId: string): Promise<string | null> {
  const [r] = await ex.select({ s: horses.ownerStableId }).from(horses).where(eq(horses.id, horseId));
  return r?.s ?? null;
}

