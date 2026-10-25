/**
 * Server-only database access for route handlers and server actions.
 *
 *   import { db } from "@/server/db";
 *   const database = await db();            // Neon (DATABASE_URL) or PGlite (unset)
 *   await recordCare(database, { ... });    // services from @thoroughbred/db
 *
 * Never import this from a client component.
 *
 * Migration path from the localStorage demo (src/lib/player.ts):
 *  1. Identity: on first visit POST /api/account → createAccount(); set the returned
 *     token as an httpOnly, Secure, SameSite=Lax cookie; resolve it per request with
 *     authenticate(). Offer a one-time import of the localStorage stable name / silks.
 *  2. Credits: read getBalance(); never trust client totals. Settlement credits purses
 *     through settleRace() (idempotent by race id) instead of the client-side `settled` map.
 *  3. Horses: HorseRepository.getStable() reads listStableHorses() for DB-backed players;
 *     DemoRepository stays for the stateless demo until the switch.
 *  4. Races: createRace() / enterRace() / getRaceForSimulation() → simulateRace() →
 *     settleRace(); the cron backstop calls runMaintenance() + settles overdue races.
 *  5. Map DomainError.code to HTTP with httpStatusFor().
 *
 * Environments: without DATABASE_URL an embedded PGlite is used (persisted under
 * node_modules/.cache in `next dev`, in-memory elsewhere). On Vercel that in-memory database
 * is per function instance and resets on cold start: previews only. Production needs
 * DATABASE_URL (Neon via the Vercel Marketplace); migrations auto-apply on first use.
 */
import { getDb, getDbHandle, type Db, type DbHandle } from "@thoroughbred/db";

export type { Db };

/** The process-wide database (created and migrated on first call). */
export function db(): Promise<Db> {
  return getDb();
}

/** Driver details (for health checks: "neon" or "pglite"). */
export function dbHandle(): Promise<DbHandle> {
  return getDbHandle();
}
