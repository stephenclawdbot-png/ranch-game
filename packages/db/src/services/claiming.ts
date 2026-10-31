/**
 * Claiming races: the race is the market (race meetings plan, 2026-10-30, item 4; rules and
 * numbers in game-core claiming.ts).
 *
 *   card.ts publishes at most one claiming race a day (an evening handicap, `conditions.claiming`),
 *       and only when CLAIMING_MIN_ELIGIBLE horses could enter one today (claimingEligibleCount
 *       below): the candidate slot otherwise stays the ordinary handicap it would have been
 *   →  enterRace: the owner sets a claim price (required), inside the market's appraisal band;
 *       only a horse that could be sold for credits today may run (assertTradeableTx, the
 *       market's checks), and not within CLAIM_REENTRY_LOCK_DAYS of being claimed
 *   →  lodgeClaim until entries close: any other stable (not linked to the owner: same refusal and
 *       fraud event as the market) with a free stall and the credits; the price is held in escrow;
 *       one claim per stable per race, and a lodged claim holds a stall until it is decided
 *   →  lockField: more than one claim on a horse is decided by a draw from the race seed (the
 *       losers are refunded); a scratch or a called-off / abandoned race refunds every claim
 *   →  settleRace: the horse moves to the winning claimant whatever the result (injured too);
 *       the old owner keeps the purse and receives the price minus the market's fee (burned);
 *       a fatal injury, or a claimant whose stalls filled up meanwhile, voids the claim (refund).
 *
 * Ledger kinds: `claim_escrow` (claimant → escrow), `claim_refund` (escrow → claimant),
 * `claim_sale` (escrow → old owner, fee → burn). Every posting is keyed by the claim, so retries
 * never move credits twice. The resale lock (market.ts resaleLock) reads claimed rows too.
 */
import { and, asc, eq, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { DomainError } from "../errors";
import { bandRatingOf, gc, isGenome, toHorseState } from "../gameCore";
import { fraudEvents, horseLeaseListings, horses, inboxItems, pregnancies, raceClaims, raceEntries, races, stables, trades, type HorseRow, type RaceClaimRow, type RaceRow, type StableRow } from "../schema";
import { RULES, defaultAppraise, type GameHooks } from "../rules";
import { defaultHooks } from "../hooks";
import type { Db, Executor, Tx } from "../types";
import { accountIdOfStable, areLinked, lockStable, lockStableOf, occupancy } from "./accounts";
import { assertTradeableTx, sellerEligibility } from "./market";
import { isUsdgRegistered, usdgRegisteredIds } from "./usdgMarket";
import { playerLedgerAccountId, post, spendCreditsTx, systemAccountId } from "./ledger";
import { audit, runTx } from "./tx";

/** A claiming race: its conditions say so (card.ts; sister courses copy the conditions). */
export const isClaimingRace = (race: Pick<RaceRow, "conditions">): boolean => ((race.conditions ?? {}) as { claiming?: unknown }).claiming === true;

/** Claims still waiting on the race (they hold the claimant's credits and a stall). */
const PENDING = ["lodged", "drawn"] as const;

/** The horse's appraisal as the market computes it (game-core for genome horses). */
export function appraisalOf(horse: HorseRow, hooks: GameHooks = defaultHooks): number {
  return isGenome(horse.genome) ? gc.appraise(toHorseState(horse)) : (hooks.appraise ?? defaultAppraise)(horse);
}

/** The claim price band for this horse (the market's 70%-300% of the appraisal). */
export function claimPriceBand(horse: HorseRow, hooks: GameHooks = defaultHooks): { appraisal: number; min: number; max: number } {
  const appraisal = appraisalOf(horse, hooks);
  return { appraisal, ...gc.claimPriceBounds(appraisal) };
}

/** When the horse was last claimed and the end of its claiming re-entry lock, while it lasts. */
export async function claimReentryLock(ex: Executor, horseId: string, now: Date): Promise<Date | null> {
  const [c] = await ex
    .select({ closedAt: raceClaims.closedAt })
    .from(raceClaims)
    .where(and(eq(raceClaims.horseId, horseId), eq(raceClaims.status, "claimed"), gt(raceClaims.closedAt, new Date(now.getTime() - gc.CLAIM_REENTRY_LOCK_MS))))
    .orderBy(sql`${raceClaims.closedAt} desc`)
    .limit(1);
  return c?.closedAt ? new Date(c.closedAt.getTime() + gc.CLAIM_REENTRY_LOCK_MS) : null;
}

/**
 * Horses that could enter a claiming race today: still racing and of racing age, inside the
 * band (the band rating, as the entry sheet checks it), and tradeable for credits — the same
 * checks `assertTradeableTx` runs at entry (binding, trade starts, lease, locks, USDG
 * registration, in foal, resale lock, the owner's seller requirements). This is the yardstick of
 * game-core `CLAIMING_MIN_ELIGIBLE`: card.ts counts it when the card is published, and the
 * evening meeting's claiming slot only becomes a claiming race when there are enough.
 *
 * Read-only and best-effort by design (an injury or a listing tomorrow changes nothing about a
 * race already published); `readLimit` caps the candidate read, so a world at the cap reports
 * at least that many.
 */
export async function claimingEligibleCount(
  ex: Executor,
  input: { minRating?: number; maxRating?: number; now: Date; readLimit?: number },
): Promise<number> {
  const rows = await ex
    .select({ horse: horses, accountId: stables.accountId })
    .from(horses)
    .innerJoin(stables, eq(stables.id, horses.ownerStableId))
    .where(
      and(
        eq(horses.careerStatus, "racing"),
        gte(horses.careSessions, RULES.careToRacing),
        eq(horses.bound, false),
        gte(horses.starts, horses.tradeMinStarts),
        isNull(horses.lesseeStableId),
        isNull(horses.lockKind),
        isNull(horses.releasedAt),
        or(isNull(horses.injuredUntil), lte(horses.injuredUntil, input.now)),
        input.minRating !== undefined ? gte(horses.rating, input.minRating) : undefined,
      ),
    )
    .limit(input.readLimit ?? 500);
  if (!rows.length) return 0;
  const inBand = input.maxRating === undefined ? rows : rows.filter((r) => bandRatingOf(r.horse).rating <= input.maxRating!);
  if (!inBand.length) return 0;
  const ids = inBand.map((r) => r.horse.id);
  // The per-horse market locks, one query each.
  const usdg = await usdgRegisteredIds(ex, ids);
  const carrying = new Set(
    (await ex
      .select({ damId: pregnancies.damId })
      .from(pregnancies)
      .where(and(inArray(pregnancies.damId, ids), eq(pregnancies.status, "carrying")))).map((r) => r.damId),
  );
  const leaseOffered = new Set(
    (await ex
      .select({ horseId: horseLeaseListings.horseId })
      .from(horseLeaseListings)
      .where(and(inArray(horseLeaseListings.horseId, ids), eq(horseLeaseListings.status, "active")))).map((r) => r.horseId),
  );
  // A resale lock: this stable's latest buy (or winning claim) of the horse is still inside the window.
  const buys = new Map<string, Date>();
  const bump = (horseId: string, stableId: string, at: Date) => {
    if (inBand.find((r) => r.horse.id === horseId)?.horse.ownerStableId !== stableId) return;
    const cur = buys.get(horseId);
    if (!cur || at > cur) buys.set(horseId, at);
  };
  for (const t of await ex.select({ horseId: trades.horseId, buyerStableId: trades.buyerStableId, createdAt: trades.createdAt }).from(trades).where(inArray(trades.horseId, ids))) bump(t.horseId, t.buyerStableId, t.createdAt);
  for (const c of await ex
    .select({ horseId: raceClaims.horseId, claimantStableId: raceClaims.claimantStableId, closedAt: raceClaims.closedAt })
    .from(raceClaims)
    .where(and(inArray(raceClaims.horseId, ids), eq(raceClaims.status, "claimed")))) {
    if (c.closedAt) bump(c.horseId, c.claimantStableId, c.closedAt);
  }
  // The owner's seller requirements, once per stable.
  const canSell = new Map<string, boolean>();
  const sellerOf = async (accountId: string, stableId: string) => {
    if (!canSell.has(stableId)) canSell.set(stableId, (await sellerEligibility(ex, accountId, stableId, input.now)).length === 0);
    return canSell.get(stableId)!;
  };
  let n = 0;
  for (const r of inBand) {
    if (usdg.has(r.horse.id) || carrying.has(r.horse.id) || leaseOffered.has(r.horse.id)) continue;
    const boughtAt = buys.get(r.horse.id);
    if (boughtAt && input.now.getTime() - boughtAt.getTime() < RULES.resaleLockMs) continue;
    if (await sellerOf(r.accountId, r.horse.ownerStableId!)) n++;
  }
  return n;
}

/**
 * Entry checks for a claiming race, inside enterRace (race, stable and horse locked). A claim
 * price is required there and refused anywhere else. Returns the price to store with the entry
 * (null for an ordinary race).
 */
export async function claimingEntryCheckTx(
  tx: Executor,
  input: { accountId: string; stable: StableRow; horse: HorseRow; race: RaceRow; claimPrice?: number | null; now: Date },
  hooks: GameHooks = defaultHooks,
): Promise<number | null> {
  const { horse, stable } = input;
  if (!isClaimingRace(input.race)) {
    if (input.claimPrice != null) throw new DomainError("INVALID_INPUT", "a claim price is only set in a claiming race");
    return null;
  }
  if (input.claimPrice == null) throw new DomainError("INVALID_INPUT", "a claiming race needs a claim price for your horse");
  if (horse.ownerStableId !== stable.id || horse.lesseeStableId) throw new DomainError("NOT_ELIGIBLE", "a horse on lease can't run in a claiming race (only its owner can sell it)");
  const until = await claimReentryLock(tx, horse.id, input.now);
  if (until) throw new DomainError("NOT_ELIGIBLE", `claimed recently: can run in a claiming race again after ${until.toISOString()}`, { until: until.getTime() });
  const problem = gc.claimPriceProblem(input.claimPrice, appraisalOf(horse, hooks));
  if (problem) throw new DomainError("INVALID_INPUT", problem, claimPriceBand(horse, hooks));
  // Only a horse that could be sold for credits today (the market's checks and price band).
  await assertTradeableTx(tx, { accountId: input.accountId, stableId: stable.id, horse, price: input.claimPrice, now: input.now }, hooks);
  return input.claimPrice;
}

async function note(ex: Executor, accountId: string, kind: string, dedupeKey: string, title: string, data: Record<string, unknown>, raceId: string, horseId: string, now: Date) {
  await ex.insert(inboxItems).values({ accountId, kind, dedupeKey, title, data, raceId, horseId, createdAt: now }).onConflictDoNothing();
}

const horseName = (snapshot: unknown) => (snapshot as { name?: string } | null)?.name ?? "the horse";

/**
 * Lodges a claim on a runner of a claiming race (until entries close). The claimant pays the
 * claim price into escrow now. A refused linked-account claim still records its fraud event
 * (committed), then throws, as in the market.
 */
export async function lodgeClaim(db: Db, input: { accountId: string; raceId: string; horseId: string; now: Date }): Promise<RaceClaimRow> {
  const outcome = await runTx(db, async (tx): Promise<RaceClaimRow | DomainError> => {
    const [race] = await tx.select().from(races).where(eq(races.id, input.raceId)).for("update");
    if (!race) throw new DomainError("NOT_FOUND", "race not found");
    if (!isClaimingRace(race)) throw new DomainError("NOT_ELIGIBLE", "this is not a claiming race");
    if (race.status !== "open" || input.now >= race.entriesCloseAt) throw new DomainError("RACE_CLOSED", "claims close with the entries");
    const stable = await lockStableOf(tx, input.accountId);
    const [mine] = await tx.select().from(raceClaims).where(and(eq(raceClaims.raceId, race.id), eq(raceClaims.claimantStableId, stable.id)));
    if (mine) {
      if (mine.horseId === input.horseId) return mine; // idempotent
      throw new DomainError("NOT_ELIGIBLE", "one claim per stable in a claiming race");
    }
    const [entry] = await tx.select().from(raceEntries).where(and(eq(raceEntries.raceId, race.id), eq(raceEntries.horseId, input.horseId), eq(raceEntries.status, "entered")));
    if (!entry || entry.isHouse || !entry.stableId || entry.claimPrice == null) throw new DomainError("NOT_FOUND", "no claimable runner");
    if (entry.stableId === stable.id) throw new DomainError("CANNOT_BUY_OWN", "that is your own horse");
    const ownerAccountId = await accountIdOfStable(tx, entry.stableId);
    if (await areLinked(tx, input.accountId, ownerAccountId)) {
      await tx.insert(fraudEvents).values({
        accountId: input.accountId,
        relatedAccountId: ownerAccountId,
        kind: "linked_trade_blocked",
        severity: 2,
        data: { raceId: race.id, horseId: entry.horseId, price: entry.claimPrice, claim: true },
      });
      return new DomainError("LINKED_ACCOUNTS", "trades between linked accounts are not allowed");
    }
    // A free stall, counting the stable's other claims still waiting on a race.
    const occ = await occupancy(tx, stable);
    const [p] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(raceClaims)
      .where(and(eq(raceClaims.claimantStableId, stable.id), inArray(raceClaims.status, [...PENDING])));
    const waiting = Number(p?.n ?? 0);
    if (occ.used + waiting + 1 > stable.stallSlots) {
      throw new DomainError("STABLE_FULL", waiting ? `all ${stable.stallSlots} stalls are taken or held for your other claims` : `all ${stable.stallSlots} stalls are taken`, { ...occ, waiting });
    }
    const { transactionId } = await spendCreditsTx(tx, {
      accountId: input.accountId,
      amount: entry.claimPrice,
      idempotencyKey: `claim-escrow:${race.id}:${stable.id}`,
      kind: "claim_escrow",
      sink: "escrow",
    });
    const [claim] = await tx
      .insert(raceClaims)
      .values({ raceId: race.id, entryId: entry.id, horseId: entry.horseId, ownerStableId: entry.stableId, claimantStableId: stable.id, price: entry.claimPrice, escrowTransactionId: transactionId, createdAt: input.now })
      .returning();
    await audit(tx, { actor: input.accountId, action: "race.claim", entityType: "race", entityId: race.id, data: { horseId: entry.horseId, price: entry.claimPrice } });
    return claim!;
  });
  if (outcome instanceof DomainError) throw outcome;
  return outcome;
}

/** Pays a claim's escrow back to the claimant and closes it with `status`. Idempotent per claim. */
async function refundClaimTx(tx: Executor, claim: RaceClaimRow, status: "lost" | "void" | "refunded", now: Date, reason: string): Promise<void> {
  const claimantAccountId = await accountIdOfStable(tx, claim.claimantStableId);
  const { transactionId } = await post(tx, {
    idempotencyKey: `claim-refund:${claim.id}`,
    kind: "claim_refund",
    meta: { claimId: claim.id, raceId: claim.raceId, horseId: claim.horseId, reason },
    postings: [
      { ledgerAccountId: await systemAccountId(tx, "escrow"), amount: -claim.price },
      { ledgerAccountId: await playerLedgerAccountId(tx, claimantAccountId), amount: claim.price },
    ],
  });
  await tx.update(raceClaims).set({ status, closeTransactionId: transactionId, closedAt: now }).where(eq(raceClaims.id, claim.id));
}

async function pendingClaims(tx: Executor, raceId: string, horseId?: string): Promise<RaceClaimRow[]> {
  return tx
    .select()
    .from(raceClaims)
    .where(and(eq(raceClaims.raceId, raceId), inArray(raceClaims.status, [...PENDING]), ...(horseId ? [eq(raceClaims.horseId, horseId)] : [])))
    .orderBy(asc(raceClaims.claimantStableId))
    .for("update");
}

/** Refunds every claim still waiting on the race (or on one horse of it): a scratch, a called-off or abandoned race. */
export async function refundClaimsTx(tx: Executor, race: Pick<RaceRow, "id" | "name">, now: Date, reason: string, horseId?: string): Promise<number> {
  const open = await pendingClaims(tx, race.id, horseId);
  for (const c of open) {
    await refundClaimTx(tx, c, "refunded", now, reason);
    await note(tx, await accountIdOfStable(tx, c.claimantStableId), "claim_refunded", `claim:${c.id}:refunded`, `Your claim in the ${race.name} was refunded (${reason})`, { price: c.price, reason }, race.id, c.horseId, now);
  }
  return open.length;
}

/**
 * The classic claiming draw, at the lock: for each horse with more than one claim, one claim wins,
 * picked from the race seed (stream `claim-draw:<horseId>` over the claims in claimant order,
 * verifiable after the seed is revealed); the others are refunded. A single claim wins outright.
 */
export async function drawClaimsTx(tx: Executor, race: RaceRow, now: Date): Promise<void> {
  const open = (await pendingClaims(tx, race.id)).filter((c) => c.status === "lodged");
  const byHorse = new Map<string, RaceClaimRow[]>();
  for (const c of open) byHorse.set(c.horseId, [...(byHorse.get(c.horseId) ?? []), c]);
  for (const [horseId, claims] of byHorse) {
    const word = createHash("sha256").update(`${race.seed}|claim-draw:${horseId}`).digest().readUInt32BE(0);
    const winner = claims[word % claims.length]!;
    await tx.update(raceClaims).set({ status: "drawn" }).where(eq(raceClaims.id, winner.id));
    for (const c of claims) {
      if (c.id === winner.id) continue;
      await refundClaimTx(tx, c, "lost", now, "lost the draw");
      await note(tx, await accountIdOfStable(tx, c.claimantStableId), "claim_lost", `claim:${c.id}:lost`, `Your claim in the ${race.name} lost the draw (${claims.length} claims): refunded`, { price: c.price, claims: claims.length }, race.id, horseId, now);
    }
  }
  if (byHorse.size) await audit(tx, { actor: null, action: "race.claim_draw", entityType: "race", entityId: race.id, data: { horses: byHorse.size, claims: open.length } });
}

/** Locks the stables of the race's winning claimants (before its horses: lock order race → stable → horse). */
export async function lockClaimantStablesTx(tx: Tx, raceId: string): Promise<void> {
  const rows = await tx.select({ id: raceClaims.claimantStableId }).from(raceClaims).where(and(eq(raceClaims.raceId, raceId), eq(raceClaims.status, "drawn")));
  for (const id of [...new Set(rows.map((r) => r.id))].sort()) await lockStable(tx, id);
}

export interface ClaimOutcome {
  claimed: { horseId: string; claimantStableId: string; price: number; fee: number }[];
  voided: string[];
}

/**
 * Settles the race's winning claims, inside settleRace after the runners are updated (horses
 * unlocked). The horse moves to the claimant whatever the result; the old owner receives the
 * price minus the fee (burned). A horse fatally injured in the race, or a claimant with no free
 * stall left, voids the claim (refunded). Idempotent: a settled claim is no longer `drawn`.
 */
export async function settleClaimsTx(tx: Tx, race: RaceRow, fatal: ReadonlySet<string>, now: Date): Promise<ClaimOutcome> {
  const out: ClaimOutcome = { claimed: [], voided: [] };
  const drawn = (await pendingClaims(tx, race.id)).filter((c) => c.status === "drawn");
  for (const c of drawn) {
    const claimantAccountId = await accountIdOfStable(tx, c.claimantStableId);
    const ownerAccountId = await accountIdOfStable(tx, c.ownerStableId);
    const [h] = await tx.select().from(horses).where(eq(horses.id, c.horseId)).for("update");
    const name = h?.name ?? "the horse";
    const stable = await lockStable(tx, c.claimantStableId);
    const full = (await occupancy(tx, stable)).used + 1 > stable.stallSlots;
    // belt and braces: a horse can't be registered for USDG while entered, but never sell one for credits
    const gone = !h || h.ownerStableId !== c.ownerStableId || (await isUsdgRegistered(tx, c.horseId));
    if (gone || fatal.has(c.horseId) || full) {
      const reason = fatal.has(c.horseId) ? "fatal injury" : full ? "no free stall" : "the horse is no longer available";
      await refundClaimTx(tx, c, "void", now, reason);
      await note(tx, claimantAccountId, "claim_void", `claim:${c.id}:void`, `Your claim on ${name} in the ${race.name} is void (${reason}): refunded`, { price: c.price, reason }, race.id, c.horseId, now);
      out.voided.push(c.horseId);
      continue;
    }
    const { toOwner, fee } = gc.claimSettlement(c.price);
    const { transactionId } = await post(tx, {
      idempotencyKey: `claim-sale:${c.id}`,
      kind: "claim_sale",
      meta: { claimId: c.id, raceId: race.id, horseId: c.horseId },
      postings: [
        { ledgerAccountId: await systemAccountId(tx, "escrow"), amount: -c.price },
        ...(toOwner > 0 ? [{ ledgerAccountId: await playerLedgerAccountId(tx, ownerAccountId), amount: toOwner }] : []),
        ...(fee > 0 ? [{ ledgerAccountId: await systemAccountId(tx, "burn"), amount: fee }] : []),
      ],
    });
    await tx.update(horses).set({ ownerStableId: c.claimantStableId, studFee: null, studFeeUsdg: null, updatedAt: now }).where(eq(horses.id, c.horseId));
    await tx.update(raceClaims).set({ status: "claimed", fee, closeTransactionId: transactionId, closedAt: now }).where(eq(raceClaims.id, c.id));
    await note(tx, claimantAccountId, "claim_won", `claim:${c.id}:won`, `You claimed ${name} from the ${race.name} for ${c.price} credits`, { price: c.price }, race.id, c.horseId, now);
    await note(tx, ownerAccountId, "horse_claimed", `claim:${c.id}:sold`, `${name} was claimed in the ${race.name}: you receive ${toOwner} credits`, { price: c.price, fee, received: toOwner }, race.id, c.horseId, now);
    await audit(tx, { actor: null, action: "race.claim_settle", entityType: "race", entityId: race.id, data: { claimId: c.id, horseId: c.horseId, price: c.price, fee } });
    out.claimed.push({ horseId: c.horseId, claimantStableId: c.claimantStableId, price: c.price, fee });
  }
  return out;
}

/** Racecard view: each runner's claim price and the number of claims lodged on it (never who). */
export async function claimingCard(ex: Executor, raceId: string): Promise<Map<string, { price: number; claims: number }>> {
  const entries = await ex
    .select({ horseId: raceEntries.horseId, price: raceEntries.claimPrice })
    .from(raceEntries)
    .where(and(eq(raceEntries.raceId, raceId), eq(raceEntries.status, "entered")));
  const counts = await ex
    .select({ horseId: raceClaims.horseId, n: sql<number>`count(*)::int` })
    .from(raceClaims)
    .where(and(eq(raceClaims.raceId, raceId), sql`${raceClaims.status} <> 'refunded'`))
    .groupBy(raceClaims.horseId);
  const byHorse = new Map(counts.map((c) => [c.horseId, Number(c.n)]));
  const out = new Map<string, { price: number; claims: number }>();
  for (const e of entries) if (e.price != null) out.set(e.horseId, { price: e.price, claims: byHorse.get(e.horseId) ?? 0 });
  return out;
}

/** The stable's own claim in a race (it sees its own; others only see counts). */
export async function myClaim(ex: Executor, raceId: string, stableId: string): Promise<RaceClaimRow | null> {
  const [c] = await ex.select().from(raceClaims).where(and(eq(raceClaims.raceId, raceId), eq(raceClaims.claimantStableId, stableId)));
  return c ?? null;
}
