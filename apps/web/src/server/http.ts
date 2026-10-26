import { NextResponse } from "next/server";
import { httpStatusFor, isDomainError, type DomainErrorCode } from "@thoroughbred/db";
import { RaceNotFoundError, TooEarlyError, UnauthorizedError } from "./errors";

export function json(data: unknown, init?: ResponseInit & { cache?: string }): NextResponse {
  const res = NextResponse.json(data, init);
  res.headers.set("Cache-Control", init?.cache ?? "no-store");
  return res;
}

export function errorJson(status: number, error: string, extra: Record<string, unknown> = {}): NextResponse {
  return json({ error, message: (extra.message as string | undefined) ?? FRIENDLY[error] ?? error, ...extra }, { status });
}

/** Player-facing wording for domain error codes (the UI may add actions, e.g. a refill offer). */
export const FRIENDLY: Record<string, string> = {
  NOT_FOUND: "We couldn't find that.",
  NOT_OWNER: "That horse isn't in your stable.",
  INVALID_INPUT: "Something in that request wasn't right.",
  INSUFFICIENT_FUNDS: "Not enough credits.",
  STABLE_FULL: "All your stalls are taken.",
  HORSE_LOCKED: "That horse is already entered in a race.",
  HORSE_IN_FOAL: "Mares in foal don't race.",
  HORSE_INJURED: "That horse is recovering from an injury.",
  HORSE_RETIRED: "That horse has retired from racing.",
  HORSE_NOT_OF_AGE: "That horse isn't old enough to race yet.",
  RACE_LIMIT: "That horse has already raced 3 times today. It can race again tomorrow.",
  RACE_CLOSED: "Entries for that race have closed.",
  RACE_FULL: "The stalls are full for that race.",
  NOT_ELIGIBLE: "That horse isn't eligible for this race.",
  TOO_EARLY: "Too early: try again in a moment.",
  INSUFFICIENT_ENTRIES: "No stable entries left today.",
  ENTRY_REFILL_UNAVAILABLE: "A refill isn't available right now.",
  NAME_TAKEN: "That name is taken. Try another.",
  unauthorized: "Found a stable first.",
  race_not_found: "We couldn't find that race.",
  too_early: "The race hasn't started yet.",
  race_live: "The race is still running.",
  no_pick: "None of your horses can race right now.",
};

/** Maps service errors to HTTP responses; rethrows anything unexpected. */
export function handleError(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError) return errorJson(401, "unauthorized");
  if (err instanceof RaceNotFoundError) return errorJson(404, "race_not_found");
  if (err instanceof TooEarlyError) {
    if (err.phase === "live") {
      // Deliberately no end time: when the race finishes would reveal the final time.
      const res = errorJson(425, "race_live", { postTimeMs: err.postTimeMs });
      res.headers.set("Retry-After", "5");
      return res;
    }
    const res = errorJson(425, "too_early", { postTimeMs: err.postTimeMs });
    res.headers.set("Retry-After", String(Math.max(1, Math.ceil((err.postTimeMs - Date.now()) / 1000))));
    return res;
  }
  if (isDomainError(err)) {
    const code = err.code as DomainErrorCode;
    return errorJson(httpStatusFor(code), code, { message: err.message && err.message !== code ? capitalise(err.message) : FRIENDLY[code], details: err.details });
  }
  throw err;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".");
}

/** Parses a JSON body; null when it isn't JSON. */
export async function readJson(req: Request): Promise<unknown | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
