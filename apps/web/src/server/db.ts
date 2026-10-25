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
 *  4. Live races (§4d): tickRaceCard() publishes the 3-minute card and locks closed
 *     fields; enterRace()/scratchEntry() while open (entry bank §4f applies);
 *     getRaceForSimulation() at post time → simulateRace() → settleRace() once the
 *     broadcast is over. Call tickRaceCard() lazily on card/race reads (throttled) and from
 *     a cron backstop: GET /api/cron/race-card every minute (vercel.json "crons", check
 *     `Authorization: Bearer ${CRON_SECRET}`), which also settles `dueForSettlement` and
 *     runs runMaintenance() (healing, foaling, listing expiry).
 *  5. Map DomainError.code to HTTP with httpStatusFor().
 *
 * Environments: with DATABASE_URL (Vercel Preview + Production, Neon) the Neon serverless
 * driver is used and migrations run in `pnpm build` (DATABASE_URL_UNPOOLED). Without it,
 * `next dev` and tests use an embedded PGlite (persisted under node_modules/.cache in dev).
 * A production server without DATABASE_URL refuses to start (set ALLOW_EMBEDDED_DB=1 for a
 * local `next start`).
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
