/**
 * Stable photos (owner decision 2026-10-30): a player may upload a small image as their stable
 * photo; it shows next to their stable name where the silks show today. No human moderation, so
 * the web layer re-encodes every upload into a fresh 256×256 WebP before it is stored: no input
 * byte survives, which is what makes an arbitrary upload safe. The knobs below bound what is
 * accepted on the way in (upload size, decoded pixels, formats, changes per day); the stored
 * size and the URL shape live here too, so the client, the API and the wiki agree.
 */

/** Largest upload accepted, bytes (checked before any bytes are read or decoded). */
export const STABLE_PHOTO_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Decoded pixel limit (width × height) to stop decompression bombs. */
export const STABLE_PHOTO_MAX_INPUT_PIXELS = 24_000_000;

/** Stored size: square, this many pixels a side, WebP. */
export const STABLE_PHOTO_SIZE = 256;

/** Uploads (or removals) per stable per UTC day. */
export const STABLE_PHOTO_UPLOADS_PER_DAY = 5;

/** Input formats accepted, as sharp reports them from the decoded bytes. */
export const STABLE_PHOTO_FORMATS = ["png", "jpeg", "webp"] as const;

/**
 * The URL of a stable's stored photo, or null when it has none (the silks show instead). `hash`
 * is the sha256 of the stored image, used as the `v` cache-buster: a new photo is a new URL,
 * so caches can be immutable.
 */
export function stablePhotoUrl(stableId: string, hash: string | null): string | null {
  if (hash === null) return null;
  return `/api/stables/${stableId}/photo?v=${hash}`;
}