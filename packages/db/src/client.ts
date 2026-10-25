/**
 * Database client factory.
 *
 * - `DATABASE_URL` set   → Neon serverless (WebSocket Pool: real interactive transactions
 *                          and row locks). Migrations auto-apply on first use unless
 *                          `DB_AUTO_MIGRATE=0` (advisory-locked, safe across cold starts).
 * - `DATABASE_URL` unset → embedded PGlite (Postgres 17 in WASM), migrations always applied:
 *                          zero-setup local dev, tests and preview deploys.
 *                          `PGLITE_DIR` = a directory to persist to, or "memory".
 *                          Default: persisted under node_modules/.cache/thoroughbred-pglite
 *                          when NODE_ENV=development, in-memory otherwise.
 *
 * On Vercel, in-memory PGlite lives inside one function instance: it resets on every cold
 * start and is NOT shared between instances. Fine for previews and demos; production needs
 * a real DATABASE_URL (Neon via the Vercel Marketplace).
 *
 * Server-only: never import this module from client components.
 */
import * as schema from "./schema";
import { migrate } from "./migrate";
import type { Db } from "./types";

export type DbDriver = "neon" | "pglite";

export interface DbHandle {
  db: Db;
  driver: DbDriver;
  /** Where PGlite stores data ("memory" or a directory); null for Neon. */
  location: string | null;
  close(): Promise<void>;
}

export interface CreateDbOptions {
  /** Overrides DATABASE_URL. Pass null to force PGlite. */
  url?: string | null;
  /** PGlite only: "memory" or a directory. Overrides PGLITE_DIR. */
  pglite?: string;
  /** Apply bundled migrations (default: always for PGlite, DB_AUTO_MIGRATE !== "0" for Neon). */
  migrate?: boolean;
}

function env(name: string): string | undefined {
  const v = typeof process !== "undefined" ? process.env[name] : undefined;
  return v && v.trim() ? v.trim() : undefined;
}

export function defaultPgliteLocation(): string {
  const configured = env("PGLITE_DIR");
  if (configured) return configured;
  if (env("NODE_ENV") === "development") return `${process.cwd()}/node_modules/.cache/thoroughbred-pglite`;
  return "memory";
}

export async function createDb(opts: CreateDbOptions = {}): Promise<DbHandle> {
  const url = opts.url === undefined ? env("DATABASE_URL") : opts.url ?? undefined;
  if (url) {
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-serverless");
    // Node >= 22 and edge runtimes provide a global WebSocket; the driver needs one for
    // sessions/transactions.
    if (!neonConfig.webSocketConstructor && typeof globalThis.WebSocket !== "undefined") {
      neonConfig.webSocketConstructor = globalThis.WebSocket;
    }
    const pool = new Pool({ connectionString: url });
    const db = drizzle({ client: pool, schema }) as unknown as Db;
    if (opts.migrate ?? env("DB_AUTO_MIGRATE") !== "0") await migrate(db);
    return { db, driver: "neon", location: null, close: () => pool.end() };
  }

  const location = opts.pglite ?? defaultPgliteLocation();
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = location === "memory" ? await PGlite.create() : await PGlite.create(location);
  const db = drizzle({ client, schema }) as unknown as Db;
  if (opts.migrate ?? true) await migrate(db);
  return { db, driver: "pglite", location, close: () => client.close() };
}

// ---------------------------------------------------------------------------
// Process-wide singleton (survives Next.js dev hot reloads via globalThis)
// ---------------------------------------------------------------------------

const KEY = Symbol.for("thoroughbred.db");
type GlobalWithDb = typeof globalThis & { [KEY]?: Promise<DbHandle> };

/** The shared handle for this server process. Created (and migrated) on first call. */
export function getDbHandle(): Promise<DbHandle> {
  const g = globalThis as GlobalWithDb;
  if (!g[KEY]) {
    g[KEY] = createDb().catch((e: unknown) => {
      delete g[KEY];
      throw e;
    });
  }
  return g[KEY];
}

/** The shared database for this server process. */
export async function getDb(): Promise<Db> {
  return (await getDbHandle()).db;
}

/** Tests / scripts: close and forget the singleton. */
export async function resetDbSingleton(): Promise<void> {
  const g = globalThis as GlobalWithDb;
  const p = g[KEY];
  delete g[KEY];
  if (p) await (await p).close();
}
