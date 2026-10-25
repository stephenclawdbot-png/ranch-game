/**
 * @thoroughbred/db: server-authoritative persistence for Project Thoroughbred.
 * Server-only (uses node:crypto and database drivers). Never import from client components.
 */
export * as schema from "./schema";
export type * from "./schema";
export type { Db, Executor, Schema, Tx } from "./types";
export { createDb, getDb, getDbHandle, resetDbSingleton, defaultPgliteLocation, type CreateDbOptions, type DbDriver, type DbHandle } from "./client";
export { migrate, type MigrateResult } from "./migrate";
export { DomainError, isDomainError, httpStatusFor, translateDbError, type DomainErrorCode } from "./errors";
export { commitSeed, hashToken, newDeviceToken, newSeed, utcDay, utcWeekStart } from "./crypto";
export * from "./rules";
export * from "./services/tx";
export * from "./services/ledger";
export * from "./services/accounts";
export * from "./services/horses";
export * from "./services/races";
export * from "./services/breeding";
export * from "./services/packs";
export * from "./services/market";
export * from "./services/competition";
export * from "./services/maintenance";
