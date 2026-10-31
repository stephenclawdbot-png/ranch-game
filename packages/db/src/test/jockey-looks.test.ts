import { eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { jockeys } from "../schema";
import { createJockeyTx, ensureJockeyLooksTx, getJockey } from "../services/jockeys";
import { T0, memoryDb } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

async function active() {
  const rows = await h.db.select().from(jockeys).where(isNull(jockeys.retiredAt));
  return rows.map((r) => ({ id: r.id, name: r.name, stage: r.stage as gc.JockeyStage, look: gc.parseJockeyLook(r.look)! }));
}

/** Face pool of a jockey: its stage, narrowed to the presentation its name implies. */
const poolOf = (j: { stage: gc.JockeyStage; name: string }) => gc.facePool(j.stage, j.name).map((f) => f.id);

describe("jockey looks", () => {
  it("no two active jockeys share a face while unused faces exist for their stage and presentation", async () => {
    // a crowd of apprentices: more than one pool's worth, so faces must come round again
    for (let i = 0; i < 60; i++) await createJockeyTx(h.db, { seed: gc.seedFrom("looks-a", i), stableId: null, now: T0 });
    // and seasoned riders across the career
    for (let i = 0; i < 40; i++) await createJockeyTx(h.db, { seed: gc.seedFrom("looks-s", i), stableId: null, now: T0, weeksIn: 1 + i });
    const list = await active();
    expect(list.every((j) => j.look && gc.jockeyFace(j.look.face))).toBe(true);
    // whoever wears a face someone else wears too had no unused face left in their pool
    const worn = new Map<string, number>();
    for (const j of list) worn.set(j.look.face, (worn.get(j.look.face) ?? 0) + 1);
    let shared = 0;
    for (const j of list) {
      if ((worn.get(j.look.face) ?? 0) < 2) continue;
      shared++;
      expect(poolOf({ stage: gc.jockeyFace(j.look.face)!.stage, name: j.name }).every((f) => (worn.get(f) ?? 0) > 0)).toBe(true);
    }
    expect(shared).toBeGreaterThan(0); // 60 apprentices outnumber a pool, so faces did come round
    // the face suits the jockey: stage at creation, and the name's presentation when it says one
    for (const j of list) {
      const face = gc.jockeyFace(j.look.face)!;
      const who = gc.presentsAs(j.name);
      if (who) expect(face.presents).toBe(who);
    }
  });

  it("no two active jockeys share the same full look", async () => {
    const list = await active();
    const keys = list.map((j) => gc.jockeyLookKey(j.look));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("a look never changes, and the backfill gives every old jockey one without collisions", async () => {
    const before = await active();
    // jockeys stored before looks existed
    for (let i = 0; i < 6; i++) {
      const j = await createJockeyTx(h.db, { seed: gc.seedFrom("looks-old", i), stableId: null, now: T0 });
      await h.db.update(jockeys).set({ look: null }).where(eq(jockeys.id, j.id));
    }
    expect(await h.db.transaction((tx) => ensureJockeyLooksTx(tx))).toBe(6);
    expect(await h.db.transaction((tx) => ensureJockeyLooksTx(tx))).toBe(0);
    const after = await active();
    for (const b of before) expect(after.find((a) => a.id === b.id)!.look).toEqual(b.look);
    const keys = after.map((j) => gc.jockeyLookKey(j.look));
    expect(new Set(keys).size).toBe(keys.length);
    // the view carries the stored look
    const v = await getJockey(h.db, after[0]!.id);
    expect(v?.look).toEqual(after[0]!.look);
  });

  it("the look column is additive (nullable jsonb)", async () => {
    const r = await h.db.execute(sql`select is_nullable from information_schema.columns where table_name = 'jockeys' and column_name = 'look'`);
    const rows = (Array.isArray(r) ? r : (r as { rows: unknown[] }).rows) as { is_nullable: string }[];
    expect(rows[0]?.is_nullable).toBe("YES");
  });
});
