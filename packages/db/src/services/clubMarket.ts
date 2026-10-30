/**
 * The Club seeds the horse market and the lease board (race meetings plan 2026-10-30, item 6;
 * every number in game-core clubMarket.ts).
 *
 * Once per UTC day (runClubMarket, from runMaintenance; a club_market_days row per day makes
 * reruns do nothing):
 *   - sale lots: the Club mints `CLUB_SALE_LISTINGS_PER_DAY` racing-age horses the way it mints its
 *     Live runners (the houseHorse hook: game-core breeds and genetics v2) and lists them in the
 *     credits market at `CLUB_SALE_PRICE_PERMILLE` of their appraisal for 72 h, keeping at most
 *     max(0, CLUB_SALE_LISTINGS_MAX - live player lots) Club lots live (extra ones are withdrawn);
 *   - lease offers: the Club tops its open offers up to max(0, CLUB_LEASE_OFFERS_MAX - open player
 *     offers) from its own racing horses (minting when it has none free), 7 or 14 days, owner share
 *     50%, the lease welfare defaults.
 *
 * Representation: the Club owns its horses as it always has (owner_stable_id null, origin
 * 'house'); its listings, offers, leases and trades carry seller/owner null and `club = true`.
 * market.ts buyListing burns a Club lot's whole price; leasing.ts burns a Club lease's owner share.
 * The buyer's stall cap and resale lock and the lessee's eligibility apply as to any player lot;
 * there is no counterparty to link. A Club horse that doesn't sell, or comes home from a lease,
 * goes back to the Club's pool of Live runners. A bought one is an ordinary player horse that
 * stays origin 'house' (Club-bred), so it can never register for the USDG market.
 *
 * Nothing a player does makes the Club act for them: the job runs from maintenance only.
 */
import { and, asc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { sha256Hex, utcDay } from "../crypto";
import { gc, isGenome, toHorseState } from "../gameCore";
import { defaultHooks } from "../hooks";
import { defaultAppraise, RULES, seasonNumberAt, type GameHooks } from "../rules";
import { clubMarketDays, horseLeaseListings, horses, marketListings, type HorseRow } from "../schema";
import type { Db, Executor } from "../types";
import { insertHorse } from "./accounts";
import { lockHorse } from "./horses";
import { leaseHorseBlock } from "./leasing";
import { closeListing } from "./market";
import { audit, runTx } from "./tx";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface ClubMarketRun {
  day: string;
  /** False when the job had already run for this UTC day (nothing done). */
  ran: boolean;
  listed: number;
  offered: number;
  /** Club lots and offers withdrawn because players now supply enough. */
  withdrawn: number;
}

/** Live lots / open lease offers, split Club vs players. */
export async function clubSupplyCounts(ex: Executor, now: Date): Promise<{ clubLots: number; playerLots: number; clubOffers: number; playerOffers: number }> {
  const [lots] = await ex
    .select({
      club: sql<number>`count(*) filter (where ${marketListings.club})::int`,
      player: sql<number>`count(*) filter (where not ${marketListings.club})::int`,
    })
    .from(marketListings)
    .where(and(eq(marketListings.status, "active"), gt(marketListings.expiresAt, now)));
  const [offers] = await ex
    .select({
      club: sql<number>`count(*) filter (where ${horseLeaseListings.club})::int`,
      player: sql<number>`count(*) filter (where not ${horseLeaseListings.club})::int`,
    })
    .from(horseLeaseListings)
    .where(and(eq(horseLeaseListings.status, "active"), gt(horseLeaseListings.expiresAt, now)));
  return { clubLots: Number(lots?.club ?? 0), playerLots: Number(lots?.player ?? 0), clubOffers: Number(offers?.club ?? 0), playerOffers: Number(offers?.player ?? 0) };
}

/** Mints one racing-age Club horse (the Live-runner minting) of the day's quality (game-core clubSaleQuality). */
async function mintClubHorse(tx: Executor, input: { seed: string; index: number; day: string; now: Date }, hooks: GameHooks): Promise<HorseRow> {
  const season = seasonNumberAt(input.now);
  const make = hooks.houseHorse ?? defaultHooks.houseHorse!;
  const { rating, rarity } = gc.clubSaleQuality(input.day, input.index);
  const spec = make({ seed: input.seed, index: input.index, raceClass: "club", rating, rarity, season });
  const id = await insertHorse(tx, { stableId: null, spec: { ...spec, careSessions: RULES.careToRacing }, origin: "house", birthSeasonNumber: season, now: input.now });
  return lockHorse(tx, id);
}

/** Runs the Club's market job for the UTC day of `now`. Idempotent per day. */
export async function runClubMarket(db: Db, now: Date, hooks: GameHooks = defaultHooks): Promise<ClubMarketRun> {
  const day = utcDay(now);
  return runTx(db, async (tx) => {
    // Claim the day first: a concurrent run waits on the primary key, then finds it taken.
    const [claimed] = await tx.insert(clubMarketDays).values({ day, createdAt: now }).onConflictDoNothing().returning({ day: clubMarketDays.day });
    if (!claimed) return { day, ran: false, listed: 0, offered: 0, withdrawn: 0 };
    const counts = await clubSupplyCounts(tx, now);
    const seed = sha256Hex(`club-market|${day}`);
    let withdrawn = 0;

    // --- Sale lots -------------------------------------------------------------------------
    const saleCap = gc.clubSaleCap(counts.playerLots);
    if (counts.clubLots > saleCap) {
      // Players supply enough: withdraw the newest Club lots over the cap.
      const extra = await tx
        .select()
        .from(marketListings)
        .where(and(eq(marketListings.club, true), eq(marketListings.status, "active"), gt(marketListings.expiresAt, now)))
        .orderBy(sql`${marketListings.createdAt} desc`, asc(marketListings.id))
        .limit(counts.clubLots - saleCap)
        .for("update");
      for (const l of extra) await closeListing(tx, l, "cancelled", now);
      withdrawn += extra.length;
    }
    const toList = gc.clubSaleLotsToList(Math.min(counts.clubLots, saleCap), counts.playerLots);
    const appraise = hooks.appraise ?? defaultAppraise;
    let listed = 0;
    for (let i = 0; i < toList; i++) {
      const horse = await mintClubHorse(tx, { seed, index: i, day, now }, hooks);
      const appraisal = appraise(horse);
      let price = gc.clubSalePrice(appraisal);
      if (isGenome(horse.genome)) {
        // Inside the market's own price band for this horse, like any player lot.
        const st = toHorseState(horse);
        price = Math.min(Math.max(price, gc.listingFloor(st)), gc.listingCeiling(st));
      }
      const [listing] = await tx
        .insert(marketListings)
        .values({ horseId: horse.id, sellerStableId: null, club: true, price, appraisal, createdAt: now, expiresAt: new Date(now.getTime() + gc.CLUB_SALE_LISTING_HOURS * HOUR_MS) })
        .returning();
      await tx.update(horses).set({ lockKind: "market", lockRef: listing!.id, updatedAt: now }).where(eq(horses.id, horse.id));
      await audit(tx, { actor: null, action: "club.list", entityType: "listing", entityId: listing!.id, data: { horseId: horse.id, price, appraisal, rating: horse.rating } });
      listed++;
    }

    // --- Lease offers ----------------------------------------------------------------------
    const leaseCap = gc.clubLeaseCap(counts.playerOffers);
    if (counts.clubOffers > leaseCap) {
      const extra = await tx
        .update(horseLeaseListings)
        .set({ status: "cancelled", closedAt: now })
        .where(
          sql`${horseLeaseListings.id} in (select id from horse_lease_listings where club and status = 'active' and expires_at > ${now} order by created_at desc, id limit ${counts.clubOffers - leaseCap})`,
        )
        .returning({ id: horseLeaseListings.id });
      withdrawn += extra.length;
    }
    const need = Math.max(0, leaseCap - counts.clubOffers);
    let offered = 0;
    if (need > 0) {
      // Free Club racers with enough career left, in a per-day shuffled order.
      const pool = await tx
        .select()
        .from(horses)
        .where(
          and(
            isNull(horses.ownerStableId),
            isNull(horses.lesseeStableId),
            eq(horses.origin, "house"),
            eq(horses.careerStatus, "racing"),
            isNull(horses.lockKind),
            isNull(horses.studFee),
            sql`${horses.careSessions} >= ${RULES.careToRacing}`,
            lte(horses.starts, RULES.maxStarts - gc.LEASE_MIN_STARTS_LEFT),
            sql`${horses.rating} between ${gc.CLUB_RATING_MIN} and ${gc.CLUB_BETTER_RATING_MAX}`,
            sql`not exists (select 1 from horse_lease_listings o where o.horse_id = ${horses.id} and o.status = 'active')`,
          ),
        )
        .orderBy(sql`md5(${horses.id}::text || ${day})`)
        .limit(need * 3)
        .for("update", { skipLocked: true });
      const chosen: HorseRow[] = [];
      for (const h of pool) {
        if (chosen.length >= need) break;
        if (!(await leaseHorseBlock(tx, h, null, now))) chosen.push(h);
      }
      for (let i = chosen.length; i < need; i++) chosen.push(await mintClubHorse(tx, { seed, index: 100 + i, day, now }, hooks));
      for (const [i, h] of chosen.entries()) {
        const [offer] = await tx
          .insert(horseLeaseListings)
          .values({
            horseId: h.id,
            ownerStableId: null,
            club: true,
            termDays: gc.clubLeaseTermDays(day, i),
            ownerSharePct: gc.CLUB_LEASE_OWNER_SHARE_PCT,
            fee: 0,
            allowAllOut: false,
            maxLiveStartsPerWeek: gc.LEASE_WEEKLY_STARTS_DEFAULT,
            minLesseeRating: null,
            createdAt: now,
            expiresAt: new Date(now.getTime() + gc.LEASE_OFFER_DAYS * DAY_MS),
          })
          .returning({ id: horseLeaseListings.id });
        await audit(tx, { actor: null, action: "club.lease_offer", entityType: "lease_listing", entityId: offer!.id, data: { horseId: h.id, rating: h.rating } });
        offered++;
      }
    }

    await tx.update(clubMarketDays).set({ listed, offered, withdrawn }).where(eq(clubMarketDays.day, day));
    return { day, ran: true, listed, offered, withdrawn };
  });
}
