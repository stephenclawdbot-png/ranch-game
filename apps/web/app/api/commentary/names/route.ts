/**
 * POST /api/commentary/names: the commentary-names GitHub workflow uploads one horse name's
 * clips for one caster (Authorization: Bearer $COMMENTARY_UPLOAD_SECRET). See server/commentary.ts.
 */
import { db } from "@/server/db";
import { uploadCommentaryName } from "@/server/commentary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return uploadCommentaryName(await db(), req);
}
