/**
 * Stable photos (owner decision 2026-10-30): the stored 256x256 WebP a stable shows next to its
 * name, plus the daily change counter.
 *
 * The service never sees untrusted bytes: the web layer re-encodes every upload first
 * (apps/web/src/server/stablePhoto.ts — a fresh WebP with no input byte surviving) and passes
 * the image and its sha256 in. All it does is store them, keep `stables.photo_hash` in step
 * (null = no photo, the silks show) and rate-limit changes: 5 per UTC day, removals included
 * (game-core STABLE_PHOTO_UPLOADS_PER_DAY). The counter row survives a removal, so deleting the
 * photo cannot reset the limit.
 *
 * Lock order (as everywhere): the stable row, then its stable_photos row. Both writers act only
 * on the caller's own stable, taken from the account id, so no other account can touch it.
 */
import { eq, inArray } from "drizzle-orm";
import { utcDay } from "../crypto";
import { DomainError } from "../errors";
import { gc } from "../gameCore";
import { stables, stablePhotos } from "../schema";
import type { Db, Executor } from "../types";
import { lockStableOf } from "./accounts";
import { audit, runTx } from "./tx";

/**
 * Locks the stable's counter row and returns today's count, rolled over to the current UTC day.
 * Refuses the change once the day's cap (game-core STABLE_PHOTO_UPLOADS_PER_DAY) is spent.
 */
async function chargeUpload(tx: Executor, stableId: string, now: Date): Promise<number> {
  const day = utcDay(now);
  const [row] = await tx.select().from(stablePhotos).where(eq(stablePhotos.stableId, stableId)).for("update");
  const today = row && row.uploadsDay === day ? row.uploadsToday : 0;
  if (today >= gc.STABLE_PHOTO_UPLOADS_PER_DAY) {
    throw new DomainError("RATE_LIMITED", `You can change your stable photo ${gc.STABLE_PHOTO_UPLOADS_PER_DAY} times a day.`);
  }
  return today + 1;
}

/** Stores a re-encoded photo as the stable's own and points stables.photo_hash at it. */
export async function saveStablePhoto(
  db: Db,
  input: { accountId: string; image: Buffer; hash: string; now: Date },
): Promise<{ hash: string }> {
  return runTx(db, async (tx) => {
    const stable = await lockStableOf(tx, input.accountId);
    const uploadsToday = await chargeUpload(tx, stable.id, input.now);
    const day = utcDay(input.now);
    await tx
      .insert(stablePhotos)
      .values({
        stableId: stable.id,
        image: input.image,
        hash: input.hash,
        bytes: input.image.length,
        updatedAt: input.now,
        uploadsDay: day,
        uploadsToday,
      })
      .onConflictDoUpdate({
        target: stablePhotos.stableId,
        set: {
          image: input.image,
          hash: input.hash,
          bytes: input.image.length,
          updatedAt: input.now,
          uploadsDay: day,
          uploadsToday,
        },
      });
    await tx.update(stables).set({ photoHash: input.hash }).where(eq(stables.id, stable.id));
    await audit(tx, {
      actor: input.accountId,
      action: "stable_photo.save",
      entityType: "stable",
      entityId: stable.id,
      data: { hash: input.hash, bytes: input.image.length },
    });
    return { hash: input.hash };
  });
}

/** Current photo hashes of these stables (stables without a photo are left out). */
export async function stablePhotoHashes(ex: Executor, stableIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(stableIds)];
  if (!ids.length) return new Map();
  const rows = await ex.select({ id: stables.id, hash: stables.photoHash }).from(stables).where(inArray(stables.id, ids));
  return new Map(rows.filter((r) => r.hash).map((r) => [r.id, r.hash!]));
}

/** Clears the stable's photo (silks show again). Removal counts against the day's cap. */
export async function removeStablePhoto(db: Db, input: { accountId: string; now: Date }): Promise<void> {
  await runTx(db, async (tx) => {
    const stable = await lockStableOf(tx, input.accountId);
    const uploadsToday = await chargeUpload(tx, stable.id, input.now);
    const day = utcDay(input.now);
    // The image bytes go; the counter row stays so the rate limit survives a removal.
    await tx
      .insert(stablePhotos)
      .values({
        stableId: stable.id,
        image: Buffer.alloc(0),
        hash: "",
        bytes: 0,
        updatedAt: input.now,
        uploadsDay: day,
        uploadsToday,
      })
      .onConflictDoUpdate({
        target: stablePhotos.stableId,
        set: { image: Buffer.alloc(0), hash: "", bytes: 0, updatedAt: input.now, uploadsDay: day, uploadsToday },
      });
    await tx.update(stables).set({ photoHash: null }).where(eq(stables.id, stable.id));
    await audit(tx, { actor: input.accountId, action: "stable_photo.remove", entityType: "stable", entityId: stable.id });
  });
}

/** The stored photo of any stable (public GET), or null when it has none set. */
export async function getStablePhoto(ex: Executor, stableId: string): Promise<{ image: Buffer; hash: string } | null> {
  const [row] = await ex.select().from(stablePhotos).where(eq(stablePhotos.stableId, stableId));
  if (!row || row.bytes === 0) return null;
  return { image: row.image, hash: row.hash };
}