import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { isDomainError } from "../errors";
import { stables } from "../schema";
import { getStablePhoto, removeStablePhoto, saveStablePhoto, stablePhotoHashes } from "../services/stablePhoto";
import { DAY, T0, at, memoryDb, newPlayer } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

async function photoHashOf(stableId: string): Promise<string | null> {
  const [s] = await h.db.select({ photoHash: stables.photoHash }).from(stables).where(eq(stables.id, stableId));
  return s?.photoHash ?? null;
}

/** A trivially valid stored image: the service only stores bytes, it never decodes them. */
const image = (byte: number, n = 8) => Buffer.alloc(n, byte);
const hashOf = (buf: Buffer) => `sha-${buf.toString("hex").slice(0, 12)}`;

describe("stable photo storage", () => {
  it("save stores the bytes and sets photo_hash; replace changes the hash", async () => {
    const p = await newPlayer(h.db);
    expect(await photoHashOf(p.stableId)).toBeNull();

    const first = image(1);
    const { hash } = await saveStablePhoto(h.db, { accountId: p.accountId, image: first, hash: hashOf(first), now: T0 });
    expect(hash).toBe(hashOf(first));
    expect(await photoHashOf(p.stableId)).toBe(hashOf(first));
    const stored = await getStablePhoto(h.db, p.stableId);
    expect(stored && Buffer.from(stored.image).equals(first)).toBe(true);

    const second = image(2);
    await saveStablePhoto(h.db, { accountId: p.accountId, image: second, hash: hashOf(second), now: T0 });
    expect(await photoHashOf(p.stableId)).toBe(hashOf(second));
    expect((await getStablePhoto(h.db, p.stableId))?.hash).toBe(hashOf(second));
  });

  it("remove clears the photo and the stored bytes", async () => {
    const p = await newPlayer(h.db);
    const buf = image(3);
    await saveStablePhoto(h.db, { accountId: p.accountId, image: buf, hash: hashOf(buf), now: T0 });
    await removeStablePhoto(h.db, { accountId: p.accountId, now: T0 });
    expect(await photoHashOf(p.stableId)).toBeNull();
    expect(await getStablePhoto(h.db, p.stableId)).toBeNull();
  });

  it("refuses the 6th change of a UTC day and resets the count the next day", async () => {
    const p = await newPlayer(h.db);
    const buf = image(4);
    for (let i = 0; i < 5; i++) {
      await saveStablePhoto(h.db, { accountId: p.accountId, image: buf, hash: `${hashOf(buf)}-${i}`, now: at(i * 1000) });
    }
    await expect(saveStablePhoto(h.db, { accountId: p.accountId, image: buf, hash: "too-much", now: at(10_000) })).rejects.toSatisfy(
      (e: unknown) => isDomainError(e, "RATE_LIMITED"),
    );
    await expect(removeStablePhoto(h.db, { accountId: p.accountId, now: at(10_000) })).rejects.toSatisfy(
      (e: unknown) => isDomainError(e, "RATE_LIMITED"),
    );

    // A new UTC day: the counter starts over.
    const fresh = image(5);
    await saveStablePhoto(h.db, { accountId: p.accountId, image: fresh, hash: hashOf(fresh), now: at(DAY) });
    expect(await photoHashOf(p.stableId)).toBe(hashOf(fresh));
  });

  it("a removal counts against the day's cap (the counter survives it)", async () => {
    const p = await newPlayer(h.db);
    const buf = image(6);
    for (let i = 0; i < 4; i++) {
      await saveStablePhoto(h.db, { accountId: p.accountId, image: buf, hash: `${hashOf(buf)}-${i}`, now: T0 });
    }
    await removeStablePhoto(h.db, { accountId: p.accountId, now: T0 });
    await expect(saveStablePhoto(h.db, { accountId: p.accountId, image: buf, hash: "over", now: T0 })).rejects.toSatisfy(
      (e: unknown) => isDomainError(e, "RATE_LIMITED"),
    );
  });

  it("another account can't change this stable's photo (it only ever acts on its own)", async () => {
    const p = await newPlayer(h.db);
    const other = await newPlayer(h.db);
    const buf = image(7);
    await saveStablePhoto(h.db, { accountId: p.accountId, image: buf, hash: hashOf(buf), now: T0 });

    // The other player's save/remove only ever touches their own stable.
    const theirs = image(8);
    await saveStablePhoto(h.db, { accountId: other.accountId, image: theirs, hash: hashOf(theirs), now: T0 });
    await removeStablePhoto(h.db, { accountId: other.accountId, now: T0 });
    expect(await photoHashOf(p.stableId)).toBe(hashOf(buf));
    expect(await photoHashOf(other.stableId)).toBeNull();
  });

  it("stablePhotoHashes returns current hashes for stables with a photo (racecards read it once per field)", async () => {
    const a = await newPlayer(h.db);
    const b = await newPlayer(h.db);
    await saveStablePhoto(h.db, { accountId: a.accountId, image: Buffer.from([1, 2, 3]), hash: "f".repeat(64), now: T0 });
    const m = await stablePhotoHashes(h.db, [a.stableId, b.stableId, a.stableId]);
    expect([...m.entries()]).toEqual([[a.stableId, "f".repeat(64)]]);
    expect((await stablePhotoHashes(h.db, [])).size).toBe(0);
  });
});
