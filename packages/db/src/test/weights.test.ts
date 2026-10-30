import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { createRace, enterRace, fieldHashOf, handicapWeightsFor, lockField, modelForRace, type CreateRaceInput } from "../services/races";
import { at, MIN, makeHorse, memoryDb, newPlayer } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

let n = 0;
function race(extra: Partial<CreateRaceInput> = {}) {
  return createRace(h.db, {
    kind: "scheduled",
    name: `Weights race ${++n}`,
    raceClass: "handicap",
    conditions: { minRating: 0, maxRating: 140, distanceM: 1600, surface: "turf", going: "good" },
    postTime: at(10 * MIN),
    entriesCloseAt: at(9 * MIN),
    purse: 2_000,
    maxRunners: 12,
    targetRunners: 6,
    ...extra,
  });
}

async function entered(r: { id: string }, ratings: number[]) {
  const ids: string[] = [];
  for (const rating of ratings) {
    const p = await newPlayer(h.db, { credits: 5_000 });
    const horse = await makeHorse(h.db, p.stableId, { rating });
    await enterRace(h.db, { accountId: p.accountId, raceId: r.id, horseId: horse.id, tactic: "stalker", now: at(0) });
    ids.push(horse.id);
  }
  return ids;
}

describe("handicap weights and the race model at the field lock", () => {
  it("a Live handicap gives every runner its weight (1 lb per OR below the top-rated) and the engine horse carries it", async () => {
    const r = await race();
    const [hi, lo] = await entered(r, [62, 51]);
    const seen = new Map<string, number | undefined>();
    const field = (await lockField(h.db, r.id, at(9 * MIN), {
      engineHorse: ({ snapshot, extraWeightLb }) => {
        seen.set(String(snapshot.id), extraWeightLb);
        return snapshot;
      },
    }))!;
    expect(field.model).toBe("1.4.0");
    expect(field.runners).toHaveLength(6);
    const top = Math.max(...field.runners.map((x) => x.weightLb!));
    expect(top).toBe(gc.TOP_WEIGHT_LB);
    const a = field.runners.find((x) => x.horseId === hi)!;
    const b = field.runners.find((x) => x.horseId === lo)!;
    // 11 OR between them: 11 lb between their weights (both above the bottom weight).
    expect(a.weightLb! - b.weightLb!).toBe(11);
    const min = Math.min(...field.runners.map((x) => x.weightLb!));
    for (const x of field.runners) {
      expect(x.extraWeightLb).toBe(x.weightLb! - min);
      expect(seen.get(x.horseId) ?? 0).toBe(x.extraWeightLb);
    }
    // Weights are sealed in the field hash.
    expect(field.fieldHash).toBe(fieldHashOf(field.runners, null, field.model));
    const unweighted = field.runners.map(({ weightLb: _w, extraWeightLb: _x, ...rest }) => rest);
    expect(fieldHashOf(unweighted, null, field.model)).not.toBe(field.fieldHash);
  });

  it("level-weight races carry no weights; only Live card races lock with the race model", async () => {
    const r = await race({ raceClass: "listed", conditions: { minRating: 0, maxRating: 140, distanceM: 1600, surface: "turf", going: "good" } });
    await entered(r, [70, 50]);
    const field = (await lockField(h.db, r.id, at(9 * MIN)))!;
    for (const x of field.runners) {
      expect("weightLb" in x).toBe(false);
      expect("extraWeightLb" in x).toBe(false);
    }
    expect(handicapWeightsFor({ kind: "scheduled", raceClass: "handicap" })).toBe(true);
    expect(handicapWeightsFor({ kind: "scheduled", raceClass: "listed" })).toBe(false);
    expect(handicapWeightsFor({ kind: "quick", raceClass: "handicap" })).toBe(false);
    expect(modelForRace({ kind: "scheduled" })).toBe("1.4.0");
    expect(modelForRace({ kind: "final" })).toBe("1.4.0");
    expect(modelForRace({ kind: "quick" })).toBeUndefined();
    expect(modelForRace({ kind: "daily_cup" })).toBeUndefined();
  });

  it("a field locked before weights and the model existed hashes exactly as it did", () => {
    const runners = [{ gate: 1, tactic: "stalker", horseId: "a", stableId: null, isHouse: true, horse: { id: "a" } }];
    expect(fieldHashOf(runners)).toBe(fieldHashOf(runners, null, null));
    expect(fieldHashOf(runners, null, "1.4.0")).not.toBe(fieldHashOf(runners));
  });
});
