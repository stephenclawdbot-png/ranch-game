/** Route-handler plumbing for the horse-life APIs (session, error mapping, fresh player for the header). */
import { db, type Db } from "./db";
import { playerView } from "./game";
import { errorJson, handleError, json, readJson } from "./http";
import { requireSession, type Session } from "./session";
import type { z } from "zod";

/** Runs a signed-in action and answers `{ ...result, player }` so the header credits update. */
export async function act<T extends object>(fn: (database: Db, session: Session, now: Date) => Promise<T>, status = 200) {
  try {
    const database = await db();
    const session = await requireSession(database);
    const now = new Date();
    const out = await fn(database, session, now);
    return json({ ...out, player: await playerView(database, session, now) }, { status });
  } catch (err) {
    return handleError(err);
  }
}

/** Parses the JSON body with `schema`; null (after which the caller answers 400) when it doesn't fit. */
export async function body<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S> | null> {
  const parsed = schema.safeParse((await readJson(req)) ?? {});
  return parsed.success ? parsed.data : null;
}

export function badBody(message: string) {
  return errorJson(400, "invalid_body", { message });
}
