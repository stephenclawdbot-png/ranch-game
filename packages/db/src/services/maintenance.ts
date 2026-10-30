/**
 * The only time-driven state changes (cron backstop / lazily on request). By design
 * (game-design §4a) elapsed time never ages, declines, charges or harms a horse. The
 * sweep only:
 *   - heals injuries whose real-time recovery has ended;
 *   - completes due pregnancies (the foal always arrives);
 *   - expires market listings (returning the horse to its owner);
 *   - expires lease offers and sends horses home when their lease term is over (leasing.ts);
 *   - once per UTC day, lets the Club list horses for sale and offer horses on lease (clubMarket.ts);
 *   - sets any Club horse still carrying a stamped rating to its real ability mark (clubFill.ts).
 */
import { settleUpkeep } from "./upkeep";
import { and, isNotNull, lte } from "drizzle-orm";
import { horses } from "../schema";
import {type GameHooks } from "../rules";
import { defaultHooks } from "../hooks";
import type { Db } from "../types";
import { foal, listDuePregnancies } from "./breeding";
import { expireListings } from "./market";
import { sweepLeases } from "./leasing";
import { runClubMarket, type ClubMarketRun } from "./clubMarket";
import { sweepClubRatings } from "./clubFill";
import { runTx } from "./tx";

export interface MaintenanceReport {
  healed: number;
  foaled: string[];
  listingsExpired: number;
  leasesEnded: number;
  club: ClubMarketRun;
  /** Club horses whose stamped rating was set to their real ability mark this run. */
  clubRecalibrated: number;
}

export async function healInjuries(db: Db, now: Date): Promise<number> {
  return runTx(db, async (tx) => {
    const rows = await tx
      .update(horses)
      .set({ injury: null, injuredUntil: null })
      .where(and(isNotNull(horses.injuredUntil), lte(horses.injuredUntil, now)))
      .returning({ id: horses.id });
    return rows.length;
  });
}

export async function runMaintenance(db: Db, now: Date, hooks: GameHooks = defaultHooks): Promise<MaintenanceReport> {
  const healed = await healInjuries(db, now);
  const foaled: string[] = [];
  for (const p of await listDuePregnancies(db, now)) {
    const r = await foal(db, { pregnancyId: p.id, now }, hooks);
    if (!r.alreadyFoaled) foaled.push(r.foalId);
  }
  const listingsExpired = await expireListings(db, now);
  const leases = await sweepLeases(db, now);
  await settleUpkeep(db, now);
  // After the expiries and the sweep, so the day's caps see today's real supply.
  const club = await runClubMarket(db, now, hooks);
  // After the expiries: a Club lot that didn't sell is back in the pool, and honest from here.
  const clubRecalibrated = await sweepClubRatings(db, now);
  return { healed, foaled, listingsExpired, leasesEnded: leases.leasesEnded, club, clubRecalibrated };
}
