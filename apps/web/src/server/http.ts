import { NextResponse } from "next/server";
import { RaceNotFoundError, TooEarlyError } from "./races";

export function json(data: unknown, init?: ResponseInit & { cache?: string }): NextResponse {
  const res = NextResponse.json(data, init);
  res.headers.set("Cache-Control", init?.cache ?? "no-store");
  return res;
}

export function errorJson(status: number, error: string, extra: Record<string, unknown> = {}): NextResponse {
  return json({ error, ...extra }, { status });
}

/** Maps domain errors to HTTP responses; rethrows anything unexpected. */
export function handleRaceError(err: unknown): NextResponse {
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
  throw err;
}
