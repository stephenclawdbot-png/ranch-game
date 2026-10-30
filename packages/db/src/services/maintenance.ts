/**
 * The only time-driven state changes (cron backstop / lazily on request). By design
 * (game-design §4a) elapsed time never ages, declines, charges or harms a horse. The
 * sweep only:
 *   - heals injuries whose real-time recovery has ended;
 *   - completes due pregnancies (the foal always arrives);
 *   - expires market listings (returning the horse to its owner);
 *   - expires lease offers and sends horses home when their lease term is over (leasing.ts);
 *   - prunes rate-limit counters past the oldest window anyone counts (rateLimit.ts).
 */
import { settleUpkeep } from "./upkeep";
import { and, isNotNull, lte } from "drizzle-orm";
import { horses } from "../schema";
import {type GameHooks } from "../rules";
import { defaultHooks } from "../hooks";
import type { Db } from "../types";
import { foal, listDuePregnancies } from "./breeding";
import { expireListings } from "./market";
import { pruneRateLimits } from "./rateLimit";
import { sweepLeases } from "./leasing";
import { runTx } from "./tx";

export interface MaintenanceReport {
  healed: number;
  foaled: string[];
  listingsExpired: number;
  leasesEnded: number;
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
  // Two windows of the longest limit (1 h): nothing reads a counter this old again.
  await pruneRateLimits(db, { olderThanMs: 2 * 3_600_000, now: now.getTime() });
  return { healed, foaled, listingsExpired, leasesEnded: leases.leasesEnded };
}
