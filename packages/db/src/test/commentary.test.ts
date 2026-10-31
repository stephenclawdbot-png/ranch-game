import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { isDomainError } from "../errors";
import { horses } from "../schema";
import { eq } from "drizzle-orm";
import {
  COMMENTARY_CASTERS,
  COMMENTARY_CLIP_MAX_BYTES,
  COMMENTARY_RECIPE,
  commentaryNameKey,
  getCommentaryClip,
  looksLikeMp3,
  missingCommentaryNames,
  saveCommentaryName,
} from "../services/commentary";
import { T0, makeHorse, memoryDb, newPlayer } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

/** A fake MP3: a frame sync then filler (the service never decodes audio). */
const mp3 = (fill: number, n = 1200) => {
  const b = Buffer.alloc(n, fill);
  b[0] = 0xff;
  b[1] = 0xf3;
  return b;
};
const clips = (fill: number) => ({ calm: mp3(fill), building: mp3(fill + 1), climax: mp3(fill + 2) });

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (isDomainError(e)) return e.code;
    throw e;
  }
  return "accepted";
}

describe("commentary name clips", () => {
  it("normalises name keys and recognises MP3 bytes", () => {
    expect(commentaryNameKey("  Silver   Bramble ")).toBe("silver bramble");
    expect(looksLikeMp3(Buffer.from("ID3\u0004"))).toBe(true);
    expect(looksLikeMp3(mp3(0))).toBe(true);
    expect(looksLikeMp3(Buffer.from("<html>"))).toBe(false);
  });

  it("stores a known horse name per caster and serves each intensity", async () => {
    const p = await newPlayer(h.db);
    await makeHorse(h.db, p.stableId, { name: "Silver Bramble" });
    const r = await saveCommentaryName(h.db, { name: "Silver  Bramble", caster: "bm_george", recipe: COMMENTARY_RECIPE, clips: clips(1) });
    expect(r.key).toBe("silver bramble");
    expect((await getCommentaryClip(h.db, "silver bramble", "bm_george", "building"))!.equals(mp3(2))).toBe(true);
    expect(await getCommentaryClip(h.db, "silver bramble", "bm_lewis", "calm")).toBeNull();
    // Another recipe version is not served.
    expect(await getCommentaryClip(h.db, "silver bramble", "bm_george", "calm", COMMENTARY_RECIPE + 1)).toBeNull();
    // Re-uploading replaces.
    await saveCommentaryName(h.db, { name: "Silver Bramble", caster: "bm_george", recipe: COMMENTARY_RECIPE, clips: clips(7) });
    expect((await getCommentaryClip(h.db, "silver bramble", "bm_george", "calm"))!.equals(mp3(7))).toBe(true);
  });

  it("refuses unknown names, casters, recipes and bad clips", async () => {
    const p = await newPlayer(h.db);
    await makeHorse(h.db, p.stableId, { name: "Quiet Riot" });
    const ok = { name: "Quiet Riot", caster: "bm_lewis", recipe: COMMENTARY_RECIPE, clips: clips(1) };
    expect(await refusal(saveCommentaryName(h.db, { ...ok, name: "Nobody Has This" }))).toBe("NOT_FOUND");
    expect(await refusal(saveCommentaryName(h.db, { ...ok, caster: "af_bella" }))).toBe("INVALID_INPUT");
    expect(await refusal(saveCommentaryName(h.db, { ...ok, recipe: COMMENTARY_RECIPE + 1 }))).toBe("INVALID_INPUT");
    expect(await refusal(saveCommentaryName(h.db, { ...ok, clips: { ...clips(1), climax: mp3(1, COMMENTARY_CLIP_MAX_BYTES + 1) } }))).toBe("INVALID_INPUT");
    expect(await refusal(saveCommentaryName(h.db, { ...ok, clips: { ...clips(1), calm: Buffer.alloc(1200, 0x41) } }))).toBe("INVALID_INPUT");
    expect(await refusal(saveCommentaryName(h.db, { ...ok, clips: { ...clips(1), calm: mp3(1, 50) } }))).toBe("INVALID_INPUT");
    expect(await refusal(saveCommentaryName(h.db, { ...ok, name: "x".repeat(41) }))).toBe("INVALID_INPUT");
    expect(await refusal(saveCommentaryName(h.db, ok))).toBe("accepted");
  });

  it("lists names still missing clips, with the casters missing, and skips retired horses that no longer race", async () => {
    const p = await newPlayer(h.db);
    await makeHorse(h.db, p.stableId, { name: "Golden Mile" });
    const retired = await makeHorse(h.db, p.stableId, { name: "Long Gone" });
    await h.db.update(horses).set({ careerStatus: "retired", retirementReason: "choice", retiredAt: T0 }).where(eq(horses.id, retired.id));
    await saveCommentaryName(h.db, { name: "Golden Mile", caster: "bm_daniel", recipe: COMMENTARY_RECIPE, clips: clips(3) });
    const missing = await missingCommentaryNames(h.db, { limit: 500, now: T0 });
    const golden = missing.find((m) => m.key === "golden mile");
    expect(golden?.casters).toEqual(["bm_george", "bm_lewis"]);
    expect(missing.some((m) => m.key === "long gone")).toBe(false);
    // Fully voiced names drop off the list.
    for (const caster of ["bm_george", "bm_lewis"]) await saveCommentaryName(h.db, { name: "Golden Mile", caster, recipe: COMMENTARY_RECIPE, clips: clips(3) });
    expect((await missingCommentaryNames(h.db, { limit: 500, now: T0 })).some((m) => m.key === "golden mile")).toBe(false);
    for (const m of missing) for (const c of m.casters) expect(COMMENTARY_CASTERS).toContain(c);
    expect((await missingCommentaryNames(h.db, { limit: 1, now: T0 })).length).toBeLessThanOrEqual(1);
  });
});
