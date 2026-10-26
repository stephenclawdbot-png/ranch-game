import { checkHorseName } from "@thoroughbred/db";
import { db } from "@/server/db";
import { handleError, json } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Is this horse name valid and free? Advisory (the claim happens, under a lock, when the
 * name is saved). `?name=Brave+Heart[&horseId=<uuid>]` (horseId: the horse being renamed).
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const name = (url.searchParams.get("name") ?? "").slice(0, 64);
    const horseId = url.searchParams.get("horseId");
    const res = await checkHorseName(await db(), name, horseId && UUID_RE.test(horseId) ? { exceptHorseId: horseId } : {});
    return json(res);
  } catch (err) {
    return handleError(err);
  }
}
