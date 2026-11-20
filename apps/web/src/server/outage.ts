/**
 * Outage handling for server-rendered pages. When the database is unreachable or over quota
 * (@thoroughbred/db isDbUnavailable), a page cannot render; instead of Next's bare error page
 * the player is sent to /outage, the designed "The yard is closed for a moment" screen, which
 * answers HTTP 503 with `Cache-Control: no-store` (middleware.ts). API routes answer 503 JSON
 * (http.ts handleError); anything that is not an outage keeps its own error.
 *
 *   export default function HallPage() {
 *     return dbPage("/hall", async () => { ...the page, as before... });
 *   }
 */
import { redirect } from "next/navigation";
import { isDbUnavailable } from "@thoroughbred/db";

let lastLoggedAt = 0;

/** One log line a minute while the database is down (not one per request). */
export function logOutage(where: string, err: unknown): void {
  const now = Date.now();
  if (now - lastLoggedAt < 60_000) return;
  lastLoggedAt = now;
  console.error(`[outage] database unavailable (${where})`, err);
}

/** Where the outage page's "Try again" returns to. */
export function outageHref(from: string): string {
  return `/outage?from=${encodeURIComponent(from)}`;
}

/**
 * Runs a page's server work; if the database is unavailable, redirects to the outage page
 * (HTTP 503 there) with `from` as the way back. `from` is the page's own path.
 */
export async function dbPage<T>(from: string | (() => string | Promise<string>), render: () => Promise<T>): Promise<T> {
  try {
    return await render();
  } catch (err) {
    if (!isDbUnavailable(err)) throw err;
    const path = typeof from === "string" ? from : await Promise.resolve(from()).catch(() => "/");
    logOutage(path, err);
    redirect(outageHref(path));
  }
}

/** For data a page can live without: the fallback when the database is unavailable (other errors still throw). */
export async function orWhenDown<T>(load: () => Promise<T>, fallback: T, where = "page"): Promise<T> {
  try {
    return await load();
  } catch (err) {
    if (!isDbUnavailable(err)) throw err;
    logOutage(where, err);
    return fallback;
  }
}
