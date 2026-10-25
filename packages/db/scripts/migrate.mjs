#!/usr/bin/env node
// Deploy-time migrator. Applies migrations/ to DATABASE_URL_UNPOOLED (Neon direct
// connection; set by the Vercel Neon integration for Preview + Production) or
// MIGRATE_DATABASE_URL. A no-op (exit 0) when neither is set, so local and CI builds
// without a database are unaffected.
//
// Idempotent and safe when two builds run at once: everything happens in one transaction
// under pg_advisory_xact_lock, and applied migrations are recorded in
// drizzle.__drizzle_migrations (same book-keeping as src/migrate.ts and drizzle-kit).
//
// Run from apps/web's build: `node --experimental-websocket ../../packages/db/scripts/migrate.mjs && next build`
// (the flag gives Node 20 a global WebSocket; it is a no-op on Node 22+).
// Preview and Production share one database: migrations must stay additive and
// backward-compatible (see packages/db/README.md).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, neonConfig } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.MIGRATE_DATABASE_URL;
if (!url) {
  console.log("[db:migrate] DATABASE_URL_UNPOOLED not set: skipping (PGlite environments migrate on first use).");
  process.exit(0);
}
if (!neonConfig.webSocketConstructor && typeof globalThis.WebSocket !== "undefined") neonConfig.webSocketConstructor = globalThis.WebSocket;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const journal = JSON.parse(readFileSync(join(root, "migrations/meta/_journal.json"), "utf8"));
const pool = new Pool({ connectionString: url });
const client = await pool.connect();
try {
  await client.query("begin");
  await client.query("select pg_advisory_xact_lock(7204311009)");
  await client.query("create schema if not exists drizzle");
  await client.query("create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)");
  const last = (await client.query("select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1")).rows[0];
  const lastWhen = last ? Number(last.created_at) : -1;
  const applied = [];
  for (const e of journal.entries) {
    if (e.when <= lastWhen) continue;
    const sql = readFileSync(join(root, "migrations", `${e.tag}.sql`), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) if (stmt.trim()) await client.query(stmt);
    await client.query("insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)", [
      createHash("sha256").update(sql).digest("hex"),
      e.when,
    ]);
    applied.push(e.tag);
  }
  await client.query("commit");
  console.log(applied.length ? `[db:migrate] applied: ${applied.join(", ")}` : "[db:migrate] database is up to date");
} catch (err) {
  await client.query("rollback").catch(() => {});
  // Never print the connection string.
  console.error("[db:migrate] failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
