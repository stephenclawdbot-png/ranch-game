import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { isDomainError } from "../errors";
import { RULES, seasonNumberAt } from "../rules";
import { breedingEvents, horses, lineageEdges } from "../schema";
import { breed, estimateCoiBp, foal } from "../services/breeding";
import { setStudFee } from "../services/horses";
import { getBalance, ledgerHealth } from "../services/ledger";
import { at, count, DAY, expectDbError, getHorseRow, makeHorse, memoryDb, newPlayer, settledAll, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const retired = { careerStatus: "retired" as const, retirementReason: "choice" as const, retiredAt: T0 };
const SEASON = RULES.seasonMs;

async function stable(slots = 24) {
  const p = await newPlayer(h.db, { credits: 100_000 });
  await h.db.execute(`update stables set stall_slots = ${slots} where id = '${p.stableId}'`);
  return p;
}

describe("breeding", () => {
  it("lifetime limit of 4 is never bypassed, across seasons", async () => {
    const p = await stable();
    const stallion = await makeHorse(h.db, p.stableId, { sex: "male", ...retired });
    for (let i = 0; i < 5; i++) {
      const mare = await makeHorse(h.db, p.stableId, { sex: "female", ...retired });
      const attempt = breed(h.db, { accountId: p.accountId, sireId: stallion.id, damId: mare.id, now: at(i * SEASON), idempotencyKey: `life:${mare.id}` });
      if (i < 4) await attempt;
      else await expect(attempt).rejects.toMatchObject({ code: "BREEDING_LIMIT" });
    }
    expect((await getHorseRow(h.db, stallion.id)).breedingCount).toBe(4);
    // The database refuses a fifth even when the service is bypassed.
    await expectDbError(h.db.update(horses).set({ breedingCount: 5 }).where(eq(horses.id, stallion.id)), /horses_breeding_count/);
  });

  it("limits hold under concurrent attempts (stallion with 1 breeding left, 6 mares at once)", async () => {
    const p = await stable();
    const stallion = await makeHorse(h.db, p.stableId, { sex: "male", ...retired, breedingCount: 3 });
    const mares = await Promise.all(Array.from({ length: 6 }, () => makeHorse(h.db, p.stableId, { sex: "female", ...retired })));
    const res = await settledAll(
      mares.map((m) => breed(h.db, { accountId: p.accountId, sireId: stallion.id, damId: m.id, now: T0, idempotencyKey: `conc:${m.id}` })),
    );
    expect(res.ok).toHaveLength(1);
    expect(res.errors.every((e) => isDomainError(e, "BREEDING_LIMIT"))).toBe(true);
    expect((await getHorseRow(h.db, stallion.id)).breedingCount).toBe(4);
    expect(await count(h.db, "breeding_events", `sire_id = '${stallion.id}'`)).toBe(1);
  });

  it("a mare is covered once per season and carries one foal at a time, even concurrently", async () => {
    const p = await stable();
    const mare = await makeHorse(h.db, p.stableId, { sex: "female", ...retired });
    const stallions = await Promise.all(Array.from({ length: 4 }, () => makeHorse(h.db, p.stableId, { sex: "male", ...retired })));
    const res = await settledAll(
      stallions.map((s) => breed(h.db, { accountId: p.accountId, sireId: s.id, damId: mare.id, now: T0, idempotencyKey: `mare:${s.id}` })),
    );
    expect(res.ok).toHaveLength(1);
    expect(res.errors.every((e) => isDomainError(e, "HORSE_IN_FOAL") || isDomainError(e, "BREEDING_SEASON_LIMIT"))).toBe(true);
    // After foaling, still once per season ...
    await foal(h.db, { pregnancyId: res.ok[0]!.pregnancyId, now: at(DAY) });
    await expect(
      breed(h.db, { accountId: p.accountId, sireId: stallions[1]!.id, damId: mare.id, now: at(2 * DAY), idempotencyKey: `mare2:${mare.id}` }),
    ).rejects.toMatchObject({ code: "BREEDING_SEASON_LIMIT" });
    // ... and the unique index backs it.
    await expectDbError(
      h.db.insert(breedingEvents).values({ sireId: stallions[2]!.id, damId: mare.id, requestedBy: p.accountId, seasonNumber: seasonNumberAt(T0), idempotencyKey: `raw:${mare.id}` }),
      /breeding_events_dam_season_uq/,
    );
    // Next season she can be covered again.
    await expect(
      breed(h.db, { accountId: p.accountId, sireId: stallions[1]!.id, damId: mare.id, now: at(SEASON + DAY), idempotencyKey: `mare3:${mare.id}` }),
    ).resolves.toMatchObject({ duplicate: false });
  });

  it("stallions cover at most 4 per season", async () => {
    const p = await stable();
    const stallion = await makeHorse(h.db, p.stableId, { sex: "male", ...retired });
    // The season book (4) equals the lifetime total (4): both caps hold together.
    const mares = await Promise.all(Array.from({ length: 5 }, () => makeHorse(h.db, p.stableId, { sex: "female", ...retired })));
    const res = await settledAll(mares.map((m) => breed(h.db, { accountId: p.accountId, sireId: stallion.id, damId: m.id, now: T0, idempotencyKey: `book:${m.id}` })));
    expect(res.ok).toHaveLength(4);
  });

  it("no self, parent/child or full-sibling breeding", async () => {
    const p = await stable();
    const sire = await makeHorse(h.db, p.stableId, { sex: "male", ...retired });
    const dam = await makeHorse(h.db, p.stableId, { sex: "female", ...retired });
    await expect(breed(h.db, { accountId: p.accountId, sireId: sire.id, damId: sire.id, now: T0, idempotencyKey: `self:${sire.id}` })).rejects.toMatchObject({
      code: "SELF_BREEDING",
    });
    const { pregnancyId } = await breed(h.db, { accountId: p.accountId, sireId: sire.id, damId: dam.id, now: T0, idempotencyKey: `kin1:${dam.id}` });
    const { foalId: daughterId } = await foal(h.db, { pregnancyId, now: at(DAY) });
    // Second foal of the same parents next season: a full sibling.
    const { pregnancyId: p2 } = await breed(h.db, { accountId: p.accountId, sireId: sire.id, damId: dam.id, now: at(SEASON), idempotencyKey: `kin2:${dam.id}` });
    const { foalId: sonId } = await foal(h.db, { pregnancyId: p2, now: at(SEASON + DAY) });
    // Make the foals breeding-eligible (racing retired) and sexes right.
    await h.db.update(horses).set({ sex: "female", ...retired }).where(eq(horses.id, daughterId));
    await h.db.update(horses).set({ sex: "male", ...retired }).where(eq(horses.id, sonId));

    await expect(
      breed(h.db, { accountId: p.accountId, sireId: sire.id, damId: daughterId, now: at(2 * SEASON), idempotencyKey: `pc:${daughterId}` }),
    ).rejects.toMatchObject({ code: "KIN_BREEDING" });
    await expect(
      breed(h.db, { accountId: p.accountId, sireId: sonId, damId: dam.id, now: at(2 * SEASON), idempotencyKey: `cp:${sonId}` }),
    ).rejects.toMatchObject({ code: "KIN_BREEDING" });
    await expect(
      breed(h.db, { accountId: p.accountId, sireId: sonId, damId: daughterId, now: at(2 * SEASON), idempotencyKey: `sib:${sonId}` }),
    ).rejects.toMatchObject({ code: "KIN_BREEDING" });

    // Pedigree closure and COI: full-sib mating would be 25%.
    expect(await estimateCoiBp(h.db, sonId, daughterId)).toBe(2500);
    const edges = await h.db.select().from(lineageEdges).where(eq(lineageEdges.descendantId, sonId));
    expect(edges.map((e) => e.ancestorId).sort()).toEqual([sire.id, dam.id].sort());
  });

  it("racing horses breed only from 25 starts; retired horses always (while breedings remain); Legacy Farm never", async () => {
    const p = await stable();
    const young = await makeHorse(h.db, p.stableId, { sex: "male", starts: 24 });
    const mare = await makeHorse(h.db, p.stableId, { sex: "female", ...retired });
    await expect(breed(h.db, { accountId: p.accountId, sireId: young.id, damId: mare.id, now: T0, idempotencyKey: `y:${young.id}` })).rejects.toMatchObject({
      code: "BREEDING_NOT_ELIGIBLE",
    });
    await h.db.update(horses).set({ starts: 25 }).where(eq(horses.id, young.id));
    await expect(breed(h.db, { accountId: p.accountId, sireId: young.id, damId: mare.id, now: T0, idempotencyKey: `y2:${young.id}` })).resolves.toBeDefined();

    const legend = await makeHorse(h.db, p.stableId, { sex: "male", ...retired, pasturedAt: T0, careerStatus: "pasture" });
    const mare2 = await makeHorse(h.db, p.stableId, { sex: "female", ...retired });
    await expect(breed(h.db, { accountId: p.accountId, sireId: legend.id, damId: mare2.id, now: T0, idempotencyKey: `l:${legend.id}` })).rejects.toMatchObject({
      code: "BREEDING_NOT_ELIGIBLE",
    });
  });

  it("stud fees: 90% to the stallion's owner, 10% burned, plus the base fee burned; idempotent", async () => {
    const owner = await stable();
    const client = await stable();
    const stud = await makeHorse(h.db, owner.stableId, { sex: "male", ...retired });
    const mare = await makeHorse(h.db, client.stableId, { sex: "female", ...retired });
    await expect(breed(h.db, { accountId: client.accountId, sireId: stud.id, damId: mare.id, now: T0, idempotencyKey: "nostud" })).rejects.toMatchObject({
      code: "NOT_OWNER",
    });
    await setStudFee(h.db, { accountId: owner.accountId, horseId: stud.id, fee: 1_000 });
    const before = { o: await getBalance(h.db, owner.accountId), c: await getBalance(h.db, client.accountId) };
    const r1 = await breed(h.db, { accountId: client.accountId, sireId: stud.id, damId: mare.id, now: T0, idempotencyKey: "stud-1" });
    const r2 = await breed(h.db, { accountId: client.accountId, sireId: stud.id, damId: mare.id, now: T0, idempotencyKey: "stud-1" });
    expect(r2).toMatchObject({ duplicate: true, pregnancyId: r1.pregnancyId });
    expect(await getBalance(h.db, owner.accountId)).toBe(before.o + 900);
    expect(await getBalance(h.db, client.accountId)).toBe(before.c - 1_000 - RULES.breedingBaseFee);
    expect((await ledgerHealth(h.db)).totalPostings).toBe(0);
  });

  it("foaling is idempotent, not early, and reveals the committed seed", async () => {
    const p = await stable();
    const sire = await makeHorse(h.db, p.stableId, { sex: "male", ...retired });
    const dam = await makeHorse(h.db, p.stableId, { sex: "female", ...retired, bound: true });
    const b = await breed(h.db, { accountId: p.accountId, sireId: sire.id, damId: dam.id, now: T0, idempotencyKey: `f:${dam.id}` });
    await expect(foal(h.db, { pregnancyId: b.pregnancyId, now: at(DAY - 1) })).rejects.toMatchObject({ code: "TOO_EARLY" });
    const [f1, f2] = await Promise.all([foal(h.db, { pregnancyId: b.pregnancyId, now: at(DAY) }), foal(h.db, { pregnancyId: b.pregnancyId, now: at(DAY) })]);
    expect(f1.foalId).toBe(f2.foalId);
    expect(await count(h.db, "horses", `dam_id = '${dam.id}'`)).toBe(1);
    const { commitSeed } = await import("../crypto");
    expect(commitSeed(f1.pregnancy.seed)).toBe(b.seedCommitment);
    const foalRow = await getHorseRow(h.db, f1.foalId);
    expect(foalRow).toMatchObject({ stage: "foal", generation: 1, tradeMinStarts: 5, ownerStableId: p.stableId });
  });
});
