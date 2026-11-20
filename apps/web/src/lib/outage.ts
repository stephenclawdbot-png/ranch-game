/**
 * Client side of the outage screen: when an API call answers 503 `db_unavailable` (the database
 * is unreachable or over quota, server/http.ts), the page shows "The yard is closed for a
 * moment" (components/OutageOverlay) instead of half-working screens and silent failures.
 * One flag for the whole tab; it clears when a later call gets through.
 */
import { useSyncExternalStore } from "react";

/** The API error code for an outage (the same string as @thoroughbred/db's DB_UNAVAILABLE). */
export const OUTAGE_CODE = "db_unavailable";

let down = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (down === next) return;
  down = next;
  for (const l of [...listeners]) l();
}

/** An API call reported the outage. */
export function reportOutage(): void {
  set(true);
}

/** An API call that needs the database got through: the outage is over. */
export function clearOutage(): void {
  set(false);
}

export function isOutage(): boolean {
  return down;
}

/** True when `res` is the outage answer. Reads a clone, so the caller can still read the body. */
export async function isOutageResponse(res: Response): Promise<boolean> {
  if (res.status !== 503) return false;
  try {
    const body = (await res.clone().json()) as { error?: unknown };
    return body?.error === OUTAGE_CODE;
  } catch {
    return false;
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** True while the tab believes the database is down. */
export function useOutage(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => down,
    () => false,
  );
}

/** A same-site path to go back to ("/races"), or null: never an absolute or protocol-relative URL. */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 300) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || raw.startsWith("/outage")) return null;
  return raw;
}
