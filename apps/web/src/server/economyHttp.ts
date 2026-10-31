/** Route plumbing for the economy APIs (breeding, studs, packs, market). */
import { z } from "zod";
import type { TelemetryEvent } from "@thoroughbred/db";
import { trackEvent } from "./playtest";
import { db, type Db } from "./db";
import { friendlyEconomyError } from "./economy";
import { practiceWording } from "./chain/practice";
import { errorJson, handleError, json, readJson } from "./http";
import { requireSession, type Session } from "./session";

export const IdSchema = z.string().uuid();
/** Client-generated idempotency key (one per confirmed action; retries reuse it). */
export const KeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/);

/** Runs `fn` for the signed-in player; maps domain errors to friendly JSON errors. */
export async function withPlayer<T>(fn: (database: Db, session: Session, now: Date) => Promise<T>, status = 200, event?: TelemetryEvent) {
  try {
    const database = await db();
    const session = await requireSession(database);
    const out = await fn(database, session, new Date());
    if (event) await trackEvent(database, session.accountId, event);
    // Practice mode: any USDG wording in these views (stud blocks, USDG-only lots) reads T-USDG.
    return json(practiceWording(out), { status });
  } catch (err) {
    return handleError(friendlyEconomyError(err));
  }
}

/** Parses a JSON body with `schema`; on failure returns a 400 response instead. */
export async function parseBody<S extends z.ZodType>(req: Request, schema: S, message: string): Promise<{ ok: true; data: z.infer<S> } | { ok: false; res: ReturnType<typeof errorJson> }> {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return { ok: false, res: errorJson(400, "invalid_body", { message }) };
  return { ok: true, data: parsed.data };
}
