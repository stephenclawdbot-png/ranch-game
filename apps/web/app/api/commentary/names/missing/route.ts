/**
 * GET /api/commentary/names/missing?limit=N: horse names still without commentary clips, for the
 * commentary-names GitHub workflow (Authorization: Bearer $COMMENTARY_UPLOAD_SECRET).
 */
import { db } from "@/server/db";
import { listMissingCommentaryNames } from "@/server/commentary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return listMissingCommentaryNames(await db(), req);
}
