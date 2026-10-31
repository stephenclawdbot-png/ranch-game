import { z } from "zod";
import { db } from "@/server/db";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { rivalInviter, rivalInviteView } from "@/server/rivalInvite";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ?code=: who sent a rival invite (public, for the founding page). Without it: your rival invite link. */
export async function GET(req: Request) {
  try {
    const database = await db();
    const code = new URL(req.url).searchParams.get("code");
    if (code !== null) {
      const inviter = /^[A-Za-z0-9-]{4,40}$/.test(code) ? await rivalInviter(database, code) : null;
      return inviter ? json(inviter) : errorJson(404, "not_found");
    }
    const session = await requireSession(database);
    return json(await rivalInviteView(database, session, { origin: originOf(req), now: new Date() }));
  } catch (err) {
    return handleError(err);
  }
}

const BodySchema = z.object({ deviceId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional() });

/** Your rival invite link; records this browser's device id (anti-alt: the same browser on both sides gets no welcome). */
export async function POST(req: Request) {
  const parsed = BodySchema.safeParse((await readJson(req)) ?? {});
  if (!parsed.success) return errorJson(400, "invalid_body");
  try {
    const database = await db();
    const session = await requireSession(database);
    return json(await rivalInviteView(database, session, { origin: originOf(req), now: new Date(), deviceId: parsed.data.deviceId ?? null }));
  } catch (err) {
    return handleError(err);
  }
}

const originOf = (req: Request) => (process.env.PUBLIC_BASE_URL?.trim() || new URL(req.url).origin).replace(/\/$/, "");
