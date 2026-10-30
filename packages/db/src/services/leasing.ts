/**
 * Horse leasing (owner request 2026-10-30; every number in game-core leasing.ts).
 *
 *   offerLease (owner)  ->  takeLease (another stable; first come first served under the listing
 *   lock)  ->  the horse stands in the lessee's stall (horses.lessee_stable_id), races in the
 *   lessee's silks, League points and trophies go to the lessee's stable  ->  every purse it wins
 *   is split at settlement (settleLeasedPurseTx: one `lease_share` ledger transaction per runner,
 *   mint -> owner share + lessee share, the purse split exactly with rounding to the lessee)  ->
 *   the lease ends (endLeaseTx) at the end of the term, when the lessee hands the horse back, when
 *   it retires (40 starts, career-ending or fatal injury) or after a moderate or worse injury on
 *   lease. A horse entered in a race when its lease should end goes home once that race settles.
 *
 * Ownership never moves (horses.owner_stable_id). Who may act on the horse:
 *   - the keeper (lessee while on lease): care, vet, training, race and Daily Cup entries
 *     (horses.ts lockKeptHorse);
 *   - the owner only, never while the horse is away: sell / list (credits or USDG), breed or stand
 *     at stud, retire, Legacy Farm, release, rename, register for USDG (lockOwnedHorse throws
 *     HORSE_ON_LEASE); insurance stays the owner's even on lease.
 *
 * Decisions (reported to the lead):
 *   - No owner recall: a lease is a promise to the lessee for its term. The lessee may hand the
 *     horse back at any time (no refund: the beta has no fee).
 *   - The horse always goes home at the end, even into a full stable (like a foal: the nursery
 *     overflow rule; the owner can't acquire more horses until a stall is free). Bounded by the
 *     owner's lease cap (at most 3 horses out).
 *   - USDG-registered horses may be leased (ownership does not move and nothing is paid in USDG).
 *     So may Club-bred (bound) horses: binding stops a free horse being SOLD for credits; a lease
 *     moves no ownership and (with no upfront fee) no credits, and the horse comes home. Without
 *     them nobody could lease in a stable's first weeks (the 2026-10-30 harness run: 0 offers).
 *   - The horse is not locked while on offer: it may still race at home; taking re-checks all.
 *   - Story races and the Daily Cup are allowed on lease; Story rewards and Cup credits are not
 *     purses and stay with the lessee (they are capped per stable).
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { sha256Hex, utcDay, utcWeekStart } from "../crypto";
import { DomainError } from "../errors";
import { gc, isGenome, toHorseState } from "../gameCore";
import { defaultAppraise, RULES } from "../rules";
import { accounts, fraudEvents, horseLeaseListings, horseLeases, horses, inboxItems, raceEntries, races, stables, trades, type HorseLeaseListingRow, type HorseLeaseRow, type HorseRow } from "../schema";
import type { Db, Executor } from "../types";
import { accountIdOfStable, areLinked, assertStallFree, lockStableOf, stableOf } from "./accounts";
import { isCarrying, lockHorse, lockOwnedHorse } from "./horses";
import { studHoldsOf } from "./usdgMarket";
import { LIVE_RACE_KINDS, weekBounds } from "./leagues";
import { playerLedgerAccountId, post, systemAccountId } from "./ledger";
import { audit, rowsOf, runTx } from "./tx";

/** Tunable at call sites (tests switch the upfront fee on); defaults are game-core's numbers. */
export interface LeasePolicy {
  /** Upfront fee cap in credits (0 = no fee: the beta). */
  feeMax: number;
}
export const DEFAULT_LEASE_POLICY: LeasePolicy = { feeMax: gc.LEASE_FEE_MAX };

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function activeLeaseOfHorse(ex: Executor, horseId: string): Promise<HorseLeaseRow | null> {
  const [l] = await ex.select().from(horseLeases).where(and(eq(horseLeases.horseId, horseId), eq(horseLeases.status, "active")));
  return l ?? null;
}

async function lockActiveLeaseOfHorse(ex: Executor, horseId: string): Promise<HorseLeaseRow | null> {
  const [l] = await ex
    .select()
    .from(horseLeases)
    .where(and(eq(horseLeases.horseId, horseId), eq(horseLeases.status, "active")))
    .for("update");
  return l ?? null;
}

/** Racing horses the stable owns (at home or away on lease): the base of the owner's lease cap. */
export async function ownedRacingHorses(ex: Executor, stableId: string): Promise<number> {
  const [r] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(horses)
    .where(and(eq(horses.ownerStableId, stableId), eq(horses.careerStatus, "racing")));
  return Number(r?.n ?? 0);
}

async function countActiveLeases(ex: Executor, role: "owner" | "lessee", stableId: string): Promise<number> {
  const col = role === "owner" ? horseLeases.ownerStableId : horseLeases.lesseeStableId;
  const [r] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(horseLeases)
    .where(and(eq(col, stableId), eq(horseLeases.status, "active")));
  return Number(r?.n ?? 0);
}

async function countOpenOffers(ex: Executor, ownerStableId: string): Promise<number> {
  const [r] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(horseLeaseListings)
    .where(and(eq(horseLeaseListings.ownerStableId, ownerStableId), eq(horseLeaseListings.status, "active")));
  return Number(r?.n ?? 0);
}

/** Settled Live starts the stable has run (lessee eligibility). */
export async function liveStartsOfStable(ex: Executor, stableId: string): Promise<number> {
  const [r] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .where(and(eq(raceEntries.stableId, stableId), eq(raceEntries.status, "entered"), eq(races.status, "settled"), inArray(races.kind, [...LIVE_RACE_KINDS])));
  return Number(r?.n ?? 0);
}

/** When a horse back from a lease may be offered again (null = no cooldown running). */
export async function leaseCooldownUntil(ex: Executor, horseId: string, now: Date): Promise<Date | null> {
  const [last] = await ex
    .select({ endedAt: horseLeases.endedAt })
    .from(horseLeases)
    .where(and(eq(horseLeases.horseId, horseId), eq(horseLeases.status, "ended")))
    .orderBy(desc(horseLeases.endedAt))
    .limit(1);
  if (!last?.endedAt) return null;
  const until = new Date(last.endedAt.getTime() + gc.LEASE_RELIST_COOLDOWN_DAYS * DAY_MS);
  return until > now ? until : null;
}

/** The horse's current fatigue (recovered lazily, as the stable view shows it). */
export function fatigueNow(h: HorseRow, now: Date): number {
  return isGenome(h.genome) ? gc.fatigueAt(toHorseState(h), now.getTime()) : h.fatigue;
}

export interface LeaseCondition {
  fitness: number;
  fatigue: number;
  /** Injury severity while recovering, else null. */
  injury: string | null;
  rating: number;
  label: gc.LeaseConditionLabel;
}

/** The condition report recorded at the start of a lease and at the return. */
export function leaseCondition(h: HorseRow, now: Date): LeaseCondition {
  const fatigue = fatigueNow(h, now);
  const injured = !!(h.injuredUntil && h.injuredUntil > now) || (h.injury as { severity?: string } | null)?.severity === "fatal";
  const injury = injured ? String((h.injury as { severity?: string } | null)?.severity ?? "minor") : null;
  return { fitness: h.fitness, fatigue, injury, rating: h.rating, label: gc.leaseConditionLabel({ fatigue, injured }, gc.TIRED_THRESHOLD) };
}

export type LeaseHorseBlock =
  | "not_owner"
  | "on_lease"
  | "not_racing"
  | "not_of_age"
  | "few_starts_left"
  | "in_race"
  | "listed"
  | "booked"
  | "in_foal"
  | "injured"
  | "at_stud"
  | "cooldown";

export const LEASE_BLOCK_TEXT: Record<LeaseHorseBlock, string> = {
  not_owner: "That horse isn't yours.",
  on_lease: "Already away on lease.",
  not_racing: "Only racing horses can be leased.",
  not_of_age: "Not yet of racing age.",
  few_starts_left: `Needs at least ${gc.LEASE_MIN_STARTS_LEFT} career starts left.`,
  in_race: "Entered in a race: offer it after the race.",
  listed: "Listed on the market: take it off first.",
  booked: "Booked for a USDG covering.",
  in_foal: "In foal.",
  injured: "Recovering from injury.",
  at_stud: "Standing at stud: withdraw him from stud first.",
  cooldown: `Just back from a lease: it can be offered again ${gc.LEASE_RELIST_COOLDOWN_DAYS} days after it came home.`,
};

/** Whether this horse may be offered (and, re-checked, taken) on lease. Null = it may. `ownerStableId` null: the Club. */
export async function leaseHorseBlock(ex: Executor, h: HorseRow, ownerStableId: string | null, now: Date): Promise<{ block: LeaseHorseBlock; until?: Date } | null> {
  if (h.ownerStableId !== ownerStableId) return { block: "not_owner" };
  if (h.lesseeStableId) return { block: "on_lease" };
  if (h.careerStatus !== "racing") return { block: "not_racing" };
  if (h.careSessions < RULES.careToRacing) return { block: "not_of_age" };
  if (RULES.maxStarts - h.starts < gc.LEASE_MIN_STARTS_LEFT) return { block: "few_starts_left" };
  if (h.lockKind === "race") return { block: "in_race" };
  if (h.lockKind === "market") return { block: "listed" };
  if (h.lockKind === "stud") return { block: "booked" };
  // a stallion with live USDG stud bookings: a mare owner may already be paying for the covering
  if (h.sex === "male" && (await studHoldsOf(ex, h.id, now)) > 0) return { block: "booked" };
  if (h.studFee !== null || h.studFeeUsdg !== null) return { block: "at_stud" };
  if (h.injuredUntil && h.injuredUntil > now) return { block: "injured" };
  if (h.sex === "female" && (await isCarrying(ex, h.id))) return { block: "in_foal" };
  const until = await leaseCooldownUntil(ex, h.id, now);
  if (until) return { block: "cooldown", until };
  return null;
}

export interface LesseeRecord {
  stableId: string;
  leases: number;
  active: number;
  races: number;
  injuries: number;
  /** Average fatigue (0..1000) of the horses when this stable entered them on lease; null = none yet. */
  avgFatigueAtEntry: number | null;
  ratings: number;
  ratingSum: number;
  /** Average stars in tenths (43 = 4.3), null when unrated. */
  starsTenths: number | null;
}

/** Public lessee records (lease board, owners' views, the stable's own Lease tab). */
export async function lesseeRecords(ex: Executor, stableIds: string[]): Promise<Map<string, LesseeRecord>> {
  const ids = [...new Set(stableIds)];
  const out = new Map<string, LesseeRecord>();
  for (const id of ids) out.set(id, { stableId: id, leases: 0, active: 0, races: 0, injuries: 0, avgFatigueAtEntry: null, ratings: 0, ratingSum: 0, starsTenths: null });
  if (!ids.length) return out;
  const rows = await ex
    .select({
      stableId: horseLeases.lesseeStableId,
      leases: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${horseLeases.status} = 'active')::int`,
      races: sql<number>`coalesce(sum(${horseLeases.races}), 0)::int`,
      injuries: sql<number>`coalesce(sum(${horseLeases.injuries}), 0)::int`,
      entries: sql<number>`coalesce(sum(${horseLeases.entries}), 0)::int`,
      fatigue: sql<number>`coalesce(sum(${horseLeases.fatigueAtEntrySum}), 0)::bigint`,
      ratings: sql<number>`count(${horseLeases.ownerRating})::int`,
      ratingSum: sql<number>`coalesce(sum(${horseLeases.ownerRating}), 0)::int`,
    })
    .from(horseLeases)
    .where(inArray(horseLeases.lesseeStableId, ids))
    .groupBy(horseLeases.lesseeStableId);
  for (const r of rows) {
    const entries = Number(r.entries);
    out.set(r.stableId, {
      stableId: r.stableId,
      leases: Number(r.leases),
      active: Number(r.active),
      races: Number(r.races),
      injuries: Number(r.injuries),
      avgFatigueAtEntry: entries > 0 ? Math.round(Number(r.fatigue) / entries) : null,
      ratings: Number(r.ratings),
      ratingSum: Number(r.ratingSum),
      starsTenths: gc.averageStarsTenths(Number(r.ratingSum), Number(r.ratings)),
    });
  }
  return out;
}

export interface LesseeEligibility {
  ok: boolean;
  accountAgeDays: number;
  liveStarts: number;
  activeLeases: number;
  problems: string[];
}

/** Can this stable take leases at all (account age, Live starts, lease cap)? */
export async function lesseeEligibility(ex: Executor, input: { accountId: string; stableId: string; now: Date }): Promise<LesseeEligibility> {
  const [acc] = await ex.select({ createdAt: accounts.createdAt }).from(accounts).where(eq(accounts.id, input.accountId));
  const ageDays = acc ? Math.floor((input.now.getTime() - acc.createdAt.getTime()) / DAY_MS) : 0;
  const liveStarts = await liveStartsOfStable(ex, input.stableId);
  const activeLeases = await countActiveLeases(ex, "lessee", input.stableId);
  const problems: string[] = [];
  if (ageDays < gc.LESSEE_MIN_ACCOUNT_DAYS) problems.push(`an account at least ${gc.LESSEE_MIN_ACCOUNT_DAYS} days old`);
  if (liveStarts < gc.LESSEE_MIN_LIVE_STARTS) problems.push(`at least ${gc.LESSEE_MIN_LIVE_STARTS} Live starts (${liveStarts} so far)`);
  if (activeLeases >= gc.MAX_LEASES_PER_LESSEE) problems.push(`room for another lease (you hold ${activeLeases} of ${gc.MAX_LEASES_PER_LESSEE})`);
  return { ok: problems.length === 0, accountAgeDays: ageDays, liveStarts, activeLeases, problems };
}

export interface OwnerLeaseCaps {
  racingHorses: number;
  maxOut: number;
  out: number;
  openOffers: number;
  maxOpenOffers: number;
}

export async function ownerLeaseCaps(ex: Executor, stableId: string): Promise<OwnerLeaseCaps> {
  const racingHorses = await ownedRacingHorses(ex, stableId);
  return {
    racingHorses,
    maxOut: gc.maxLeasesOut(racingHorses),
    out: await countActiveLeases(ex, "owner", stableId),
    openOffers: await countOpenOffers(ex, stableId),
    maxOpenOffers: gc.MAX_OPEN_LEASE_OFFERS,
  };
}

// ---------------------------------------------------------------------------
// Offer / withdraw
// ---------------------------------------------------------------------------

export interface OfferLeaseInput {
  accountId: string;
  horseId: string;
  termDays: number;
  ownerSharePct: number;
  fee?: number;
  allowAllOut?: boolean;
  maxLiveStartsPerWeek?: number;
  minLesseeRating?: number | null;
  now: Date;
}

export async function offerLease(db: Db, input: OfferLeaseInput, policy: LeasePolicy = DEFAULT_LEASE_POLICY): Promise<HorseLeaseListingRow> {
  return runTx(db, async (tx) => {
    const { horse, stableId } = await lockOwnedHorse(tx, input.accountId, input.horseId);
    const appraisal = defaultAppraise(horse);
    const feeCap = gc.leaseFeeCap(appraisal, policy.feeMax);
    const terms = {
      termDays: input.termDays,
      ownerSharePct: input.ownerSharePct,
      fee: input.fee ?? 0,
      feeCap,
      maxLiveStartsPerWeek: input.maxLiveStartsPerWeek ?? gc.LEASE_WEEKLY_STARTS_DEFAULT,
      minLesseeRating: input.minLesseeRating ?? null,
    };
    const problem = gc.leaseOfferProblem(terms);
    if (problem) throw new DomainError("INVALID_INPUT", gc.leaseOfferProblemText(problem, feeCap), { problem, feeCap });
    const existing = await tx
      .select({ id: horseLeaseListings.id })
      .from(horseLeaseListings)
      .where(and(eq(horseLeaseListings.horseId, horse.id), eq(horseLeaseListings.status, "active")));
    if (existing[0]) throw new DomainError("HORSE_LOCKED", "this horse is already offered for lease");
    const block = await leaseHorseBlock(tx, horse, stableId, input.now);
    if (block) throw new DomainError(block.block === "in_race" || block.block === "listed" || block.block === "booked" ? "HORSE_LOCKED" : "NOT_ELIGIBLE", LEASE_BLOCK_TEXT[block.block], { block: block.block, until: block.until?.getTime() });
    const caps = await ownerLeaseCaps(tx, stableId);
    if (caps.openOffers >= caps.maxOpenOffers) throw new DomainError("LEASE_LIMIT", `at most ${caps.maxOpenOffers} lease offers at once`, { ...caps });
    if (caps.out >= caps.maxOut) {
      throw new DomainError("LEASE_LIMIT", `you may have ${caps.maxOut} ${caps.maxOut === 1 ? "horse" : "horses"} out on lease at once (a quarter of your racing horses, at most ${gc.MAX_LEASES_OUT_PER_OWNER})`, { ...caps });
    }
    const [listing] = await tx
      .insert(horseLeaseListings)
      .values({
        horseId: horse.id,
        ownerStableId: stableId,
        termDays: terms.termDays,
        ownerSharePct: terms.ownerSharePct,
        fee: terms.fee,
        allowAllOut: !!input.allowAllOut,
        maxLiveStartsPerWeek: terms.maxLiveStartsPerWeek,
        minLesseeRating: terms.minLesseeRating,
        createdAt: input.now,
        expiresAt: new Date(input.now.getTime() + gc.LEASE_OFFER_DAYS * DAY_MS),
      })
      .returning();
    await audit(tx, { actor: input.accountId, action: "lease.offer", entityType: "lease_listing", entityId: listing!.id, data: { horseId: horse.id, termDays: terms.termDays, ownerSharePct: terms.ownerSharePct, fee: terms.fee } });
    return listing!;
  });
}

export async function withdrawLeaseOffer(db: Db, input: { accountId: string; listingId: string; now: Date }): Promise<void> {
  await runTx(db, async (tx) => {
    const [listing] = await tx.select().from(horseLeaseListings).where(eq(horseLeaseListings.id, input.listingId)).for("update");
    if (!listing) throw new DomainError("NOT_FOUND", "lease offer not found");
    const stable = await stableOf(tx, input.accountId);
    if (listing.ownerStableId !== stable.id) throw new DomainError("NOT_OWNER", "not your offer");
    if (listing.status !== "active") return;
    await tx.update(horseLeaseListings).set({ status: "cancelled", closedAt: input.now }).where(eq(horseLeaseListings.id, listing.id));
    await audit(tx, { actor: input.accountId, action: "lease.withdraw", entityType: "lease_listing", entityId: listing.id });
  });
}

// ---------------------------------------------------------------------------
// Take
// ---------------------------------------------------------------------------

export interface TakeLeaseResult {
  lease: HorseLeaseRow;
  duplicate: boolean;
}

/**
 * Takes a lease. Idempotent (the same stable taking the same offer again gets its lease back) and
 * first come first served (the offer row lock). Lock order: lessee stable -> horse -> offer, the
 * same horse-before-offer order as retire / Legacy Farm / release (withdrawLeaseOffersTx).
 * A refused linked-account lease still records its fraud event (committed), then throws.
 */
export async function takeLease(db: Db, input: { accountId: string; listingId: string; now: Date }): Promise<TakeLeaseResult> {
  const outcome = await runTx(db, async (tx): Promise<TakeLeaseResult | DomainError> => {
    const [peek] = await tx.select({ horseId: horseLeaseListings.horseId }).from(horseLeaseListings).where(eq(horseLeaseListings.id, input.listingId));
    if (!peek) throw new DomainError("NOT_FOUND", "lease offer not found");
    const lesseeStable = await lockStableOf(tx, input.accountId);
    const horse = await lockHorse(tx, peek.horseId);
    const [listing] = await tx.select().from(horseLeaseListings).where(eq(horseLeaseListings.id, input.listingId)).for("update");
    if (!listing) throw new DomainError("NOT_FOUND", "lease offer not found");
    if (listing.status === "sold" && listing.leaseId) {
      const [mine] = await tx.select().from(horseLeases).where(eq(horseLeases.id, listing.leaseId));
      if (mine && mine.lesseeStableId === lesseeStable.id) return { lease: mine, duplicate: true };
    }
    if (listing.status !== "active") throw new DomainError("LISTING_NOT_ACTIVE", "that lease offer is no longer available");
    if (listing.expiresAt <= input.now) throw new DomainError("LISTING_EXPIRED", "that lease offer has lapsed");
    if (listing.ownerStableId === lesseeStable.id) throw new DomainError("CANNOT_BUY_OWN", "that is your own horse");
    // A Club offer (owner null) has no counterparty: nothing to link, no owner caps, the owner's share is burned.
    const ownerAccountId = listing.ownerStableId ? await accountIdOfStable(tx, listing.ownerStableId) : null;
    if (ownerAccountId && (await areLinked(tx, input.accountId, ownerAccountId))) {
      await tx.insert(fraudEvents).values({
        accountId: input.accountId,
        relatedAccountId: ownerAccountId,
        kind: "linked_lease_blocked",
        severity: 2,
        data: { listingId: listing.id, horseId: listing.horseId },
      });
      return new DomainError("LINKED_ACCOUNTS", "leases between linked accounts are not allowed");
    }
    const elig = await lesseeEligibility(tx, { accountId: input.accountId, stableId: lesseeStable.id, now: input.now });
    if (!elig.ok) throw new DomainError(elig.activeLeases >= gc.MAX_LEASES_PER_LESSEE ? "LEASE_LIMIT" : "SELLER_REQUIREMENTS", `to take a lease you need ${elig.problems.join("; ")}`, { problems: elig.problems });
    if (listing.minLesseeRating !== null) {
      const rec = (await lesseeRecords(tx, [lesseeStable.id])).get(lesseeStable.id)!;
      if (!gc.meetsMinRating(rec.ratingSum, rec.ratings, listing.minLesseeRating)) {
        throw new DomainError("NOT_ELIGIBLE", `this owner asks for lessees rated ${listing.minLesseeRating}★ or better`, { minRating: listing.minLesseeRating, starsTenths: rec.starsTenths });
      }
    }
    await assertStallFree(tx, lesseeStable);
    const block = await leaseHorseBlock(tx, horse, listing.ownerStableId, input.now);
    if (block) {
      // Entered in a race at home: try again after it runs. Anything else: the offer is void.
      if (block.block === "in_race") throw new DomainError("HORSE_LOCKED", "the horse is entered in a race at home: try again after it runs");
      await tx.update(horseLeaseListings).set({ status: "cancelled", closedAt: input.now }).where(eq(horseLeaseListings.id, listing.id));
      return new DomainError("LISTING_NOT_ACTIVE", `that lease offer is no longer available (${LEASE_BLOCK_TEXT[block.block]})`);
    }
    const caps = listing.ownerStableId ? await ownerLeaseCaps(tx, listing.ownerStableId) : null;
    if (caps && caps.out >= caps.maxOut) {
      await tx.update(horseLeaseListings).set({ status: "cancelled", closedAt: input.now }).where(eq(horseLeaseListings.id, listing.id));
      return new DomainError("LEASE_LIMIT", "that owner has as many horses out on lease as allowed");
    }

    // Upfront fee (off in the beta): lessee -> owner, platform cut burned.
    let feeTransactionId: string | null = null;
    const split = gc.leaseFeeSplit(listing.fee);
    if (listing.fee > 0) {
      feeTransactionId = (
        await post(tx, {
          idempotencyKey: `lease-fee:${listing.id}`,
          kind: "lease_fee",
          meta: { listingId: listing.id, horseId: horse.id },
          postings: [
            { ledgerAccountId: await playerLedgerAccountId(tx, input.accountId), amount: -listing.fee },
            ...(split.ownerReceives > 0 ? [{ ledgerAccountId: ownerAccountId ? await playerLedgerAccountId(tx, ownerAccountId) : await systemAccountId(tx, "burn"), amount: split.ownerReceives }] : []),
            ...(split.cut > 0 ? [{ ledgerAccountId: await systemAccountId(tx, "burn"), amount: split.cut }] : []),
          ],
        })
      ).transactionId;
    }
    const endsAt = new Date(gc.leaseEndsAtMs(input.now.getTime(), listing.termDays));
    const [lease] = await tx
      .insert(horseLeases)
      .values({
        listingId: listing.id,
        horseId: horse.id,
        ownerStableId: listing.ownerStableId,
        club: listing.club,
        lesseeStableId: lesseeStable.id,
        termDays: listing.termDays,
        ownerSharePct: listing.ownerSharePct,
        fee: listing.fee,
        feeCut: split.cut,
        allowAllOut: listing.allowAllOut,
        maxLiveStartsPerWeek: listing.maxLiveStartsPerWeek,
        startCondition: leaseCondition(horse, input.now),
        startsAt: input.now,
        endsAt,
        feeTransactionId,
        createdAt: input.now,
      })
      .returning();
    await tx.update(horseLeaseListings).set({ status: "sold", leaseId: lease!.id, closedAt: input.now }).where(eq(horseLeaseListings.id, listing.id));
    await tx.update(horses).set({ lesseeStableId: lesseeStable.id, updatedAt: input.now }).where(eq(horses.id, horse.id));

    // Reciprocal leases (A to B, then B to A) within the window: flagged for review, not blocked.
    const [reverse] = listing.ownerStableId
      ? await tx
          .select({ id: horseLeases.id })
          .from(horseLeases)
          .where(
            and(
              eq(horseLeases.ownerStableId, lesseeStable.id),
              eq(horseLeases.lesseeStableId, listing.ownerStableId),
              gte(horseLeases.createdAt, new Date(input.now.getTime() - gc.LEASE_RECIPROCAL_WINDOW_DAYS * DAY_MS)),
            ),
          )
          .limit(1)
      : [];
    if (reverse && ownerAccountId) {
      await tx.insert(fraudEvents).values({
        accountId: input.accountId,
        relatedAccountId: ownerAccountId,
        kind: "lease_reciprocal",
        severity: 1,
        data: { leaseId: lease!.id, reverseLeaseId: reverse.id, horseId: horse.id },
      });
    }
    const ownerName = await stableName(tx, listing.ownerStableId);
    const until = utcDay(endsAt);
    if (ownerAccountId) {
      await inbox(tx, ownerAccountId, `lease-start:${lease!.id}`, "lease_start", `${horse.name} is on lease to ${lesseeStable.name} until ${until}`, horse.id, input.now, {
        leaseId: lease!.id,
        role: "owner",
        ownerSharePct: listing.ownerSharePct,
        endsAtMs: endsAt.getTime(),
      });
    }
    await inbox(tx, input.accountId, `lease-start:${lease!.id}`, "lease_start", `${horse.name} joins your stable on lease from ${ownerName} until ${until}`, horse.id, input.now, {
      leaseId: lease!.id,
      role: "lessee",
      lesseeSharePct: 100 - listing.ownerSharePct,
      endsAtMs: endsAt.getTime(),
    });
    await audit(tx, { actor: input.accountId, action: "lease.take", entityType: "lease", entityId: lease!.id, data: { horseId: horse.id, owner: listing.ownerStableId, club: listing.club, fee: listing.fee, reciprocal: !!reverse } });
    return { lease: lease!, duplicate: false };
  });
  if (outcome instanceof DomainError) throw outcome;
  return outcome;
}

/** How the Club appears as the owner of a lease (and the seller of a market lot). */
export const CLUB_OWNER_NAME = "The Club";

async function stableName(ex: Executor, stableId: string | null): Promise<string> {
  if (!stableId) return CLUB_OWNER_NAME;
  const [s] = await ex.select({ name: stables.name }).from(stables).where(eq(stables.id, stableId));
  return s?.name ?? "another stable";
}

async function inbox(ex: Executor, accountId: string, dedupeKey: string, kind: string, title: string, horseId: string, now: Date, data: Record<string, unknown>): Promise<void> {
  await ex.insert(inboxItems).values({ accountId, kind, dedupeKey, title, data, horseId, createdAt: now }).onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// End of a lease
// ---------------------------------------------------------------------------

export type LeaseEndReason = "term" | "returned" | "injured" | "retired" | "died";

const END_TEXT: Record<LeaseEndReason, string> = {
  term: "the lease ended",
  returned: "handed back early",
  injured: "injured on lease",
  retired: "retired from racing",
  died: "lost in a race",
};

/**
 * Ends a lease inside the caller's transaction: the horse goes home (always: a full stable takes it
 * in overflow), the condition report is recorded and both sides get an inbox note with the totals.
 * The caller must hold the horse row lock or not mind taking it. Never while the horse is entered
 * in a race (the caller checks; settleRace ends it once the race has settled).
 */
export async function endLeaseTx(tx: Executor, lease: HorseLeaseRow, reason: LeaseEndReason, now: Date): Promise<HorseLeaseRow> {
  if (lease.status !== "active") return lease;
  const horse = await lockHorse(tx, lease.horseId);
  const condition = leaseCondition(horse, now);
  if (horse.lesseeStableId === lease.lesseeStableId) await tx.update(horses).set({ lesseeStableId: null, updatedAt: now }).where(eq(horses.id, horse.id));
  const [ended] = await tx
    .update(horseLeases)
    .set({ status: "ended", endReason: reason, endedAt: now, endCondition: condition })
    .where(and(eq(horseLeases.id, lease.id), eq(horseLeases.status, "active")))
    .returning();
  if (!ended) return lease;
  const [ownerAccount, lesseeAccount] = [lease.ownerStableId ? await accountIdOfStable(tx, lease.ownerStableId) : null, await accountIdOfStable(tx, lease.lesseeStableId)];
  const totals = `${ended.races} ${ended.races === 1 ? "race" : "races"}`;
  const data = { leaseId: lease.id, reason, races: ended.races, ownerEarned: ended.ownerEarned, lesseeEarned: ended.lesseeEarned, condition: condition.label, startCondition: (lease.startCondition as LeaseCondition | null)?.label ?? null };
  if (ownerAccount) await inbox(tx, ownerAccount, `lease-end:${lease.id}`, "lease_end", `${horse.name} is home (${END_TEXT[reason]}): ${totals}, ${ended.ownerEarned} cr to you, returned ${condition.label}`, horse.id, now, { ...data, role: "owner" });
  await inbox(tx, lesseeAccount, `lease-end:${lease.id}`, "lease_end", `${horse.name} has gone home (${END_TEXT[reason]}): ${totals}, ${ended.lesseeEarned} cr to you`, horse.id, now, { ...data, role: "lessee" });
  await audit(tx, { actor: null, action: "lease.end", entityType: "lease", entityId: lease.id, data: { reason, races: ended.races, ownerEarned: ended.ownerEarned, lesseeEarned: ended.lesseeEarned } });
  return ended;
}

/**
 * The lessee hands the horse back early (no refund). Entered in a race: it goes home once that race
 * settles (or the race is abandoned). The owner can't recall a horse: a lease is a promise for its term.
 */
export async function returnLease(db: Db, input: { accountId: string; leaseId: string; now: Date }): Promise<{ ended: boolean; pending: boolean }> {
  return runTx(db, async (tx) => {
    // lock order horse -> lease, as in enterRace and settleRace
    const [peek] = await tx.select({ horseId: horseLeases.horseId }).from(horseLeases).where(eq(horseLeases.id, input.leaseId));
    if (!peek) throw new DomainError("NOT_FOUND", "lease not found");
    const horse = await lockHorse(tx, peek.horseId);
    const [lease] = await tx.select().from(horseLeases).where(eq(horseLeases.id, input.leaseId)).for("update");
    if (!lease) throw new DomainError("NOT_FOUND", "lease not found");
    const stable = await stableOf(tx, input.accountId);
    if (lease.lesseeStableId !== stable.id) {
      throw new DomainError("NOT_OWNER", lease.ownerStableId === stable.id ? "only the lessee can end a lease early: the horse comes home at the end of the term" : "not your lease");
    }
    if (lease.status !== "active") return { ended: true, pending: false };
    if (horse.lockKind === "race") {
      if (!lease.endRequestedAt) await tx.update(horseLeases).set({ endRequestedAt: input.now }).where(eq(horseLeases.id, lease.id));
      return { ended: false, pending: true };
    }
    await endLeaseTx(tx, lease, "returned", input.now);
    return { ended: true, pending: false };
  });
}

/** The owner rates the lessee 1-5 stars, once per finished lease. */
export async function rateLessee(db: Db, input: { accountId: string; leaseId: string; stars: number; now: Date }): Promise<HorseLeaseRow> {
  if (!Number.isInteger(input.stars) || input.stars < gc.LEASE_RATING_MIN || input.stars > gc.LEASE_RATING_MAX) {
    throw new DomainError("INVALID_INPUT", `rate ${gc.LEASE_RATING_MIN} to ${gc.LEASE_RATING_MAX} stars`);
  }
  return runTx(db, async (tx) => {
    const [lease] = await tx.select().from(horseLeases).where(eq(horseLeases.id, input.leaseId)).for("update");
    if (!lease) throw new DomainError("NOT_FOUND", "lease not found");
    const stable = await stableOf(tx, input.accountId);
    if (lease.ownerStableId !== stable.id) throw new DomainError("NOT_OWNER", "only the owner rates a lease");
    if (lease.status !== "ended") throw new DomainError("NOT_ELIGIBLE", "rate the lessee once the horse is home");
    if (lease.ownerRating !== null) return lease;
    const [rated] = await tx.update(horseLeases).set({ ownerRating: input.stars, ratedAt: input.now }).where(eq(horseLeases.id, lease.id)).returning();
    return rated!;
  });
}

// ---------------------------------------------------------------------------
// Racing on lease (called from races.ts)
// ---------------------------------------------------------------------------

/**
 * The welfare rules for entering a leased horse (inside enterRace, horse and stable locked):
 * not tired, all-out only if the owner allowed it, within the owner's weekly Live-start cap, and
 * no race after the term ends. Records the entry for the lessee's public record.
 */
export async function leasedEntryCheckTx(
  tx: Executor,
  input: { horse: HorseRow; stableId: string; race: { id: string; kind: string; postTime: Date }; intensity: string | null; now: Date },
): Promise<void> {
  const lease = await lockActiveLeaseOfHorse(tx, input.horse.id);
  if (!lease || lease.lesseeStableId !== input.stableId) throw new DomainError("NOT_OWNER", "not your horse");
  if (lease.endRequestedAt) throw new DomainError("NOT_ELIGIBLE", "you have handed this horse back: it goes home after its race");
  if (input.race.postTime > lease.endsAt) throw new DomainError("NOT_ELIGIBLE", "the lease ends before this race");
  const fatigue = fatigueNow(input.horse, input.now);
  if (fatigue > gc.TIRED_THRESHOLD) throw new DomainError("NOT_ELIGIBLE", "a leased horse can't race while tired: let it recover first");
  if (input.intensity === "all_out" && !lease.allowAllOut) throw new DomainError("NOT_ELIGIBLE", "the owner hasn't allowed all-out rides on this lease");
  if ((LIVE_RACE_KINDS as readonly string[]).includes(input.race.kind)) {
    const week = weekBounds(utcWeekStart(input.race.postTime));
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(raceEntries)
      .innerJoin(races, eq(races.id, raceEntries.raceId))
      .where(
        and(
          eq(raceEntries.horseId, input.horse.id),
          eq(raceEntries.stableId, input.stableId),
          eq(raceEntries.status, "entered"),
          gte(raceEntries.enteredAt, lease.startsAt),
          sql`${races.status} <> 'cancelled'`,
          inArray(races.kind, [...LIVE_RACE_KINDS]),
          gte(races.postTime, week.from),
          sql`${races.postTime} < ${week.to}`,
        ),
      );
    if (Number(r?.n ?? 0) >= lease.maxLiveStartsPerWeek) {
      throw new DomainError("RACE_LIMIT", `the owner allows ${lease.maxLiveStartsPerWeek} Live starts a week on this lease`);
    }
  }
  await tx
    .update(horseLeases)
    .set({ entries: sql`${horseLeases.entries} + 1`, fatigueAtEntrySum: sql`${horseLeases.fatigueAtEntrySum} + ${fatigue}` })
    .where(eq(horseLeases.id, lease.id));
}

/**
 * A lessee using a leased horse outside a race entry (the Daily Cup): refused once the horse has
 * been handed back or the term is over, even before the sweep has sent it home.
 */
export async function assertLeaseInForceTx(tx: Executor, horseId: string, now: Date): Promise<void> {
  const lease = await lockActiveLeaseOfHorse(tx, horseId);
  if (!lease) return;
  if (lease.endRequestedAt) throw new DomainError("NOT_ELIGIBLE", "you have handed this horse back: it goes home after its race");
  if (lease.endsAt <= now) throw new DomainError("NOT_ELIGIBLE", "this lease is over: the horse is going home");
}

export interface LeasedRunner {
  lease: HorseLeaseRow;
  /** Null for a Club lease: the owner's share is burned. */
  ownerAccountId: string | null;
  lesseeAccountId: string;
}

/** Active leases of these runners entered by their lessees (settleRace looks them up before paying). */
export async function leasedRunnersTx(tx: Executor, entries: { horseId: string; stableId: string | null }[]): Promise<Map<string, LeasedRunner>> {
  const ids = entries.filter((e) => e.stableId).map((e) => e.horseId);
  const out = new Map<string, LeasedRunner>();
  if (!ids.length) return out;
  // lock order horse -> lease (enterRace, returnLease and the sweep take them in that order)
  const leasedIds = (await tx.select({ horseId: horseLeases.horseId }).from(horseLeases).where(and(inArray(horseLeases.horseId, ids), eq(horseLeases.status, "active"))))
    .map((r) => r.horseId)
    .sort();
  for (const id of leasedIds) await lockHorse(tx, id);
  const leases = await tx
    .select()
    .from(horseLeases)
    .where(and(inArray(horseLeases.horseId, ids), eq(horseLeases.status, "active")))
    .orderBy(asc(horseLeases.id))
    .for("update");
  for (const l of leases) {
    const e = entries.find((x) => x.horseId === l.horseId);
    if (!e || e.stableId !== l.lesseeStableId) continue;
    out.set(l.horseId, { lease: l, ownerAccountId: l.ownerStableId ? await accountIdOfStable(tx, l.ownerStableId) : null, lesseeAccountId: await accountIdOfStable(tx, l.lesseeStableId) });
  }
  return out;
}

/**
 * Pays a leased runner's purse, split (game-core leaseShareSplit: owner's share rounded down, the
 * rest to the lessee): one `lease_share` transaction, mint -> owner + lessee, so the purse is split
 * exactly and no extra credits exist. A Club lease's owner share goes to burn. Idempotent per (race, horse).
 */
export async function payLeasedPurseTx(tx: Executor, input: { raceId: string; horseId: string; prize: number; runner: LeasedRunner }): Promise<{ owner: number; lessee: number }> {
  const split = gc.leaseShareSplit(input.prize, input.runner.lease.ownerSharePct);
  if (input.prize > 0) {
    await post(tx, {
      idempotencyKey: `lease-share:${input.raceId}:${input.horseId}`,
      kind: "lease_share",
      meta: { raceId: input.raceId, horseId: input.horseId, leaseId: input.runner.lease.id, ownerSharePct: input.runner.lease.ownerSharePct },
      postings: [
        { ledgerAccountId: await systemAccountId(tx, "mint"), amount: -input.prize },
        ...(split.owner > 0
          ? [{ ledgerAccountId: input.runner.ownerAccountId ? await playerLedgerAccountId(tx, input.runner.ownerAccountId) : await systemAccountId(tx, "burn"), amount: split.owner }]
          : []),
        ...(split.lessee > 0 ? [{ ledgerAccountId: await playerLedgerAccountId(tx, input.runner.lesseeAccountId), amount: split.lessee }] : []),
      ],
    });
  }
  return split;
}

/**
 * After a leased horse's race has settled (its row already updated and unlocked): adds the run to
 * the lease's totals and ends the lease when it must (died, retired, injured moderate or worse,
 * term over, or handed back while entered).
 */
export async function afterLeasedRaceTx(
  tx: Executor,
  input: { runner: LeasedRunner; split: { owner: number; lessee: number }; injury: string | null; retired: boolean; fatal: boolean; now: Date },
): Promise<LeaseEndReason | null> {
  const [lease] = await tx
    .update(horseLeases)
    .set({
      races: sql`${horseLeases.races} + 1`,
      ownerEarned: sql`${horseLeases.ownerEarned} + ${input.split.owner}`,
      lesseeEarned: sql`${horseLeases.lesseeEarned} + ${input.split.lessee}`,
      injuries: sql`${horseLeases.injuries} + ${input.injury ? 1 : 0}`,
    })
    .where(and(eq(horseLeases.id, input.runner.lease.id), eq(horseLeases.status, "active")))
    .returning();
  if (!lease) return null;
  const reason: LeaseEndReason | null = input.fatal
    ? "died"
    : input.retired
      ? "retired"
      : input.injury && gc.LEASE_INJURY_RETURNS.includes(input.injury)
        ? "injured"
        : lease.endRequestedAt
          ? "returned"
          : lease.endsAt <= input.now
            ? "term"
            : null;
  if (reason) await endLeaseTx(tx, lease, reason, input.now);
  return reason;
}

// ---------------------------------------------------------------------------
// Lazy maintenance (cron + views)
// ---------------------------------------------------------------------------

export interface LeaseSweep {
  offersExpired: number;
  leasesEnded: number;
}

/**
 * Expires lapsed offers and ends leases whose term is over (or that were handed back), unless the
 * horse is entered in a race: then settleRace sends it home. Also ends a lease whose horse no longer
 * races (a safety net). Idempotent, cheap when nothing is due.
 */
export async function sweepLeases(db: Db, now: Date): Promise<LeaseSweep> {
  const expired = await db
    .update(horseLeaseListings)
    .set({ status: "expired", closedAt: now })
    .where(and(eq(horseLeaseListings.status, "active"), lte(horseLeaseListings.expiresAt, now)))
    .returning({ id: horseLeaseListings.id });
  const due = await db
    .select({ id: horseLeases.id, horseId: horseLeases.horseId })
    .from(horseLeases)
    .innerJoin(horses, eq(horses.id, horseLeases.horseId))
    .where(
      and(
        eq(horseLeases.status, "active"),
        or(lte(horseLeases.endsAt, now), isNotNull(horseLeases.endRequestedAt), sql`${horses.careerStatus} <> 'racing'`),
        or(isNull(horses.lockKind), sql`${horses.lockKind} <> 'race'`),
      ),
    );
  let ended = 0;
  for (const d of due) {
    const done = await runTx(db, async (tx) => {
      const horse = await lockHorse(tx, d.horseId);
      const [lease] = await tx.select().from(horseLeases).where(eq(horseLeases.id, d.id)).for("update");
      if (!lease || lease.status !== "active") return false;
      if (horse.lockKind === "race") return false;
      const reason: LeaseEndReason = horse.careerStatus !== "racing" ? "retired" : lease.endRequestedAt ? "returned" : "term";
      if (reason === "term" && lease.endsAt > now) return false;
      await endLeaseTx(tx, lease, reason, now);
      return true;
    });
    if (done) ended++;
  }
  return { offersExpired: expired.length, leasesEnded: ended };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface LeaseBoardRow {
  listing: HorseLeaseListingRow;
  horse: HorseRow;
  ownerStableName: string;
  ownerSilks: unknown;
  /** The owner has never leased a horse out before. */
  newOwner: boolean;
}

/**
 * The open offers, in the board's default order: quality bands (10 rating points) best first,
 * shuffled within a band by a per-day seed (so the same big stables don't hold the top every day),
 * with "new owner" offers lifted to every third place.
 */
export async function leaseBoard(ex: Executor, now: Date, limit = 60): Promise<LeaseBoardRow[]> {
  const rows = await ex
    .select({ listing: horseLeaseListings, horse: horses, ownerStableName: stables.name, ownerSilks: stables.silks })
    .from(horseLeaseListings)
    .innerJoin(horses, eq(horses.id, horseLeaseListings.horseId))
    .leftJoin(stables, eq(stables.id, horseLeaseListings.ownerStableId))
    .where(and(eq(horseLeaseListings.status, "active"), sql`${horseLeaseListings.expiresAt} > ${now}`))
    .limit(500);
  const owners = [...new Set(rows.map((r) => r.listing.ownerStableId).filter((s): s is string => !!s))];
  const experienced = owners.length
    ? new Set((await ex.selectDistinct({ s: horseLeases.ownerStableId }).from(horseLeases).where(inArray(horseLeases.ownerStableId, owners))).map((r) => r.s))
    : new Set<string>();
  const day = utcDay(now);
  // Club offers (owner null) are never "new owner" offers.
  const board = rows.map((r) => ({ ...r, ownerStableName: r.ownerStableName ?? CLUB_OWNER_NAME, newOwner: !!r.listing.ownerStableId && !experienced.has(r.listing.ownerStableId) }));
  return orderLeaseBoard(board, day).slice(0, limit);
}

/** Default board order (pure, exported for tests): see leaseBoard. */
export function orderLeaseBoard<T extends { listing: { id: string }; horse: { rating: number }; newOwner: boolean }>(rows: T[], day: string): T[] {
  const key = (r: T) => sha256Hex(`lease-board|${day}|${r.listing.id}`);
  const sorted = [...rows].sort((a, b) => Math.floor(b.horse.rating / 10) - Math.floor(a.horse.rating / 10) || (key(a) < key(b) ? -1 : 1));
  const fresh = sorted.filter((r) => r.newOwner);
  const rest = sorted.filter((r) => !r.newOwner);
  const out: T[] = [];
  while (fresh.length || rest.length) {
    // places 2, 5, 8 ... (every third) go to new owners while they last
    if (out.length % 3 === 1 && fresh.length) out.push(fresh.shift()!);
    else if (rest.length) out.push(rest.shift()!);
    else out.push(fresh.shift()!);
  }
  return out;
}

export interface StableLeaseRow {
  lease: HorseLeaseRow;
  horse: HorseRow;
  role: "owner" | "lessee";
  /** Null when the other side is the Club (a Club lease). */
  otherStableId: string | null;
  otherStableName: string;
}

/** A stable's leases: active ones either way, plus ended ones from the last 30 days (to rate). */
export async function stableLeases(ex: Executor, stableId: string, now: Date): Promise<StableLeaseRow[]> {
  const rows = await ex
    .select({ lease: horseLeases, horse: horses })
    .from(horseLeases)
    .innerJoin(horses, eq(horses.id, horseLeases.horseId))
    .where(
      and(
        or(eq(horseLeases.ownerStableId, stableId), eq(horseLeases.lesseeStableId, stableId)),
        or(eq(horseLeases.status, "active"), gte(horseLeases.endedAt, new Date(now.getTime() - 30 * DAY_MS))),
      ),
    )
    .orderBy(desc(horseLeases.createdAt));
  const others = [...new Set(rows.map((r) => (r.lease.ownerStableId === stableId ? r.lease.lesseeStableId : r.lease.ownerStableId)).filter((s): s is string => !!s))];
  const names = new Map(others.length ? (await ex.select({ id: stables.id, name: stables.name }).from(stables).where(inArray(stables.id, others))).map((s) => [s.id, s.name]) : []);
  return rows.map((r) => {
    const role = r.lease.ownerStableId === stableId ? ("owner" as const) : ("lessee" as const);
    const other = role === "owner" ? r.lease.lesseeStableId : r.lease.ownerStableId;
    return { lease: r.lease, horse: r.horse, role, otherStableId: other, otherStableName: other ? (names.get(other) ?? "another stable") : CLUB_OWNER_NAME };
  });
}

/** The owner's open lease offers. */
export async function myLeaseOffers(ex: Executor, stableId: string): Promise<(HorseLeaseListingRow & { horseName: string })[]> {
  const rows = await ex
    .select({ listing: horseLeaseListings, horseName: horses.name })
    .from(horseLeaseListings)
    .innerJoin(horses, eq(horses.id, horseLeaseListings.horseId))
    .where(and(eq(horseLeaseListings.ownerStableId, stableId), eq(horseLeaseListings.status, "active")))
    .orderBy(asc(horseLeaseListings.expiresAt));
  return rows.map((r) => ({ ...r.listing, horseName: r.horseName }));
}

export interface LeaseMetrics {
  active: number;
  openOffers: number;
  /** Player leases (a player's horse) started this week. */
  startedThisWeek: number;
  /** Player-to-player market sales this week. */
  marketSalesThisWeek: number;
  /** Horses claimed in claiming races this week (the race is the market: sales by another road). */
  claimsThisWeek: number;
  sharesPaidThisWeek: number;
  /** The Club's side (clubMarket.ts), counted apart from the players': leases of Club horses started, Club lots sold, Club offers open. */
  club: { leasesStartedThisWeek: number; salesThisWeek: number; openOffers: number };
}

/** Admin health: leases in force and started this week vs market sales this week (UTC week), players and Club apart. */
export async function leaseMetrics(ex: Executor, now: Date): Promise<LeaseMetrics> {
  const week = weekBounds(utcWeekStart(now));
  const [l] = rowsOf<{ active: number; started: number; clubStarted: number }>(
    await ex.execute(sql`
      select count(*) filter (where status = 'active')::int as active,
             count(*) filter (where not club and starts_at >= ${week.from} and starts_at < ${week.to})::int as started,
             count(*) filter (where club and starts_at >= ${week.from} and starts_at < ${week.to})::int as "clubStarted"
        from horse_leases`),
  );
  const [o] = await ex
    .select({ n: sql<number>`count(*) filter (where not ${horseLeaseListings.club})::int`, club: sql<number>`count(*) filter (where ${horseLeaseListings.club})::int` })
    .from(horseLeaseListings)
    .where(and(eq(horseLeaseListings.status, "active"), sql`${horseLeaseListings.expiresAt} > ${now}`));
  const [t] = await ex
    .select({ n: sql<number>`count(*) filter (where not ${trades.club})::int`, club: sql<number>`count(*) filter (where ${trades.club})::int` })
    .from(trades)
    .where(and(gte(trades.createdAt, week.from), sql`${trades.createdAt} < ${week.to}`));
  const [c] = rowsOf<{ n: number }>(
    await ex.execute(sql`select count(*)::int as n from race_claims where status = 'claimed' and closed_at >= ${week.from} and closed_at < ${week.to}`),
  );
  const [s] = rowsOf<{ total: number | string }>(
    await ex.execute(sql`
      select coalesce(sum(p.amount), 0) as total
        from ledger_postings p join ledger_transactions x on x.id = p.transaction_id join ledger_accounts a on a.id = p.ledger_account_id
       where x.kind = 'lease_share' and a.kind = 'player' and p.created_at >= ${week.from} and p.created_at < ${week.to}`),
  );
  return {
    active: Number(l?.active ?? 0),
    openOffers: Number(o?.n ?? 0),
    startedThisWeek: Number(l?.started ?? 0),
    marketSalesThisWeek: Number(t?.n ?? 0),
    claimsThisWeek: Number(c?.n ?? 0),
    sharesPaidThisWeek: Number(s?.total ?? 0),
    club: { leasesStartedThisWeek: Number(l?.clubStarted ?? 0), salesThisWeek: Number(t?.club ?? 0), openOffers: Number(o?.club ?? 0) },
  };
}

/** Lease info for one horse page: the active lease (with the other side's name), if any. */
export async function leaseForHorse(ex: Executor, horseId: string): Promise<(HorseLeaseRow & { ownerStableName: string; lesseeStableName: string }) | null> {
  const l = await activeLeaseOfHorse(ex, horseId);
  if (!l) return null;
  return { ...l, ownerStableName: await stableName(ex, l.ownerStableId), lesseeStableName: await stableName(ex, l.lesseeStableId) };
}

/** Last `n` finishing positions per horse (newest first), in one query: the board's form figures. */
export async function recentFormOf(ex: Executor, horseIds: string[], n = 3): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (!horseIds.length) return out;
  const rows = await ex
    .select({ horseId: raceEntries.horseId, position: raceEntries.finishPosition })
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .where(and(inArray(raceEntries.horseId, [...new Set(horseIds)]), eq(races.status, "settled"), isNotNull(raceEntries.finishPosition)))
    .orderBy(desc(races.postTime))
    .limit(horseIds.length * 12);
  for (const r of rows) {
    const list = out.get(r.horseId) ?? [];
    if (list.length < n && r.position !== null) list.push(r.position);
    out.set(r.horseId, list);
  }
  return out;
}

/** Whether a horse has an open lease offer (market listing guard). */
export async function hasOpenLeaseOffer(ex: Executor, horseId: string): Promise<boolean> {
  const [r] = await ex
    .select({ id: horseLeaseListings.id })
    .from(horseLeaseListings)
    .where(and(eq(horseLeaseListings.horseId, horseId), eq(horseLeaseListings.status, "active")));
  return !!r;
}
