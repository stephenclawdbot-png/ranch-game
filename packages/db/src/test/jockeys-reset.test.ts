import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { jockeys } from "../schema";
import { createJockeyTx } from "../services/jockeys";
import { T0, memoryDb } from "./helpers";

// Migration 0035 (owner, 2026-11-01): every active jockey back to grade E, records kept.
const RESET = readFileSync(join(__dirname, "../../migrations/0035_jockeys_reset_to_e.sql"), "utf8");

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const all = (v: number) => ({ gate: v, pace: v, finish: v, handling: v });

describe("the grade-E reset", () => {
  it("drops every active jockey into the starting range, keeps lower skills, potential and records, and leaves the retired alone", async () => {
    const rows: Awaited<ReturnType<typeof createJockeyTx>>[] = [];
    for (let i = 0; i < 12; i++) rows.push(await createJockeyTx(h.db, { seed: gc.seedFrom("reset", i), stableId: null, now: T0, startingPool: true }));
    // grades A..C, one already low, one retired A
    const set = [800, 650, 500, 200, 820];
    for (let i = 0; i < set.length; i++) await h.db.update(jockeys).set({ skills: all(set[i]!), potential: all(900), rides: 100 + i, wins: 10 + i }).where(eq(jockeys.id, rows[i]!.id));
    await h.db.update(jockeys).set({ retiredAt: T0 }).where(eq(jockeys.id, rows[4]!.id));
    await h.db.execute(sql.raw(RESET));
    const after = await h.db.select().from(jockeys);
    for (const j of after) {
      const s = j.skills as Record<string, number>;
      if (j.id === rows[4]!.id) {
        expect(s).toEqual(all(820));
        continue;
      }
      expect(gc.jockeyGrade(s as never)).toBe("E");
      for (const k of gc.JOCKEY_SKILLS) {
        expect(s[k]).toBeGreaterThanOrEqual(120);
        expect(s[k]).toBeLessThanOrEqual(gc.JOCKEY_START_SKILL_MAX);
      }
    }
    const low = after.find((j) => j.id === rows[3]!.id)!;
    for (const k of gc.JOCKEY_SKILLS) expect((low.skills as Record<string, number>)[k]).toBeLessThanOrEqual(200);
    const a = after.find((j) => j.id === rows[0]!.id)!;
    expect(a.potential).toEqual(all(900));
    expect([a.rides, a.wins]).toEqual([100, 10]);
    // each skill its own value, not one flat number
    expect(new Set(Object.values(a.skills as Record<string, number>)).size).toBeGreaterThan(1);
    // running it again changes nothing
    const snap = JSON.stringify(after.map((j) => [j.id, j.skills]).sort());
    await h.db.execute(sql.raw(RESET));
    const again = await h.db.select().from(jockeys);
    expect(JSON.stringify(again.map((j) => [j.id, j.skills]).sort())).toBe(snap);
  });
});
