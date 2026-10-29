import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { createRace, enterRace, getRaceForSimulation, settleRace, type RunnerOutcome } from "../services/races";
import { getBalance } from "../services/ledger";
import { gameCoreHooks, gc, toHorseState } from "../gameCore";
import { at, DAY, getHorseRow, makeHorse, memoryDb, MIN, newPlayer, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

async function runRace(raceId: string, now: Date, first: string[], extra: Record<string, Partial<RunnerOutcome>> = {}) {
  const { field } = await getRaceForSimulation(h.db, raceId, now);
  const order = [...first, ...field.runners.map((r) => r.horseId).filter((id) => !first.includes(id))];
  return settleRace(h.db, {
    raceId,
    now,
    resultHash: "0".repeat(64),
    result: { order },
    runners: order.map((horseId, i) => ({ horseId, position: i + 1, ...(extra[horseId] ?? {}) })),
  });
}

describe("fatal injuries and fragile legs", () => {
  it("a fatal injury retires the horse for good, pays insurance, keeps its memory and its dynamics", async () => {
    const p = await newPlayer(h.db);
    const q = await newPlayer(h.db);
    const lucky = await makeHorse(h.db, p.stableId, { starts: 4 });
    const unlucky = await makeHorse(h.db, q.stableId, { starts: 6, insured: true, dynamics: { graduatedAtMs: 123, peakOr: 70 } });
    const race = await createRace(h.db, {
      kind: "scheduled",
      name: "Fatal Stakes",
      raceClass: "maiden",
      conditions: { distanceM: 1200, surface: "turf" },
      postTime: at(10 * MIN),
      entriesCloseAt: at(9 * MIN),
      targetRunners: 4,
    });
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: lucky.id, tactic: "front", now: T0 });
    await enterRace(h.db, { accountId: q.accountId, raceId: race.id, horseId: unlucky.id, tactic: "front", now: T0 });
    const before = await getBalance(h.db, q.accountId);
    const unluckyBefore = await getHorseRow(h.db, unlucky.id);
    const now = at(11 * MIN);
    const r = await runRace(race.id, now, [lucky.id, unlucky.id], { [unlucky.id]: { injury: { severity: "fatal", recoveryMs: 21 * DAY } } });
    expect(r.retired).toContain(unlucky.id);
    const row = await getHorseRow(h.db, unlucky.id);
    expect(row).toMatchObject({ careerStatus: "pasture", retirementReason: "injury", studFee: null, lockKind: null });
    expect(row.pasturedAt?.getTime()).toBe(now.getTime());
    const dyn = row.dynamics as { diedAtMs?: number; diedAtRaceId?: string; graduatedAtMs?: number; peakOr?: number };
    expect(dyn).toMatchObject({ diedAtMs: now.getTime(), diedAtRaceId: race.id, graduatedAtMs: 123 });
    expect(dyn.peakOr).toBeGreaterThanOrEqual(70);
    expect(await getBalance(h.db, q.accountId)).toBe(before + gc.insurancePayout(toHorseState(unluckyBefore)));
    // the winner is untouched
    expect(await getHorseRow(h.db, lucky.id)).toMatchObject({ careerStatus: "racing" });
  });

  it("a parent retired by injury can pass fragile legs to its foals; sound parents never do", async () => {
    const p = await newPlayer(h.db);
    const sire = await makeHorse(h.db, p.stableId, { sex: "male" });
    const dam = await makeHorse(h.db, p.stableId, { sex: "female" });
    const hurt = { ...sire, careerStatus: "retired" as const, retirementReason: "injury" as const, retiredAt: T0 };
    const sound = { ...sire, careerStatus: "retired" as const, retirementReason: "choice" as const, retiredAt: T0 };
    const fragileFoals = (s: typeof sire) =>
      Array.from({ length: 40 }, (_, i) => gameCoreHooks.breedFoal({ seed: `fragile-${i}`, sire: s, dam, coi: 0, season: 1 })).filter((f) =>
        gc.isFragile(f.genome as gc.Genome),
      ).length;
    const fromHurt = fragileFoals(hurt);
    expect(fromHurt).toBeGreaterThan(5);
    expect(fromHurt).toBeLessThan(35);
    expect(fragileFoals(sound)).toBe(0);
  });
});
