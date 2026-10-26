import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { hallOfFame, horses } from "../schema";
import { createAccount } from "../services/accounts";
import { renameHorse } from "../services/horses";
import { checkHorseName, claimSystemName } from "../services/naming";
import { runTx } from "../services/tx";
import { getHorseRow, makeHorse, memoryDb, newPlayer, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const silks = { primary: "#112233", secondary: "#445566", pattern: "solid", cap: "#778899" };

describe("registration numbers", () => {
  it("every horse gets a unique, increasing reg_no from the column default", async () => {
    const p = await newPlayer(h.db);
    const a = await makeHorse(h.db, p.stableId);
    const b = await makeHorse(h.db, p.stableId);
    expect(a.regNo).toBeGreaterThan(0);
    expect(b.regNo).toBeGreaterThan(a.regNo);
    // Code that predates the column (a raw insert without reg_no) still gets one.
    await h.db.execute(sql`insert into horses (owner_stable_id, name, sex, origin, genome, appearance, stats, stage)
      values (${p.stableId}, 'Raw Insert', 'male', 'admin', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'foal')`);
    const [raw] = await h.db.select().from(horses).where(eq(horses.name, "Raw Insert"));
    expect(raw!.regNo).toBeGreaterThan(b.regNo);
    expect(gc.registrationNumber(a.generation, a.regNo)).toMatch(/^G0-\d{5,}$/);
    // Unique at the database level.
    await expect(h.db.update(horses).set({ regNo: a.regNo }).where(eq(horses.id, b.id))).rejects.toThrow();
  });

  it("starter stables get distinct registration numbers and distinct names", async () => {
    const regs = new Set<number>();
    const names = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const acc = await createAccount(h.db, { stableName: `Reg ${i}`, silks, starterHorses: 3, now: T0 });
      for (const id of acc.horseIds) {
        const row = await getHorseRow(h.db, id);
        regs.add(row.regNo);
        names.add(gc.nameKey(row.name));
      }
    }
    // 18 starters drawn from a 12-name list: collisions are re-rolled, never duplicated.
    expect(regs.size).toBe(18);
    expect(names.size).toBe(18);
  });
});

describe("unique horse names", () => {
  it("rejects a taken name case-insensitively, with a friendly message", async () => {
    const p = await newPlayer(h.db);
    await makeHorse(h.db, p.stableId, { name: "Velvet Thunder" });
    const foal = await makeHorse(h.db, p.stableId, { name: "Little One" });
    await expect(renameHorse(h.db, { accountId: p.accountId, horseId: foal.id, name: "  velvet   THUNDER " })).rejects.toMatchObject({
      code: "NAME_TAKEN",
      message: expect.stringContaining("already a horse called"),
    });
    expect(await checkHorseName(h.db, "VELVET thunder")).toMatchObject({ ok: false, problem: "TAKEN" });
    // Renaming to your own name in a different case is fine.
    await expect(renameHorse(h.db, { accountId: p.accountId, horseId: foal.id, name: "LITTLE ONE" })).resolves.toBe("LITTLE ONE");
  });

  it("validates format and profanity (2-18 characters)", async () => {
    const p = await newPlayer(h.db);
    const foal = await makeHorse(h.db, p.stableId);
    await expect(renameHorse(h.db, { accountId: p.accountId, horseId: foal.id, name: "X" })).rejects.toMatchObject({ code: "INVALID_INPUT", details: { problem: "TOO_SHORT" } });
    await expect(renameHorse(h.db, { accountId: p.accountId, horseId: foal.id, name: "A Very Long Racing Name" })).rejects.toMatchObject({ details: { problem: "TOO_LONG" } });
    await expect(renameHorse(h.db, { accountId: p.accountId, horseId: foal.id, name: "Shit Happens" })).rejects.toMatchObject({ details: { problem: "PROFANE" } });
    await expect(renameHorse(h.db, { accountId: p.accountId, horseId: foal.id, name: "Seabiscuit" })).resolves.toBe("Seabiscuit");
  });

  it("frees a name when its horse becomes a Legacy Farm Legend, except Hall of Fame names", async () => {
    const p = await newPlayer(h.db);
    const legend = await makeHorse(h.db, p.stableId, { name: "Old Timer" });
    const famous = await makeHorse(h.db, p.stableId, { name: "Golden Era" });
    const foal = await makeHorse(h.db, p.stableId);
    expect(await checkHorseName(h.db, "Old Timer")).toMatchObject({ ok: false });
    for (const x of [legend, famous]) {
      await h.db
        .update(horses)
        .set({ careerStatus: "retired", retirementReason: "choice", retiredAt: T0 })
        .where(eq(horses.id, x.id));
      await h.db.update(horses).set({ careerStatus: "pasture", pasturedAt: T0 }).where(eq(horses.id, x.id));
    }
    await h.db.insert(hallOfFame).values({ entryKey: `test:${famous.id}`, category: "champion", title: "Champion", horseId: famous.id });
    expect(await checkHorseName(h.db, "old timer")).toMatchObject({ ok: true, name: "old timer" });
    expect(await checkHorseName(h.db, "Golden Era")).toMatchObject({ ok: false, problem: "RETIRED" });
    await expect(renameHorse(h.db, { accountId: p.accountId, horseId: foal.id, name: "Golden Era" })).rejects.toMatchObject({ code: "NAME_TAKEN", message: expect.stringContaining("Hall of Fame") });
    await expect(renameHorse(h.db, { accountId: p.accountId, horseId: foal.id, name: "Old Timer" })).resolves.toBe("Old Timer");
  });

  it("concurrent claims of one name: exactly one wins", async () => {
    const p = await newPlayer(h.db);
    const a = await makeHorse(h.db, p.stableId);
    const b = await makeHorse(h.db, p.stableId);
    const res = await Promise.allSettled([
      renameHorse(h.db, { accountId: p.accountId, horseId: a.id, name: "Photo Finish" }),
      renameHorse(h.db, { accountId: p.accountId, horseId: b.id, name: "photo finish" }),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(res.filter((r) => r.status === "rejected" && (r.reason as { code?: string }).code === "NAME_TAKEN")).toHaveLength(1);
  });

  it("system names pick a free alternative instead of failing", async () => {
    const p = await newPlayer(h.db);
    const first = await makeHorse(h.db, p.stableId, { name: "Silver Lark" });
    const second = await makeHorse(h.db, p.stableId, { name: "Silver Lark" });
    expect(first.name).toBe("Silver Lark");
    expect(gc.nameKey(second.name)).not.toBe("silver lark");
    expect(gc.validateHorseName(second.name).ok).toBe(true);
    const picked = await runTx(h.db, (tx) => claimSystemName(tx, "Silver Lark", "seed"));
    expect(gc.nameKey(picked)).not.toBe("silver lark");
  });
});

describe("migration 0006 backfill", () => {
  it("numbers existing horses in creation order and continues the sequence", async () => {
    const { createDb } = await import("../client");
    const { migrate } = await import("../migrate");
    const { MIGRATIONS } = await import("../migrations.generated");
    const old = await createDb({ url: null, pglite: "memory", migrate: false });
    try {
      await migrate(old.db, MIGRATIONS.filter((m) => m.tag < "0006"));
      for (const [name, t] of [["Third", "2026-01-03"], ["First", "2026-01-01"], ["Second", "2026-01-02"]] as const) {
        await old.db.execute(sql`insert into horses (name, sex, origin, genome, appearance, stats, stage, created_at)
          values (${name}, 'male', 'house', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'prime', ${t}::timestamptz)`);
      }
      const res = await migrate(old.db);
      expect(res.applied).toContain("0006_horse_registry");
      const rows = (await old.db.execute(sql`select name, reg_no from horses order by reg_no`)) as unknown as { rows: { name: string; reg_no: number }[] };
      expect(rows.rows.map((r) => [r.name, r.reg_no])).toEqual([["First", 1], ["Second", 2], ["Third", 3]]);
      await old.db.execute(sql`insert into horses (name, sex, origin, genome, appearance, stats, stage) values ('Fourth', 'male', 'house', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'prime')`);
      const four = (await old.db.execute(sql`select reg_no from horses where name = 'Fourth'`)) as unknown as { rows: { reg_no: number }[] };
      expect(four.rows[0]!.reg_no).toBe(4);
    } finally {
      await old.close();
    }
  });
});
