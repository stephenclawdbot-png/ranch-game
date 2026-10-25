#!/usr/bin/env node
// Applies migrations/ to DATABASE_URL (Neon / any Postgres reachable over Neon's WebSocket
// proxy). Same book-keeping as src/migrate.ts and drizzle-kit (drizzle.__drizzle_migrations),
// so it is safe to mix with the runtime auto-migration. Usage:
//   DATABASE_URL=postgres://... pnpm --filter @thoroughbred/db migrate
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, neonConfig } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (local dev and tests use PGlite and migrate automatically).");
  process.exit(1);
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
  console.log(applied.length ? `applied: ${applied.join(", ")}` : "database is up to date");
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error(err);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
