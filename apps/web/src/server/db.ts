/**
 * Server-only database access for route handlers and server components.
 *
 *   import { db } from "@/server/db";
 *   const database = await db();            // Neon (DATABASE_URL) or PGlite (unset)
 *
 * The game flows built on it live in game.ts (card, races, Story, player views) and
 * session.ts (device-cookie accounts). Never import this from a client component.
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
