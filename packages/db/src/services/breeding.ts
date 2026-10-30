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
 *
 * USDG stud fees (docs/usdg-market.md): a stallion registered for the USDG market may stand at
 * stud for a USDG fee instead of credits (horses.stud_fee_usdg). Booking him goes through a signed
 * StudOrder (services/usdgStud.ts); the covering runs here (`coverTx` with `usdg`) only after the
 * payment is verified. Live stud orders hold one of his season (and lifetime) slots each, so
 * neither a credits covering nor another booking can take the slot a mare owner is paying for.
 */
import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { commitSeed, newSeed } from "../crypto";
import { DomainError, type DomainErrorCode } from "../errors";
import { breedingEvents, horses, inboxItems, lineageEdges, pregnancies, type HorseRow, type PregnancyRow } from "../schema";
import { RULES, seasonNumberAt, type GameHooks } from "../rules";
import { gc, toHorseState } from "../gameCore";
import { defaultHooks } from "../hooks";
import type { Db, Executor } from "../types";
import { accountIdOfStable, areLinked, assertStallFree, insertHorse, lockStable, occupancy, stableOf } from "./accounts";
import { playerLedgerAccountId, post, systemAccountId, type Posting } from "./ledger";
import { audit, runTx } from "./tx";
import { studHoldsOf } from "./usdgMarket";

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

/** A stallion's breeding state with `held` booked slots counted as used this season (and for life). */
export function withStudHolds(state: gc.HorseState, season: number, held: number): gc.HorseState {
  if (held <= 0) return state;
  const bySeason = state.breeding.bySeason.some((b) => b.season === season)
    ? state.breeding.bySeason.map((b) => (b.season === season ? { ...b, count: b.count + held } : b))
    : [...state.breeding.bySeason, { season, count: held }];
  return { ...state, breeding: { ...state.breeding, used: state.breeding.used + held, bySeason } };
}

export const BREED_BLOCK_CODES: Record<gc.BreedBlock, DomainErrorCode> = {
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

/** A covering whose USDG stud fee was paid on-chain and verified (services/usdgStud.ts). */
export interface UsdgCoverInput {
  /** usdg_orders.id: the mare is locked to it (lock_kind 'stud'). */
  orderRowId: string;
  orderId: string;
  /** Credits base fee held in escrow at the quote: burned now. */
  creditsHeld: number;
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
  return runTx(db, (tx) => coverTx(tx, input));
}

/**
 * The covering, inside the caller's transaction. Without `usdg`: an ordinary covering paid in
 * credits (base fee + the stallion's credits stud fee). With `usdg`: the stud fee was paid in USDG
 * (verified on-chain); the base fee comes out of the escrow hold and the mare's booking lock is
 * accepted. Every breeding rule is checked the same way in both cases.
 */
export async function coverTx(tx: Executor, input: BreedInput & { usdg?: UsdgCoverInput }): Promise<BreedResult> {
  const usdg = input.usdg;
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
  // Horses on lease never breed (rent racers, buy breeders): neither the owner nor the lessee.
  if (dam.lesseeStableId) throw new DomainError("HORSE_ON_LEASE", "the mare is away on lease");
  if (sire.lesseeStableId) throw new DomainError("HORSE_ON_LEASE", "the stallion is away on lease");
  const ownSire = sire.ownerStableId === stable.id;
  if (usdg) {
    // Paid in USDG for this stallion: honoured even if his owner changed his fee since.
    if (ownSire) throw new DomainError("NOT_ELIGIBLE", "a USDG stud fee is never paid to yourself");
  } else if (!ownSire && sire.studFeeUsdg !== null) {
    throw new DomainError("USDG_ONLY", "this stallion stands at stud for a USDG fee: book him with Pay in USDG");
  } else if (!ownSire && (sire.studFee === null || (sire.ownerStableId === null && sire.origin !== "house"))) {
    throw new DomainError("NOT_OWNER", "that stallion is not standing at stud");
  }
  const bookedForThis = !!usdg && dam.lockKind === "stud" && dam.lockRef === usdg.orderRowId;
  if (dam.lockKind && !bookedForThis) {
    throw new DomainError("HORSE_LOCKED", dam.lockKind === "stud" ? "the mare is booked for a USDG covering" : "the mare is entered in a race or listed");
  }
  if (sire.lockKind === "market") throw new DomainError("HORSE_LOCKED", "the stallion is listed for sale");

  // The rules (kinship, sexes, racing age, 25 starts or retired, Legacy Farm, lifetime 4,
  // mare 1 / stallion 4 per season, mare in foal) are game-core's pairingBlock over states
  // built from the locked rows and the breeding tables.
  const season = seasonNumberAt(input.now);
  const [carrying] = await tx.select().from(pregnancies).where(and(eq(pregnancies.damId, dam.id), eq(pregnancies.status, "carrying")));
  // Slots held by other live USDG bookings count as used (the one being fulfilled excluded).
  const held = await studHoldsOf(tx, sire.id, input.now, usdg?.orderId);
  const sireState = withStudHolds(toHorseState(sire, { bySeason: await coversBySeason(tx, sire.id, "sire") }), season, held);
  const damState = toHorseState(dam, { bySeason: await coversBySeason(tx, dam.id, "dam"), pregnancy: carrying ?? null });
  const ped = await pedigreeIndex(tx, [sire.id, dam.id]);
  const block = gc.pairingBlock(sireState, damState, ped, season);
  if (block) throw new DomainError(BREED_BLOCK_CODES[block], `breeding blocked: ${block}`, { block });

  // The foal needs a stall, or the single nursery overflow slot.
  await assertStallFree(tx, lockedStable, { allowOverflow: true });

  // Fees (game-core breedingFees): base fee burned; stud fee to the sire's owner minus the 10% burn.
  // A USDG covering has no credits stud fee (paid on-chain); its base fee was held at the quote.
  const fees = gc.breedingFees(usdg ? 0 : (sire.studFee ?? 0), ownSire);
  // Paid coverings between linked accounts would move credits between them (as market sales
  // between linked accounts would): refused, like the market's guard. (USDG bookings are
  // refused between linked accounts at the quote, services/usdgStud.ts.)
  if (!usdg && !ownSire && fees.studFee > 0 && sire.ownerStableId) {
    const sireAccount = await accountIdOfStable(tx, sire.ownerStableId);
    if (await areLinked(tx, input.accountId, sireAccount)) throw new DomainError("LINKED_ACCOUNTS", "paid coverings between linked accounts are not allowed");
  }
  const baseFee = usdg ? usdg.creditsHeld : (input.baseFee ?? fees.baseFee);
  const burned = fees.burned - fees.baseFee + baseFee;
  const total = baseFee + fees.studFee;
  const postings: Posting[] = [];
  let ledgerTransactionId: string | null = null;
  if (usdg) {
    if (baseFee > 0) {
      postings.push({ ledgerAccountId: await systemAccountId(tx, "escrow"), amount: -baseFee }, { ledgerAccountId: await systemAccountId(tx, "burn"), amount: baseFee });
      ledgerTransactionId = (await post(tx, { idempotencyKey: `usdg-stud-base:${usdg.orderId}`, kind: "breeding_fee", postings })).transactionId;
    }
  } else if (total > 0) {
    postings.push({ ledgerAccountId: await playerLedgerAccountId(tx, input.accountId), amount: -total });
    if (burned > 0) postings.push({ ledgerAccountId: await systemAccountId(tx, "burn"), amount: burned });
    if (fees.toStallionOwner > 0) {
      // A Club house stallion's share goes to the Club treasury (houseStuds.ts).
      const owner =
        sire.ownerStableId === null
          ? await systemAccountId(tx, "treasury")
          : await playerLedgerAccountId(tx, await accountIdOfStable(tx, sire.ownerStableId));
      postings.push({ ledgerAccountId: owner, amount: fees.toStallionOwner });
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
  if (bookedForThis) await tx.update(horses).set({ lockKind: null, lockRef: null }).where(eq(horses.id, dam.id));
  // the stallion's last covering retires him for good now (the mare goes once she has foaled)
  await retireSpentBreeders(tx, [sire.id], input.now);
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
    data: { sireId: sire.id, damId: dam.id, season, coiBp, seedCommitment: preg!.seedCommitment, ...(usdg ? { usdgOrderId: usdg.orderId } : {}) },
  });
  return { breedingEventId: event!.id, pregnancyId: preg!.id, dueAt, seedCommitment: preg!.seedCommitment, coiBp, duplicate: false };
}

/**
 * A horse at stud / broodmare that has used its last breeding retires for good to the Legacy
 * Farm (frees its stall, stops standing at stud), and its owner gets a note. Racing horses that
 * breed keep racing; a mare in foal goes after foaling; listed horses wait for the listing.
 */
async function retireSpentBreeders(ex: Executor, ids: readonly string[], now: Date): Promise<string[]> {
  if (!ids.length) return [];
  const spent = await ex
    .update(horses)
    .set({ careerStatus: "pasture", pasturedAt: now, studFee: null, studFeeUsdg: null, updatedAt: now })
    .where(and(inArray(horses.id, [...ids]), eq(horses.careerStatus, "retired"), gte(horses.breedingCount, RULES.breedingLifetimeLimit), isNull(horses.lockKind)))
    .returning();
  for (const h of spent) {
    if (!h.ownerStableId) continue;
    await ex
      .insert(inboxItems)
      .values({
        accountId: await accountIdOfStable(ex, h.ownerStableId),
        kind: "retired",
        dedupeKey: `retired-spent:${h.id}`,
        title: `${h.name} has used every breeding and retired for good to the Legacy Farm`,
        data: { reason: "breedings_used" },
        horseId: h.id,
        createdAt: now,
      })
      .onConflictDoNothing();
  }
  return spent.map((h) => h.id);
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

/** The four grandparents of a sire x dam foal that are on record (foundation stock has none). */
export async function grandparentsOf(ex: Executor, sire: Pick<HorseRow, "sireId" | "damId">, dam: Pick<HorseRow, "sireId" | "damId">): Promise<HorseRow[]> {
  const ids = [sire.sireId, sire.damId, dam.sireId, dam.damId].filter((x): x is string => !!x);
  if (!ids.length) return [];
  const rows = await ex.select().from(horses).where(inArray(horses.id, [...new Set(ids)]));
  // a shared grandparent (half-sibling parents) counts once per appearance
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is HorseRow => !!r);
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
  // The foal's grandparents set its family limits (game-core familyRange).
  const family = await grandparentsOf(tx, sire, dam);
  const spec = hooks.breedFoal({ seed: preg.seed, sire, dam, name: input.name, coi: preg.coi, season: seasonNumberAt(input.now), family });
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
    nameMode: input.name ? "chosen" : "system",
  });
  await insertLineage(tx, foalId, sire.id, dam.id);
  const [updated] = await tx
    .update(pregnancies)
    .set({ status: "foaled", foalId, foaledAt: input.now, seedRevealed: true })
    .where(eq(pregnancies.id, preg.id))
    .returning();
  await retireSpentBreeders(tx, [dam.id], input.now);
  const inOverflow = ownerStable ? (await occupancy(tx, ownerStable)).overflow : false;
  await audit(tx, { actor: null, action: "breeding.foal", entityType: "horse", entityId: foalId, data: { pregnancyId: preg.id, seed: preg.seed, inOverflow } });
  return { foalId, pregnancy: updated!, inOverflow, alreadyFoaled: false };
}

export async function listDuePregnancies(ex: Executor, now: Date): Promise<PregnancyRow[]> {
  return ex.select().from(pregnancies).where(and(eq(pregnancies.status, "carrying"), lte(pregnancies.dueAt, now)));
}
