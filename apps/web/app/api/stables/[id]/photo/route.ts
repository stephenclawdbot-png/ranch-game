/**
 * A stable's stored photo: GET /api/stables/[id]/photo (public, image/webp). The bytes are
 * always the server's own re-encoded WebP, never an upload as received; the headers keep it
 * that way in the browser (nosniff, no script/style sources in this document). With the right
 * `v` (= the stored hash) the response is immutable — a new photo is a new URL.
 */
import { getStablePhoto } from "@thoroughbred/db";
import { db } from "@/server/db";
import { errorJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return errorJson(400, "invalid_body", { message: "Unknown stable." });
  }
  const photo = await getStablePhoto(await db(), id);
  if (!photo) return errorJson(404, "not_found", { message: "That stable has no photo." });

  const etag = `"${photo.hash}"`;
  // The immutable cache only when the URL carries the current hash; anything else revalidates.
  const version = new URL(req.url).searchParams.get("v");
  const cacheControl = version === photo.hash ? "public, max-age=31536000, immutable" : "no-cache";
  const headers: Record<string, string> = {
    "Content-Type": "image/webp",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'",
    "Content-Disposition": 'inline; filename="stable.webp"',
    "Cache-Control": cacheControl,
    ETag: etag,
  };
  if (req.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(new Uint8Array(photo.image), { headers });
}