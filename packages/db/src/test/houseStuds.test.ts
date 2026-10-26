import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { RULES } from "../rules";
import { horses, ledgerAccounts } from "../schema";
import { breed } from "../services/breeding";
import { listStuds, previewPairing } from "../services/economyViews";
import { ensureHouseStuds, HOUSE_STUD_COUNT, houseStudSpec } from "../services/houseStuds";
import { getBalance, ledgerHealth } from "../services/ledger";
import { at, DAY, makeHorse, memoryDb, newPlayer, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const retired = { careerStatus: "retired" as const, retirementReason: "choice" as const, retiredAt: T0 };

async function treasury(): Promise<number> {
  const [row] = await h.db.select({ b: ledgerAccounts.balance }).from(ledgerAccounts).where(and(eq(ledgerAccounts.kind, "treasury"), isNull(ledgerAccounts.ownerAccountId)));
  return Number(row?.b ?? 0);
}

describe("Club house stallions at stud", () => {
  it("are deterministic and modest", () => {
    const a = houseStudSpec(0, 1);
    const b = houseStudSpec(0, 1);
    expect(a.spec.genome).toEqual(b.spec.genome);
    expect(a.spec.name).toBe(b.spec.name);
    expect(a.spec.sex).toBe("male");
    expect(["common", "uncommon", "rare"]).toContain(houseStudSpec(2, 1).rarity);
  });

  it("stand at stud idempotently, appear in the stud book, and breed with fees to the Club treasury", async () => {
    const first = await ensureHouseStuds(h.db, T0);
    expect(first.created).toBe(HOUSE_STUD_COUNT);
    const again = await Promise.all([ensureHouseStuds(h.db, T0), ensureHouseStuds(h.db, T0)]);
    expect(again.every((r) => r.created === 0)).toBe(true);

    const studs = (await listStuds(h.db)).filter((s) => s.club);
    expect(studs).toHaveLength(HOUSE_STUD_COUNT);
    expect(studs.every((s) => s.stableName === "The Club" && s.horse.careerStatus === "retired" && s.horse.studFee! > 0)).toBe(true);

    const p = await newPlayer(h.db, { credits: 100_000 });
    await h.db.execute(`update stables set stall_slots = 24 where id = '${p.stableId}'`);
    const mare = await makeHorse(h.db, p.stableId, { sex: "female", ...retired });
    const stud = studs[0]!.horse;
    const preview = await previewPairing(h.db, { accountId: p.accountId, sireId: stud.id, damId: mare.id, now: T0 });
    expect(preview.block).toBeNull();
    const t0 = await treasury();
    const c0 = await getBalance(h.db, p.accountId);
    await breed(h.db, { accountId: p.accountId, sireId: stud.id, damId: mare.id, now: T0, idempotencyKey: `house:${mare.id}` });
    const fee = stud.studFee!;
    const burn = Math.floor((fee * 100) / 1000);
    expect(await getBalance(h.db, p.accountId)).toBe(c0 - fee - RULES.breedingBaseFee);
    expect(await treasury()).toBe(t0 + fee - burn);
    expect((await ledgerHealth(h.db)).totalPostings).toBe(0);
  });

  it("an exhausted stallion goes to the Legacy Farm and the next serial takes his box", async () => {
    const [stud] = (await listStuds(h.db)).filter((s) => s.club);
    await h.db.update(horses).set({ breedingCount: RULES.breedingLifetimeLimit }).where(eq(horses.id, stud!.horse.id));
    const r = await ensureHouseStuds(h.db, at(DAY));
    expect(r).toEqual({ created: 1, retired: 1 });
    const studs = (await listStuds(h.db)).filter((s) => s.club);
    expect(studs).toHaveLength(HOUSE_STUD_COUNT);
    expect(studs.some((s) => s.horse.id === stud!.horse.id)).toBe(false);
  });
});
