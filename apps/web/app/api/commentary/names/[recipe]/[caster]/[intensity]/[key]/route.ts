/**
 * GET /api/commentary/names/<recipe>/<caster>/<intensity>/<name key>: one horse name as a radio
 * caster says it (audio/mpeg). Public and immutable (cached by the browser and the CDN for a
 * year); 404 (cached ten minutes) until the name has been voiced. See server/commentary.ts.
 */
import { db } from "@/server/db";
import { serveCommentaryClip } from "@/server/commentary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ recipe: string; caster: string; intensity: string; key: string }> }) {
  return serveCommentaryClip(await db(), await params);
}
