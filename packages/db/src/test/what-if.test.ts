/**
 * The what-if re-run cache: one row per (race, horse, change), the first save wins, and nothing
 * else in the game moves (no ledger, horse or entry writes).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { createRace } from "../services/races";
import { getWhatIfRun, saveWhatIfRun } from "../services/whatIf";
import { RESET_TABLES } from "../services/playtest";
import { MIN, T0, count, makeHorse, memoryDb, newPlayer } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

describe("what-if run cache", () => {
  it("stores a re-run once per (race, horse, change) and returns the first one", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId);
    const race = await createRace(h.db, { kind: "scheduled", name: "What-if race", raceClass: "maiden", conditions: {}, postTime: T0, entriesCloseAt: new Date(T0.getTime() - MIN) });
    const key = { raceId: race.id, horseId: horse.id, changeKey: "tactic:closer" };
    expect(await getWhatIfRun(h.db, key)).toBeNull();

    const before = { postings: await count(h.db, "ledger_postings"), entries: await count(h.db, "race_entries"), results: await count(h.db, "race_results") };
    const first = await saveWhatIfRun(h.db, { ...key, engineVersion: "1.4.0", resolved: { tactic: "closer" }, summary: { position: 2 }, stableId: p.stableId, now: T0 });
    expect(first.summary).toEqual({ position: 2 });
    // A second save (a concurrent request) keeps the first row.
    const again = await saveWhatIfRun(h.db, { ...key, engineVersion: "1.4.0", resolved: { tactic: "closer" }, summary: { position: 9 }, stableId: p.stableId, now: T0 });
    expect(again.id).toBe(first.id);
    expect(again.summary).toEqual({ position: 2 });
    expect((await getWhatIfRun(h.db, key))?.id).toBe(first.id);
    // Another change is another row.
    const other = await saveWhatIfRun(h.db, { ...key, changeKey: "tactic:front", engineVersion: "1.4.0", resolved: {}, summary: {}, stableId: null, now: T0 });
    expect(other.id).not.toBe(first.id);
    expect(await count(h.db, "what_if_runs")).toBe(2);
    // Only its own table is written.
    expect({ postings: await count(h.db, "ledger_postings"), entries: await count(h.db, "race_entries"), results: await count(h.db, "race_results") }).toEqual(before);
  });

  it("is wiped with the races by the playtest reset", () => {
    expect(RESET_TABLES).toContain("what_if_runs");
    expect(RESET_TABLES.indexOf("what_if_runs")).toBeLessThan(RESET_TABLES.indexOf("races"));
  });
});
