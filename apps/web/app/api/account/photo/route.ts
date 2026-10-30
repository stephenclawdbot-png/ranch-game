/**
 * Stable photo (owner decision 2026-10-30): POST /api/account/photo uploads one (multipart form
 * field `photo`), DELETE removes it. The upload is re-encoded server-side into a fresh WebP
 * before it is stored (src/server/stablePhoto.ts): no uploaded byte is ever stored or served.
 */
import * as gc from "@thoroughbred/game-core";
import { removeStablePhoto, saveStablePhoto } from "@thoroughbred/db";
import { withPlayer } from "@/server/economyHttp";
import { errorJson, requireSameOrigin } from "@/server/http";
import { processStablePhoto, type PhotoProblem } from "@/server/stablePhoto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Friendly wording for a refused upload. */
function uploadMessage(problem: PhotoProblem): string {
  switch (problem) {
    case "too_large":
      return `Upload a PNG, JPEG or WebP image up to ${Math.floor(gc.STABLE_PHOTO_MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`;
    case "not_an_image":
      return "That file isn't an image we can read.";
    case "format":
      return "Upload a PNG, JPEG or WebP image up to 2 MB.";
    case "too_many_pixels":
      return "That image has too many pixels. Upload a smaller picture.";
  }
}

/** Upload a stable photo (multipart form data, one field `photo`). */
export async function POST(req: Request) {
  const sameOrigin = requireSameOrigin(req);
  if (sameOrigin) return sameOrigin;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return errorJson(400, "invalid_body", { message: uploadMessage("format") });
  }
  const file = form.get("photo");
  if (!(file instanceof File)) {
    return errorJson(400, "invalid_body", { message: "Choose an image to upload." });
  }
  // Size first, before any byte is read or decoded.
  if (file.size > gc.STABLE_PHOTO_MAX_UPLOAD_BYTES) {
    return errorJson(413, "too_large", { message: uploadMessage("too_large") });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const out = await processStablePhoto(bytes);
  if (!out.ok) {
    return errorJson(out.problem === "too_large" ? 413 : 400, out.problem, { message: uploadMessage(out.problem) });
  }
  return withPlayer(async (db, session, now) => {
    const { hash } = await saveStablePhoto(db, { accountId: session.accountId, image: out.image, hash: out.hash, now });
    return { photoUrl: gc.stablePhotoUrl(session.stable.id, hash) };
  });
}

/** Remove the stable photo (the silks show again). Counts against the day's change cap. */
export async function DELETE(req: Request) {
  const sameOrigin = requireSameOrigin(req);
  if (sameOrigin) return sameOrigin;
  return withPlayer(async (db, session, now) => {
    await removeStablePhoto(db, { accountId: session.accountId, now });
    return { photoUrl: null };
  });
}