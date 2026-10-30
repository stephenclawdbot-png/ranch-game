/**
 * Credits-only horse market (§8, §4b).
 * - The horse itself is the escrow: listing locks it (lock_kind = 'market'), so it cannot
 *   race, breed as a mare, be released or be listed twice (partial unique index).
 * - Locked (in a race), in-foal, bound (Club-bred) horses and foals below their trade
 *   threshold cannot be listed; the database trigger blocks such transfers regardless.
 * - Sellers need an account >= 7 days old and >= 20 races (env-configurable, see rules.ts
 *   sellerPolicy); a verified email only when MARKET_REQUIRE_VERIFIED_EMAIL is on.
 * - Price floor: 70% of the appraisal at listing time; ceiling: 3x (no credit transfers, AUDIT §6).
 * - A horse bought here can't be relisted for 72 h after the trade (resale lock, AUDIT §6).
 * - Purchase is one transaction: buyer pays, seller receives 95%, 5% is burned, ownership
 *   moves, the listing closes. Linked accounts cannot trade (blocked + fraud event).
 * - There are no direct credit transfers between players.
 */
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { DomainError, type DomainErrorCode } from "../errors";
import { gc, isGenome, toHorseState } from "../gameCore";
import { accounts, fraudEvents, horses, marketListings, raceEntries, races, trades, type ListingRow } from "../schema";
import { bps, defaultAppraise, gcSellerPolicy, RULES, sellerPolicy, type GameHooks, type SellerPolicy } from "../rules";
import { defaultHooks } from "../hooks";
import type { Db, Executor } from "../types";
import { accountIdOfStable, areLinked, assertStallFree, lockStableOf } from "./accounts";
import { isCarrying, lockHorse, lockOwnedHorse, openLeaseOfferOf } from "./horses";
import { playerLedgerAccountId, post, systemAccountId } from "./ledger";
import { audit, runTx } from "./tx";
import { isUsdgRegistered } from "./usdgMarket";

const LIST_BLOCK_CODES: Record<gc.ListBlock, DomainErrorCode> = {
  account_too_new: "SELLER_REQUIREMENTS",
  not_enough_races: "SELLER_REQUIREMENTS",
  email_unverified: "SELLER_REQUIREMENTS",
  club_bred: "HORSE_BOUND",
  bound_until_5_starts: "HORSE_BOUND",
  not_in_stable: "NOT_ELIGIBLE",
  entered_in_race: "HORSE_LOCKED",
  in_foal: "HORSE_IN_FOAL",
  below_floor: "PRICE_BELOW_FLOOR",
  above_ceiling: "PRICE_ABOVE_CEILING",
  locked: "HORSE_LOCKED",
};

export async function settledRacesForStable(ex: Executor, stableId: string): Promise<number> {
  const [r] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .where(and(eq(raceEntries.stableId, stableId), eq(races.status, "settled")));
  return Number(r?.n ?? 0);
}

export async function sellerEligibility(ex: Executor, accountId: string, stableId: string, now: Date, policy: SellerPolicy = sellerPolicy()): Promise<string[]> {
  const [acc] = await ex.select().from(accounts).where(eq(accounts.id, accountId));
  const problems: string[] = [];
  if (!acc) return ["account not found"];
  if (now.getTime() - acc.createdAt.getTime() < policy.minAccountAgeDays * 86_400_000) problems.push(`account must be at least ${policy.minAccountAgeDays} days old`);
  if (policy.requireVerifiedEmail && !acc.emailVerifiedAt) problems.push("verified email required");
  if ((await settledRacesForStable(ex, stableId)) < policy.minRaces) problems.push(`at least ${policy.minRaces} races required`);
  return problems;
}

export interface ListInput {
  accountId: string;
  horseId: string;
  price: number;
  now: Date;
  durationMs?: number;
}

/** While a horse this stable bought on the market is inside its resale lock: when it was bought and when the lock ends. */
export async function resaleLock(ex: Executor, horseId: string, ownerStableId: string, now: Date): Promise<{ boughtAt: Date; until: Date } | null> {
  const [t] = await ex
    .select({ createdAt: trades.createdAt })
    .from(trades)
    .where(and(eq(trades.horseId, horseId), eq(trades.buyerStableId, ownerStableId)))
    .orderBy(desc(trades.createdAt))
    .limit(1);
  if (!t) return null;
  const until = new Date(t.createdAt.getTime() + RULES.resaleLockMs);
  return until.getTime() > now.getTime() ? { boughtAt: t.createdAt, until } : null;
}

export async function listHorse(db: Db, input: ListInput, hooks: GameHooks = defaultHooks): Promise<ListingRow> {
  if (!Number.isSafeInteger(input.price) || input.price <= 0) throw new DomainError("INVALID_INPUT", "price must be a positive integer");
  const duration = input.durationMs ?? RULES.maxListingMs;
  if (duration <= 0 || duration > RULES.maxListingMs) throw new DomainError("INVALID_INPUT", "listing duration out of range");
  return runTx(db, async (tx) => {
    const { horse, stableId } = await lockOwnedHorse(tx, input.accountId, input.horseId);
    const policy = sellerPolicy();
    const problems = await sellerEligibility(tx, input.accountId, stableId, input.now, policy);
    if (problems.length) throw new DomainError("SELLER_REQUIREMENTS", problems.join("; "), { problems });
    if (horse.bound) throw new DomainError("HORSE_BOUND", "Club-bred horses cannot be sold");
    if (horse.starts < horse.tradeMinStarts) throw new DomainError("HORSE_BOUND", `tradeable after ${horse.tradeMinStarts} starts`);
    if (horse.lockKind) throw new DomainError("HORSE_LOCKED", horse.lockKind === "race" ? "horse is entered in a race" : horse.lockKind === "stud" ? "the mare is booked for a USDG covering" : "already listed");
    // A horse registered for the USDG market trades only for USDG (no credits/USDG arbitrage).
    if (await isUsdgRegistered(tx, horse.id)) throw new DomainError("USDG_ONLY", "this horse is registered for the USDG market and sells only for USDG");
    if (await openLeaseOfferOf(tx, horse.id)) throw new DomainError("HORSE_LOCKED", "this horse is offered for lease: withdraw the lease offer first");
    if (await isCarrying(tx, horse.id)) throw new DomainError("HORSE_IN_FOAL", "mares in foal cannot be sold");
    const resale = await resaleLock(tx, horse.id, stableId, input.now);
    if (resale) throw new DomainError("RESALE_LOCKED", `bought on ${resale.boughtAt.toISOString()}: can be listed again after ${resale.until.toISOString()}`, { until: resale.until.getTime() });
    const appraisal = (hooks.appraise ?? defaultAppraise)(horse);
    if (isGenome(horse.genome)) {
      // game-core's market rules on the locked state (binding, location, floor, seller).
      const [acc] = await tx.select().from(accounts).where(eq(accounts.id, input.accountId));
      const block = gc.listBlock(
        toHorseState(horse),
        { createdAtMs: acc!.createdAt.getTime(), racesRun: await settledRacesForStable(tx, stableId), emailVerified: !!acc!.emailVerifiedAt },
        input.price,
        input.now.getTime(),
        { enteredInRace: horse.lockKind === "race", locked: horse.lockKind === "market" },
        gcSellerPolicy(policy),
      );
      if (block) throw new DomainError(LIST_BLOCK_CODES[block], `cannot list: ${block}`, { block, floor: gc.listingFloor(toHorseState(horse)), ceiling: gc.listingCeiling(toHorseState(horse)) });
    }
    const floor = isGenome(horse.genome) ? gc.listingFloor(toHorseState(horse)) : bps(appraisal, RULES.listingFloorBps);
    if (input.price < floor) throw new DomainError("PRICE_BELOW_FLOOR", `minimum price is ${floor}`, { floor, appraisal });
    // Never below the floor (or 1), so a degenerate appraisal can't invert the band.
    const ceiling = isGenome(horse.genome) ? gc.listingCeiling(toHorseState(horse)) : Math.max(bps(appraisal, RULES.listingCeilingBps), floor, 1);
    if (input.price > ceiling) throw new DomainError("PRICE_ABOVE_CEILING", `maximum price is ${ceiling}`, { ceiling, appraisal });
    const [listing] = await tx
      .insert(marketListings)
      .values({
        horseId: horse.id,
        sellerStableId: stableId,
        price: input.price,
        appraisal,
        createdAt: input.now,
        expiresAt: new Date(input.now.getTime() + duration),
      })
      .returning();
    await tx.update(horses).set({ lockKind: "market", lockRef: listing!.id, updatedAt: input.now }).where(eq(horses.id, horse.id));
    await audit(tx, { actor: input.accountId, action: "market.list", entityType: "listing", entityId: listing!.id, data: { horseId: horse.id, price: input.price, appraisal } });
    return listing!;
  });
}

export interface BuyResult {
  tradeId: string;
  horseId: string;
  price: number;
  fee: number;
}

export async function buyListing(db: Db, input: { accountId: string; listingId: string; now: Date }): Promise<BuyResult> {
  // A blocked linked-account trade still records its fraud event (committed), then throws.
  const outcome = await runTx(db, async (tx): Promise<BuyResult | DomainError> => {
    const [listing] = await tx.select().from(marketListings).where(eq(marketListings.id, input.listingId)).for("update");
    if (!listing) throw new DomainError("NOT_FOUND", "listing not found");
    if (listing.status !== "active") throw new DomainError("LISTING_NOT_ACTIVE", `listing is ${listing.status}`);
    if (listing.expiresAt <= input.now) throw new DomainError("LISTING_EXPIRED", "listing has expired");
    const buyerStable = await lockStableOf(tx, input.accountId);
    if (buyerStable.id === listing.sellerStableId) throw new DomainError("CANNOT_BUY_OWN", "that is your own horse");
    const sellerAccountId = await accountIdOfStable(tx, listing.sellerStableId);
    if (await areLinked(tx, input.accountId, sellerAccountId)) {
      await tx.insert(fraudEvents).values({
        accountId: input.accountId,
        relatedAccountId: sellerAccountId,
        kind: "linked_trade_blocked",
        severity: 2,
        data: { listingId: listing.id, horseId: listing.horseId, price: listing.price },
      });
      return new DomainError("LINKED_ACCOUNTS", "trades between linked accounts are not allowed");
    }
    await assertStallFree(tx, buyerStable);
    const horse = await lockHorse(tx, listing.horseId);
    if (horse.ownerStableId !== listing.sellerStableId || horse.lesseeStableId || horse.lockKind !== "market" || horse.lockRef !== listing.id) {
      throw new DomainError("LISTING_NOT_ACTIVE", "listing is no longer valid");
    }
    const fee = gc.marketFee(listing.price);
    const { transactionId } = await post(tx, {
      idempotencyKey: `trade:${listing.id}`,
      kind: "market_sale",
      meta: { listingId: listing.id, horseId: horse.id },
      postings: [
        { ledgerAccountId: await playerLedgerAccountId(tx, input.accountId), amount: -listing.price },
        { ledgerAccountId: await playerLedgerAccountId(tx, sellerAccountId), amount: listing.price - fee },
        ...(fee > 0 ? [{ ledgerAccountId: await systemAccountId(tx, "burn"), amount: fee }] : []),
      ],
    });
    await tx
      .update(horses)
      .set({ ownerStableId: buyerStable.id, lockKind: null, lockRef: null, studFee: null, studFeeUsdg: null, updatedAt: input.now })
      .where(eq(horses.id, horse.id));
    await tx.update(marketListings).set({ status: "sold", closedAt: input.now }).where(eq(marketListings.id, listing.id));
    const [trade] = await tx
      .insert(trades)
      .values({
        listingId: listing.id,
        horseId: horse.id,
        sellerStableId: listing.sellerStableId,
        buyerStableId: buyerStable.id,
        price: listing.price,
        fee,
        ledgerTransactionId: transactionId,
        createdAt: input.now,
      })
      .returning({ id: trades.id });
    await audit(tx, { actor: input.accountId, action: "market.buy", entityType: "trade", entityId: trade!.id, data: { listingId: listing.id, horseId: horse.id, price: listing.price, fee } });
    return { tradeId: trade!.id, horseId: horse.id, price: listing.price, fee };
  });
  if (outcome instanceof DomainError) throw outcome;
  return outcome;
}

async function closeListing(tx: Executor, listing: ListingRow, status: "cancelled" | "expired", now: Date): Promise<void> {
  const h = await lockHorse(tx, listing.horseId);
  if (h.lockKind === "market" && h.lockRef === listing.id) {
    await tx.update(horses).set({ lockKind: null, lockRef: null }).where(eq(horses.id, h.id));
  }
  await tx.update(marketListings).set({ status, closedAt: now }).where(eq(marketListings.id, listing.id));
}

export async function cancelListing(db: Db, input: { accountId: string; listingId: string; now: Date }): Promise<void> {
  await runTx(db, async (tx) => {
    const [listing] = await tx.select().from(marketListings).where(eq(marketListings.id, input.listingId)).for("update");
    if (!listing) throw new DomainError("NOT_FOUND", "listing not found");
    if (listing.status !== "active") return;
    const sellerAccountId = await accountIdOfStable(tx, listing.sellerStableId);
    if (sellerAccountId !== input.accountId) throw new DomainError("NOT_OWNER", "not your listing");
    await closeListing(tx, listing, "cancelled", input.now);
    await audit(tx, { actor: input.accountId, action: "market.cancel", entityType: "listing", entityId: listing.id });
  });
}

/** Expires overdue listings and returns the horses to their owners. Returns the count. */
export async function expireListings(db: Db, now: Date): Promise<number> {
  return runTx(db, async (tx) => {
    const due = await tx
      .select()
      .from(marketListings)
      .where(and(eq(marketListings.status, "active"), lte(marketListings.expiresAt, now)))
      .for("update", { skipLocked: true });
    for (const l of due) await closeListing(tx, l, "expired", now);
    return due.length;
  });
}

export async function listActiveListings(ex: Executor, now: Date, limit = 50): Promise<ListingRow[]> {
  return ex
    .select()
    .from(marketListings)
    .where(and(eq(marketListings.status, "active"), sql`${marketListings.expiresAt} > ${now}`))
    .orderBy(marketListings.expiresAt)
    .limit(limit);
}
