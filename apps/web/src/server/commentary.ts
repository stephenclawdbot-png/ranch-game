/**
 * Radio commentary name clips over HTTP (docs/commentary.md):
 *
 *   GET  /api/commentary/names/<recipe>/<caster>/<intensity>/<name key>   public MP3, cached for good
 *   POST /api/commentary/names                                            upload (secret)
 *   GET  /api/commentary/names/missing?limit=N                            names to voice (secret)
 *
 * The two secret endpoints are for the commentary-names GitHub workflow only: it sends
 * `Authorization: Bearer $COMMENTARY_UPLOAD_SECRET`, compared in constant time. With the env
 * var unset they answer 503. A clip is keyed by the normalised horse name, never a race: it
 * reveals nothing about any race, so it may be fetched at any time.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import {
  COMMENTARY_CASTERS,
  COMMENTARY_INTENSITIES,
  COMMENTARY_RECIPE,
  getCommentaryClip,
  isDomainError,
  missingCommentaryNames,
  saveCommentaryName,
  type CommentaryIntensity,
  type Db,
} from "@thoroughbred/db";
import { z } from "zod";
import { errorJson, json } from "./http";

/** Largest upload body (three base64 clips of at most 32 KB plus the JSON around them). */
export const COMMENTARY_UPLOAD_MAX_BODY = 160 * 1024;

/** Constant-time check of `Authorization: Bearer <COMMENTARY_UPLOAD_SECRET>`. */
export function commentarySecretOk(req: Request): boolean | "unset" {
  const secret = process.env.COMMENTARY_UPLOAD_SECRET;
  if (!secret) return "unset";
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(req.headers.get("authorization") ?? ""), h(`Bearer ${secret}`));
}

function guard(req: Request): Response | null {
  const ok = commentarySecretOk(req);
  if (ok === "unset") return errorJson(503, "not_configured", { message: "Set COMMENTARY_UPLOAD_SECRET to enable commentary uploads." });
  if (!ok) return errorJson(401, "unauthorized", { message: "Bad commentary secret." });
  return null;
}

const B64 = z.string().max(48 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/);
const UploadSchema = z.object({
  name: z.string().min(1).max(60),
  caster: z.string().max(32),
  recipe: z.number().int(),
  clips: z.object({ calm: B64, building: B64, climax: B64 }),
});

/** POST /api/commentary/names: one name, one caster, three clips (base64 MP3). */
export async function uploadCommentaryName(db: Db, req: Request): Promise<Response> {
  const denied = guard(req);
  if (denied) return denied;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > COMMENTARY_UPLOAD_MAX_BODY) return errorJson(413, "too_large", { message: "Upload too large." });
  const text = await req.text();
  if (text.length > COMMENTARY_UPLOAD_MAX_BODY) return errorJson(413, "too_large", { message: "Upload too large." });
  let body: z.infer<typeof UploadSchema>;
  try {
    body = UploadSchema.parse(JSON.parse(text));
  } catch {
    return errorJson(400, "invalid_body", { message: "Expected { name, caster, recipe, clips: { calm, building, climax } } with base64 MP3s." });
  }
  try {
    const clips = Object.fromEntries(COMMENTARY_INTENSITIES.map((i) => [i, Buffer.from(body.clips[i], "base64")])) as Record<CommentaryIntensity, Buffer>;
    const r = await saveCommentaryName(db, { name: body.name, caster: body.caster, recipe: body.recipe, clips });
    return json({ ok: true, key: r.key, bytes: r.bytes });
  } catch (err) {
    if (isDomainError(err)) return errorJson(err.code === "NOT_FOUND" ? 404 : 400, err.code, { message: err.message });
    throw err;
  }
}

/** GET /api/commentary/names/missing: names still to voice, with the casters missing. */
export async function listMissingCommentaryNames(db: Db, req: Request): Promise<Response> {
  const denied = guard(req);
  if (denied) return denied;
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? "100");
  const names = await missingCommentaryNames(db, { limit: Number.isFinite(limit) ? limit : 100 });
  return json({ recipe: COMMENTARY_RECIPE, casters: COMMENTARY_CASTERS, names });
}

const KEY_MAX = 64;

/** GET one name clip. Immutable once stored: the URL carries the recipe version. */
export async function serveCommentaryClip(db: Db, params: { recipe: string; caster: string; intensity: string; key: string }): Promise<Response> {
  const caster = params.caster;
  const intensity = params.intensity as CommentaryIntensity;
  let key: string;
  try {
    key = decodeURIComponent(params.key).replace(/\.mp3$/, "");
  } catch {
    return errorJson(400, "invalid_body", { message: "Bad name." });
  }
  if (params.recipe !== `${COMMENTARY_RECIPE}` || !(COMMENTARY_CASTERS as readonly string[]).includes(caster) || !COMMENTARY_INTENSITIES.includes(intensity) || !key || key.length > KEY_MAX) {
    return notYet();
  }
  const clip = await getCommentaryClip(db, key, caster, intensity);
  if (!clip) return notYet();
  return new Response(new Uint8Array(clip), {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(clip.length),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      // Stored once and never changed for this recipe: the browser and the CDN keep it for good.
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
    },
  });
}

/** No clip yet: the caster says the saddle-cloth number. Cached briefly (the clip may arrive within the hour). */
function notYet(): Response {
  const res = errorJson(404, "not_found", { message: "No clip for that name yet." });
  res.headers.set("Cache-Control", "public, max-age=600, s-maxage=600");
  return res;
}
