/**
 * Runtime migrator. Applies the bundled SQL migrations (src/migrations.generated.ts, built
 * from migrations/ by `pnpm --filter @thoroughbred/db generate`) without touching the
 * filesystem, so it works inside Next.js / Vercel function bundles.
 *
 * Book-keeping is compatible with drizzle-kit's own migrator (table
 * drizzle.__drizzle_migrations, sha256 of the file, journal `when`), so `drizzle-kit migrate`
 * and this runner can be used interchangeably. All pending migrations run in one
 * transaction under a transaction-scoped advisory lock: concurrent cold starts serialise
 * and the losers find nothing left to do.
 */
import { sql } from "drizzle-orm";
import { MIGRATIONS, type BundledMigration } from "./migrations.generated";
import type { Db } from "./types";

const LOCK_KEY = 7_204_311_009; // arbitrary, stable

function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] }).rows ?? []) as T[];
}

export interface MigrateResult {
  applied: string[];
}

export async function migrate(db: Db, migrations: readonly BundledMigration[] = MIGRATIONS): Promise<MigrateResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
    await tx.execute(sql`create schema if not exists drizzle`);
    await tx.execute(
      sql`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`,
    );
    const last = rowsOf<{ created_at: string | number | null }>(
      await tx.execute(sql`select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`),
    )[0];
    const lastWhen = last?.created_at == null ? -1 : Number(last.created_at);
    const applied: string[] = [];
    for (const m of migrations) {
      if (m.when <= lastWhen) continue;
      for (const stmt of m.sql.split("--> statement-breakpoint")) {
        if (stmt.trim()) await tx.execute(sql.raw(stmt));
      }
      await tx.execute(sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${m.hash}, ${m.when})`);
      applied.push(m.tag);
    }
    return { applied };
  });
}
