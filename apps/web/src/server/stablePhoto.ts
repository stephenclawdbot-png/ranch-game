/**
 * Stable photo upload processing (owner decision 2026-10-30).
 *
 * An upload is untrusted data: it is never stored or served as received. Every accepted file is
 * re-encoded into a fresh 256x256 WebP (sharp drops all metadata unless asked to keep it, and we
 * never ask), so no input byte survives — that is what makes an arbitrary upload safe to show
 * on another player's page. Everything before the re-encode is validation only: size before any
 * byte is even read, then the decoded format (never the filename or Content-Type, which the
 * client controls), and a decoded-pixel cap against decompression bombs.
 *
 * The knobs live in game-core stablePhoto.ts; see gc.STABLE_PHOTO_*.
 */
import { createHash } from "node:crypto";
import * as gc from "@thoroughbred/game-core";
import sharp from "sharp";

export type PhotoProblem = "too_large" | "not_an_image" | "format" | "too_many_pixels";

export async function processStablePhoto(
  bytes: Uint8Array,
): Promise<{ ok: true; image: Buffer; hash: string } | { ok: false; problem: PhotoProblem }> {
  if (bytes.length > gc.STABLE_PHOTO_MAX_UPLOAD_BYTES) return { ok: false, problem: "too_large" };

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(bytes, { limitInputPixels: gc.STABLE_PHOTO_MAX_INPUT_PIXELS, failOn: "error" }).metadata();
  } catch (e) {
    // sharp's own limit (width * height over STABLE_PHOTO_MAX_INPUT_PIXELS) vs undecodable bytes.
    const msg = e instanceof Error ? e.message : "";
    if (/pixel limit/i.test(msg)) return { ok: false, problem: "too_many_pixels" };
    return { ok: false, problem: "not_an_image" };
  }
  if (!(metadata.format && (gc.STABLE_PHOTO_FORMATS as readonly string[]).includes(metadata.format))) {
    return { ok: false, problem: "format" };
  }
  // No animated or multi-page input (an animated WebP decodes as webp).
  if ((metadata.pages ?? 1) > 1) return { ok: false, problem: "format" };

  const image = await sharp(bytes, { limitInputPixels: gc.STABLE_PHOTO_MAX_INPUT_PIXELS, failOn: "error" })
    .rotate() // apply EXIF orientation, then drop the EXIF (nothing is kept)
    .resize(gc.STABLE_PHOTO_SIZE, gc.STABLE_PHOTO_SIZE, { fit: "cover", position: "attention" })
    .webp({ quality: 82 })
    .toBuffer();
  return { ok: true, image, hash: createHash("sha256").update(image).digest("hex") };
}