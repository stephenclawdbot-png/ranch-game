/**
 * The debut rating (2026-11-20): a horse races off its real ability mark from its first race, not
 * a flat 40 (game-core debutRating). The stored rating is seated when a horse is made at racing
 * age, when a youngster grows up, and when a horse that still carries the placeholder enters its
 * first race: nothing is migrated, and a horse that has raced is never touched.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../client";
import { bandRatingOf, gameCoreHooks, gc, isDebutantRow, ratingOf, toHorseState } from "../gameCore";
import { horses } from "../schema";
import { createAccount } from "../services/accounts";
import { careForHorse } from "../services/horseLife";
import { listStableHorses } from "../services/horses";
import { createRace, enterRace } from "../services/races";
import { at, DAY, getHorseRow, makeHorse, memoryDb, MIN, newPlayer, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

let n = 0;
const race = (conditions: Record<string, unknown> = {}) =>
  createRace(h.db, { kind: "quick", name: `Debut ${++n}`, raceClass: "maiden", conditions: { distanceM: 1200, surface: "turf", ...conditions }, postTime: at(10 * MIN), entriesCloseAt: at(9 * MIN), targetRunners: 2 });

describe("the debut rating", () => {
  it("starters are made at their real ability mark", async () => {
    const p = await createAccount(h.db, { stableName: "Debut Yard", silks: { primary: "#112233", secondary: "#445566", pattern: "solid", cap: "#778899" }, startingCredits: 3_000, starterHorses: 3, now: T0 }, gameCoreHooks);
    const rows = await listStableHorses(h.db, p.stableId);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.rating).toBe(gc.abilityMark(toHorseState(r)));
      expect(ratingOf(r)).toBe(r.rating);
    }
    // Starter marks sit under the old flat 40 (that gap was every first result's rating drop).
    expect(Math.max(...rows.map((r) => r.rating))).toBeLessThan(gc.INITIAL_OR + 6);
  });

  it("a horse that was unraced on the placeholder reads its mark, and entering its first race writes it", async () => {
    const p = await newPlayer(h.db);
    const legacy = await makeHorse(h.db, p.stableId, { rating: gc.INITIAL_OR });
    const mark = gc.abilityMark(toHorseState(legacy));
    expect(isDebutantRow(legacy)).toBe(true);
    expect(ratingOf(legacy)).toBe(mark);
    expect(bandRatingOf(legacy).rating).toBe(mark);
    const r = await race();
    const entry = await enterRace(h.db, { accountId: p.accountId, raceId: r.id, horseId: legacy.id, tactic: "stalker", now: T0 });
    expect(entry.ratingBefore).toBe(mark);
    expect((entry.snapshot as { rating: number; state: gc.HorseState }).rating).toBe(mark);
    expect((entry.snapshot as { state: gc.HorseState }).state.rating).toEqual({ or: mark, ratedRuns: 0, peakOr: mark });
    const after = await getHorseRow(h.db, legacy.id);
    expect(after.rating).toBe(mark);
    expect((after.dynamics as { peakOr?: number }).peakOr).toBe(mark);
  });

  it("never touches a horse that has raced, or one whose rating was set", async () => {
    const p = await newPlayer(h.db);
    const raced = await makeHorse(h.db, p.stableId, { rating: gc.INITIAL_OR, starts: 3 });
    const set = await makeHorse(h.db, p.stableId, { rating: 62 });
    expect(isDebutantRow(raced)).toBe(false);
    expect(isDebutantRow(set)).toBe(false);
    expect(ratingOf(raced)).toBe(gc.INITIAL_OR);
    const r = await race();
    const entry = await enterRace(h.db, { accountId: p.accountId, raceId: r.id, horseId: set.id, tactic: "stalker", now: T0 });
    expect(entry.ratingBefore).toBe(62);
    expect((await getHorseRow(h.db, set.id)).rating).toBe(62);
  });

  it("a youngster is seated the day it reaches racing age", async () => {
    const p = await newPlayer(h.db);
    const foal = await makeHorse(h.db, p.stableId, { rating: gc.INITIAL_OR, careSessions: gc.CARE_TO_RACING - 1 });
    expect(isDebutantRow(foal)).toBe(false); // not of racing age: no rating to show yet
    const res = await careForHorse(h.db, { accountId: p.accountId, horseId: foal.id, now: at(DAY) });
    expect(res.graduated).toBe(true);
    const grown = await getHorseRow(h.db, foal.id);
    expect(grown.rating).toBe(gc.abilityMark(toHorseState(grown)));
    await h.db.update(horses).set({ rating: gc.INITIAL_OR }).where(eq(horses.id, foal.id));
    expect(ratingOf(await getHorseRow(h.db, foal.id))).toBe(grown.rating);
  });
});
