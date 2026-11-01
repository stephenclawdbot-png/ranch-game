/**
 * The first race is a hook, not a filter (first-hour playtest): a brand-new stable's first Story
 * race is at its horse's best (nearest trip, own surface, good ground) against a Club field drawn
 * from just below the horse's real ability up to level with it (§10 "first maiden"); later open
 * Story races in chapter 1 keep that window, eased or stiffened by the stable's run of results
 * (game-core storyOpenFloor); after chapter 1 they use the band rating's window as before. "Try again at a race that suits" (suited) asks for the same
 * conditions any time, with the usual field.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as gc from "@thoroughbred/game-core";
import { authenticate, createDb, getRace, listStableHorses, listStableRuns, trueMarkOf, type DbHandle } from "@thoroughbred/db";
import { foundStable } from "./founding";
import { FIRST_STORY_BELOW, createStoryRace, storyConditions } from "./game";
import { horseFromRow, parseSilks } from "./horseView";

let h: DbHandle;
const T0 = new Date(Date.UTC(2026, 10, 4, 12, 0, 0));
const SILKS = { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" };

beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

describe("Story conditions", () => {
  it("a suited race is the nearest Story trip to the horse's best, on its surface, on good ground", () => {
    expect(storyConditions({ preferredDistanceM: 1150, preferredSurface: "dirt" }, true)).toEqual({ distanceM: 1200, surface: "dirt", going: "good" });
    expect(storyConditions({ preferredDistanceM: 1700, preferredSurface: "turf" }, true)).toEqual({ distanceM: 1600, surface: "turf", going: "good" });
    expect(storyConditions({ preferredDistanceM: 3600, preferredSurface: "synthetic" }, true)).toEqual({ distanceM: 3200, surface: "synthetic", going: "good" });
  });

  it("otherwise the secretary's usual draw: a 4-in-4 miss can land off the horse's trip, surface and ground", () => {
    const off = storyConditions({ preferredDistanceM: 1150, preferredSurface: "dirt" }, false, (n) => n - 1);
    expect(off).toEqual({ distanceM: 3200, surface: "synthetic", going: "good" });
    const wet = storyConditions({ preferredDistanceM: 1150, preferredSurface: "dirt" }, false, (n) => (n === 3 ? 2 : 0));
    expect(wet.going).toBe("heavy");
  });
});

describe("a new stable's first Story race", () => {
  it("is at the horse's best against a level Club field; the second is a normal Story race", async () => {
    const acc = await foundStable(h.db, { stableName: "First Gate Yard", silks: SILKS, inviteCode: null, now: T0 });
    const s = (await authenticate(h.db, acc.token))!;
    const rows = await listStableHorses(h.db, s.stable.id);
    const row = rows[0]!;
    const horse = horseFromRow(row, parseSilks(s.stable.silks), T0.getTime());
    const first = await createStoryRace(h.db, s, { horseId: row.id, instant: true }, T0);
    const c1 = (await getRace(h.db, first.raceId))!.conditions as { distanceM: number; surface: string; going: string; minRating?: number; maxRating?: number };
    expect({ distanceM: c1.distanceM, surface: c1.surface, going: c1.going }).toEqual(storyConditions(horse, true));
    // The Club window starts just below the horse's real ability (no ceiling: the horse's own band rating would be over it).
    expect(c1.minRating).toBe(Math.max(0, trueMarkOf(row) - FIRST_STORY_BELOW));
    expect(c1.maxRating).toBeUndefined();
    expect(gc.clubWindow({ kind: "story", minRating: c1.minRating }).hi).toBe(Math.min(gc.CLUB_MARK_MAX, c1.minRating! + gc.CLUB_ABOVE_MEDIAN_SPAN));
    // Still in chapter 1: the same honest window from the second horse's real ability (no band ceiling).
    const second = await createStoryRace(h.db, s, { horseId: rows[1]!.id, instant: true }, new Date(T0.getTime() + 60_000));
    const c2 = (await getRace(h.db, second.raceId))!.conditions as { minRating?: number; maxRating?: number };
    const recent = [((await listStableRuns(h.db, s.stable.id, 5))[0]!.position ?? 0) === 1];
    expect(c2.minRating).toBe(gc.storyOpenFloor(trueMarkOf(rows[1]!), recent).minRating);
    expect(c2.maxRating).toBeUndefined();
  });

  it("after chapter 1, open Story races take the band rating's window again", async () => {
    const acc = await foundStable(h.db, { stableName: "County Gate Yard", silks: SILKS, inviteCode: null, now: T0 });
    const s = (await authenticate(h.db, acc.token))!;
    await h.db.execute(`update stables set licence_level = 2 where id = '${s.stable.id}'`);
    const rows = await listStableHorses(h.db, s.stable.id);
    await createStoryRace(h.db, s, { horseId: rows[0]!.id, instant: true }, T0);
    const second = await createStoryRace(h.db, s, { horseId: rows[1]!.id, instant: true }, new Date(T0.getTime() + 60_000));
    const c2 = (await getRace(h.db, second.raceId))!.conditions as { minRating?: number; maxRating?: number };
    expect(c2.maxRating).toBeDefined();
  });
});
