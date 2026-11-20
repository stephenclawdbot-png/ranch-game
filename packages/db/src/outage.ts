/**
 * Recognising "the database itself is unavailable": unreachable, refusing connections, or over
 * its plan's quota (Neon answers every query with SQLSTATE 53000 "exceeded the ... quota" then).
 * Callers turn these into an outage answer (HTTP 503, the "yard is closed" screen) instead of a
 * crash; anything else is a real bug and keeps its own error.
 *
 * Drivers report these in several shapes: a Postgres error with a `code`, a Node socket error
 * (`ECONNREFUSED`...), a WebSocket `ErrorEvent` (the Neon serverless driver), or one of those
 * wrapped as `cause` (drizzle's query error) or inside an AggregateError.
 */
import { sql } from "drizzle-orm";
import type { Executor } from "./types";

/** SQLSTATE codes that mean the server cannot take the query at all (connection, resources, shutdown). */
const SQLSTATE = /^(08...|53...|57P0[123])$/;
/** Node / undici socket-level failures. */
const ERRNO = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);
const MESSAGE = new RegExp(
  [
    "exceeded the [a-z ]*quota", // Neon: "Your account or project has exceeded the compute time quota"
    "quota (has been )?exceeded",
    "endpoint is disabled", // Neon: a suspended project
    "control plane request failed", // Neon's proxy could not wake the compute
    "connection terminated", // pg: the socket closed under a query
    "connection (refused|reset|closed|timed out)",
    "timeout exceeded when trying to connect", // pg pool
    "the database system is (starting up|shutting down|in recovery mode)",
    "too many connections",
    "remaining connection slots are reserved",
    "websocket (was closed|is not open|connection)",
    "connect e(connrefused|timedout|hostunreach|netunreach)",
    "getaddrinfo (enotfound|eai_again)",
  ].join("|"),
  "i",
);

/** The stable code the web layer sends for an outage (the API body's `error`). */
export const DB_UNAVAILABLE = "db_unavailable";

/** True when `err` (or what it wraps) says the database is unreachable or over quota. */
export function isDbUnavailable(err: unknown, depth = 0): boolean {
  if (err == null || depth > 5) return false;
  if (typeof err === "string") return MESSAGE.test(err);
  if (typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown; type?: unknown; cause?: unknown; error?: unknown; errors?: unknown; sourceError?: unknown };
  // A chain RPC or another HTTP service failing is not the database (viem errors carry `shortMessage`).
  if ("shortMessage" in (err as object)) return false;
  if (typeof e.code === "string" && (e.code === DB_UNAVAILABLE || SQLSTATE.test(e.code) || ERRNO.has(e.code))) return true;
  if (typeof e.message === "string" && e.message && MESSAGE.test(e.message)) return true;
  // The Neon serverless driver rejects with the WebSocket's `error` event when it cannot connect.
  const ctor = (err as object).constructor?.name;
  if (ctor === "ErrorEvent" || (e.type === "error" && "target" in (err as object))) return true;
  if (isDbUnavailable(e.cause, depth + 1) || isDbUnavailable(e.error, depth + 1) || isDbUnavailable(e.sourceError, depth + 1)) return true;
  if (Array.isArray(e.errors)) return e.errors.some((x) => isDbUnavailable(x, depth + 1));
  return false;
}

/** One typed error for "the database is unavailable" (keeps the driver's error as `cause`). */
export class DbUnavailableError extends Error {
  readonly code = DB_UNAVAILABLE;
  constructor(cause?: unknown) {
    super("the database is unavailable", cause === undefined ? undefined : { cause });
    this.name = "DbUnavailableError";
  }
}

/** One `select 1`: throws when the database does not answer (see isDbUnavailable). */
export async function pingDb(ex: Executor): Promise<void> {
  await ex.execute(sql`select 1`);
}
