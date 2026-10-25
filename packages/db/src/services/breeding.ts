/**
 * Breeding → pregnancy → foaling.
 *
 * All limits are checked with both horses row-locked (in id order, so concurrent covers
 * cannot deadlock), and the database backs every one of them:
 *   - lifetime 4: CHECK horses.breeding_count between 0 and 4;
 *   - mare once per season: unique (dam_id, season_number);
 *   - one pregnancy at a time: partial unique index on carrying pregnancies;
 *   - self-breeding: CHECK on breeding_events and horses.
 * Kinship (parent/child, full siblings) is checked from the pedigree.
 */
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { commitSeed, newSeed } from "../crypto";
import { DomainError, type DomainErrorCode } from "../errors";
import { breedingEvents, horses, lineageEdges, pregnancies, type HorseRow, type PregnancyRow } from "../schema";
import { RULES, seasonNumberAt, type GameHooks } from "../rules";
import { gc, toHorseState } from "../gameCore";
import { defaultHooks } from "../hooks";
import type { Db, Executor } from "../types";
import { accountIdOfStable, assertStallFree, insertHorse, lockStable, occupancy, stableOf } from "./accounts";
import { playerLedgerAccountId, post, systemAccountId, type Posting } from "./ledger";
import { audit, runTx } from "./tx";

/** Max pedigree depth stored in the closure table (game-core COI depth). */
export const LINEAGE_MAX_DEPTH = gc.COI_MAX_DEPTH;

/** game-core pedigree index for the horses and every stored ancestor of them. */
export async function pedigreeIndex(ex: Executor, ids: string[]): Promise<gc.PedigreeIndex> {
  const anc = await ex.selectDistinct({ id: lineageEdges.ancestorId }).from(lineageEdges).where(inArray(lineageEdges.descendantId, ids));
  const all = [...new Set([...ids, ...anc.map((a) => a.id)])];
  const rows = await ex
    .select({ id: horses.id, sireId: horses.sireId, damId: horses.damId, generation: horses.generation })
    .from(horses)
    .where(inArray(horses.id, all));
  return Object.fromEntries(rows.map((r) => [r.id, { sireId: r.sireId, damId: r.damId, generation: r.generation }]));
}

/** Coefficient of inbreeding of a prospective foal (game-core coiOf), in basis points. */
export async function estimateCoiBp(ex: Executor, sireId: string, damId: string): Promise<number> {
  return gc.coiOf(sireId, damId, await pedigreeIndex(ex, [sireId, damId])) * 10;
}

async function coversBySeason(ex: Executor, horseId: string, role: "sire" | "dam") {
  const col = role === "sire" ? breedingEvents.sireId : breedingEvents.damId;
  const rows = await ex
    .select({ season: breedingEvents.seasonNumber, count: sql<number>`count(*)::int` })
    .from(breedingEvents)
    .where(eq(col, horseId))
    .groupBy(breedingEvents.seasonNumber);
  return rows.map((r) => ({ season: r.season, count: Number(r.count) }));
}

const BREED_BLOCK_CODES: Record<gc.BreedBlock, DomainErrorCode> = {
  self: "SELF_BREEDING",
  parent_child: "KIN_BREEDING",
  full_siblings: "KIN_BREEDING",
  sire_not_male: "BREEDING_NOT_ELIGIBLE",
  dam_not_female: "BREEDING_NOT_ELIGIBLE",
  gelding: "BREEDING_NOT_ELIGIBLE",
  not_racing_age: "BREEDING_NOT_ELIGIBLE",
  not_breeding_eligible: "BREEDING_NOT_ELIGIBLE",
  pastured: "BREEDING_NOT_ELIGIBLE",
  lifetime_limit: "BREEDING_LIMIT",
  season_limit: "BREEDING_SEASON_LIMIT",
  dam_in_foal: "HORSE_IN_FOAL",
};

export interface BreedInput {
  accountId: string;
  sireId: string;
  damId: string;
  now: Date;
  idempotencyKey: string;
  baseFee?: number;
}

export interface BreedResult {
  breedingEventId: string;
  pregnancyId: string;
  dueAt: Date;
  seedCommitment: string;
  coiBp: number;
  duplicate: boolean;
}

export async function breed(db: Db, input: BreedInput): Promise<BreedResult> {
  return runTx(db, async (tx) => {
    const prior = await tx.select().from(breedingEvents).where(eq(breedingEvents.idempotencyKey, input.idempotencyKey));
    if (prior[0]) {
      const [p] = await tx.select().from(pregnancies).where(eq(pregnancies.breedingEventId, prior[0].id));
      return { breedingEventId: prior[0].id, pregnancyId: p!.id, dueAt: p!.dueAt, seedCommitment: p!.seedCommitment, coiBp: prior[0].coiBp, duplicate: true };
    }
    if (input.sireId === input.damId) throw new DomainError("SELF_BREEDING", "a horse cannot breed with itself");

    // Stable first, then horses in id order: one global lock order.
    const stable = await stableOf(tx, input.accountId);
    const lockedStable = await lockStable(tx, stable.id);
    const locked = await tx
      .select()
      .from(horses)
      .where(inArray(horses.id, [input.sireId, input.damId]))
      .orderBy(asc(horses.id))
      .for("update");
    const sire = locked.find((h) => h.id === input.sireId);
    const dam = locked.find((h) => h.id === input.damId);
    if (!sire || !dam) throw new DomainError("NOT_FOUND", "horse not found");

    if (dam.ownerStableId !== stable.id) throw new DomainError("NOT_OWNER", "you must own the mare");
    const ownSire = sire.ownerStableId === stable.id;
    if (!ownSire && sire.studFee === null) throw new DomainError("NOT_OWNER", "that stallion is not standing at stud");
    if (dam.lockKind) throw new DomainError("HORSE_LOCKED", "the mare is entered in a race or listed");
    if (sire.lockKind === "market") throw new DomainError("HORSE_LOCKED", "the stallion is listed for sale");

    // The rules (kinship, sexes, racing age, 25 starts or retired, Legacy Farm, lifetime 4,
    // mare 1 / stallion 4 per season, mare in foal) are game-core's pairingBlock over states
    // built from the locked rows and the breeding tables.
    const season = seasonNumberAt(input.now);
    const [carrying] = await tx.select().from(pregnancies).where(and(eq(pregnancies.damId, dam.id), eq(pregnancies.status, "carrying")));
    const sireState = toHorseState(sire, { bySeason: await coversBySeason(tx, sire.id, "sire") });
    const damState = toHorseState(dam, { bySeason: await coversBySeason(tx, dam.id, "dam"), pregnancy: carrying ?? null });
    const ped = await pedigreeIndex(tx, [sire.id, dam.id]);
    const block = gc.pairingBlock(sireState, damState, ped, season);
    if (block) throw new DomainError(BREED_BLOCK_CODES[block], `breeding blocked: ${block}`, { block });

    // The foal needs a stall, or the single nursery overflow slot.
    await assertStallFree(tx, lockedStable, { allowOverflow: true });

    // Fees (game-core breedingFees): base fee burned; stud fee to the sire's owner minus the 10% burn.
    const fees = gc.breedingFees(sire.studFee ?? 0, ownSire);
    const baseFee = input.baseFee ?? fees.baseFee;
    const burned = fees.burned - fees.baseFee + baseFee;
    const total = baseFee + fees.studFee;
    const postings: Posting[] = [];
    let ledgerTransactionId: string | null = null;
    if (total > 0) {
      postings.push({ ledgerAccountId: await playerLedgerAccountId(tx, input.accountId), amount: -total });
      if (burned > 0) postings.push({ ledgerAccountId: await systemAccountId(tx, "burn"), amount: burned });
      if (fees.toStallionOwner > 0) {
        const sireOwner = await accountIdOfStable(tx, sire.ownerStableId!);
        postings.push({ ledgerAccountId: await playerLedgerAccountId(tx, sireOwner), amount: fees.toStallionOwner });
      }
      ledgerTransactionId = (await post(tx, { idempotencyKey: `breed:${input.idempotencyKey}`, kind: "breeding_fee", postings })).transactionId;
    }
    const studFee = fees.studFee;
    const coi = gc.coiOf(sire.id, dam.id, ped);
    const coiBp = coi * 10;
    const [event] = await tx
      .insert(breedingEvents)
      .values({
        sireId: sire.id,
        damId: dam.id,
        requestedBy: input.accountId,
        sireOwnerStableId: sire.ownerStableId,
        damOwnerStableId: dam.ownerStableId,
        seasonNumber: season,
        baseFee,
        studFee,
        coiBp,
        ledgerTransactionId,
        idempotencyKey: input.idempotencyKey,
        createdAt: input.now,
      })
      .returning();
    await tx.update(horses).set({ breedingCount: sql`${horses.breedingCount} + 1`, updatedAt: input.now }).where(inArray(horses.id, [sire.id, dam.id]));
    const seed = newSeed();
    const dueAt = new Date(input.now.getTime() + RULES.pregnancyMs);
    const [preg] = await tx
      .insert(pregnancies)
      .values({ breedingEventId: event!.id, sireId: sire.id, damId: dam.id, conceivedAt: input.now, dueAt, seed, seedCommitment: commitSeed(seed), coi })
      .returning();
    await audit(tx, {
      actor: input.accountId,
      action: "breeding.cover",
      entityType: "breeding_event",
      entityId: event!.id,
      data: { sireId: sire.id, damId: dam.id, season, coiBp, seedCommitment: preg!.seedCommitment },
    });
    return { breedingEventId: event!.id, pregnancyId: preg!.id, dueAt, seedCommitment: preg!.seedCommitment, coiBp, duplicate: false };
  });
}

export interface FoalResult {
  foalId: string;
  pregnancy: PregnancyRow;
  /** The foal arrived while every stall was taken: it occupies the nursery overflow slot. */
  inOverflow: boolean;
  alreadyFoaled: boolean;
}

/** Writes the foal's pedigree closure rows. */
export async function insertLineage(ex: Executor, foalId: string, sireId: string, damId: string): Promise<void> {
  const parentEdges = await ex
    .select()
    .from(lineageEdges)
    .where(and(inArray(lineageEdges.descendantId, [sireId, damId]), lte(lineageEdges.depth, LINEAGE_MAX_DEPTH - 1)));
  const acc = new Map<string, { ancestorId: string; depth: number; paths: number }>();
  const add = (ancestorId: string, depth: number, paths: number) => {
    const k = `${ancestorId}|${depth}`;
    const cur = acc.get(k);
    if (cur) cur.paths += paths;
    else acc.set(k, { ancestorId, depth, paths });
  };
  add(sireId, 1, 1);
  add(damId, 1, 1);
  for (const e of parentEdges) add(e.ancestorId, e.depth + 1, e.paths);
  await ex.insert(lineageEdges).values([...acc.values()].map((v) => ({ ...v, descendantId: foalId })));
}

/**
 * Foaling (idempotent). Never fails for lack of space: the foal was reserved a stall or the
 * nursery overflow slot when the mare was covered, and it always goes to the mare's owner.
 */
export async function foal(
  db: Db,
  input: { pregnancyId: string; now: Date; name?: string },
  hooks: GameHooks = defaultHooks,
): Promise<FoalResult> {
  return runTx(db, (tx) => foalTx(tx, input, hooks));
}

export async function foalTx(
  tx: Executor,
  input: { pregnancyId: string; now: Date; name?: string },
  hooks: GameHooks = defaultHooks,
): Promise<FoalResult> {
  const [preg] = await tx.select().from(pregnancies).where(eq(pregnancies.id, input.pregnancyId)).for("update");
  if (!preg) throw new DomainError("NOT_FOUND", "pregnancy not found");
  if (preg.status === "foaled") return { foalId: preg.foalId!, pregnancy: preg, inOverflow: false, alreadyFoaled: true };
  if (input.now < preg.dueAt) throw new DomainError("TOO_EARLY", "not due yet");
  // Lock order: pregnancy -> stable -> horses (same as breed: stable -> horses).
  // A carrying mare cannot change owner (trigger), so this read is stable.
  const [damOwner] = await tx.select({ s: horses.ownerStableId }).from(horses).where(eq(horses.id, preg.damId));
  const ownerStable = damOwner?.s ? await lockStable(tx, damOwner.s) : null;
  const parents = await tx.select().from(horses).where(inArray(horses.id, [preg.sireId, preg.damId])).orderBy(asc(horses.id)).for("update");
  const sire = parents.find((h) => h.id === preg.sireId)!;
  const dam = parents.find((h) => h.id === preg.damId)!;
  const spec = hooks.breedFoal({ seed: preg.seed, sire, dam, name: input.name, coi: preg.coi, season: seasonNumberAt(input.now) });
  const parentBound = sire.bound || dam.bound;
  const foalId = await insertHorse(tx, {
    stableId: dam.ownerStableId,
    spec: { ...spec, careSessions: 0 },
    origin: "bred",
    sireId: sire.id,
    damId: dam.id,
    generation: Math.max(sire.generation, dam.generation) + 1,
    birthSeasonNumber: seasonNumberAt(input.now),
    // Foals of Club-bred parents are tradeable only after 5 starts.
    tradeMinStarts: parentBound ? 5 : 0,
    now: input.now,
  });
  await insertLineage(tx, foalId, sire.id, dam.id);
  const [updated] = await tx
    .update(pregnancies)
    .set({ status: "foaled", foalId, foaledAt: input.now, seedRevealed: true })
    .where(eq(pregnancies.id, preg.id))
    .returning();
  const inOverflow = ownerStable ? (await occupancy(tx, ownerStable)).overflow : false;
  await audit(tx, { actor: null, action: "breeding.foal", entityType: "horse", entityId: foalId, data: { pregnancyId: preg.id, seed: preg.seed, inOverflow } });
  return { foalId, pregnancy: updated!, inOverflow, alreadyFoaled: false };
}

export async function listDuePregnancies(ex: Executor, now: Date): Promise<PregnancyRow[]> {
  return ex.select().from(pregnancies).where(and(eq(pregnancies.status, "carrying"), lte(pregnancies.dueAt, now)));
}
