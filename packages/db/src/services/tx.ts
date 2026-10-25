import { auditLog } from "../schema";
import { isRetryable, translateDbError } from "../errors";
import type { Db, Executor, Tx } from "../types";

/**
 * Runs `fn` in a transaction. Retries on serialization failures / deadlocks (possible
 * under real concurrency on Neon) and translates rule-encoding constraint violations into
 * DomainErrors.
 */
export async function runTx<T>(db: Db, fn: (tx: Tx) => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await db.transaction(fn);
    } catch (e) {
      if (i < attempts && isRetryable(e)) continue;
      throw translateDbError(e);
    }
  }
}

export interface AuditEntry {
  actor: string | null;
  action: string;
  entityType: string;
  entityId: string;
  data?: Record<string, unknown>;
}

export async function audit(ex: Executor, e: AuditEntry): Promise<void> {
  await ex.insert(auditLog).values({
    actorAccountId: e.actor,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    data: e.data ?? null,
  });
}

export function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] }).rows ?? []) as T[];
}
