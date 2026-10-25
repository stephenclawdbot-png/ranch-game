import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { RaceInputSchema, RaceReplaySchema } from "@thoroughbred/shared";
import { simulateRace } from "../../racing-engine/src/index";
import { featureCalendar, featureQualified, nextOpenSlot, regularSlot, regularSlots, ENTRY_CLOSE_BEFORE_MS, SLOT_INTERVAL_MS, SLOTS_PER_DAY } from "./seasons";
import { cupEntryBlock, cupRaceInput, dailyCupDay, rankCup, runDailyCup, CUP_ENTRANT_ID } from "./dailyCup";
import { addPoints, formLeagues, racePoints, settleLeague, LEAGUE_SIZE, standings } from "./leagues";
import { ACHIEVEMENTS, detectRivalries, hallOfFameReasons, unlockedAchievements, type OwnerStats } from "./social";
import { RaceSlotSchema } from "./types";
import { seasonStartMs, SEASON_DAYS, MS_PER_DAY } from "./time";
import { toSharedHorse } from "./phenotype";
import { DAY, SILKS, T0, makeHorse } from "./test-helpers";

const clock = { epochMs: T0 };

describe("season calendar", () => {
  it("a race every 3 minutes with published conditions; entries close 1 minute before", () => {
    const slots = regularSlots(clock, T0, T0 + DAY);
    expect(slots.length).toBe(SLOTS_PER_DAY);
    slots.forEach((s, i) => {
      expect(RaceSlotSchema.safeParse(s).success).toBe(true);
      expect(s.postTimeMs).toBe(T0 + i * SLOT_INTERVAL_MS);
      expect(s.postTimeMs - s.entryCloseMs).toBe(ENTRY_CLOSE_BEFORE_MS);
    });
    expect(regularSlot(clock, 1234)).toEqual(regularSlot(clock, 1234));
    const tiers = new Set(slots.map((s) => s.tier));
    for (const t of ["maiden", "novice", "quick", "hcp_0_55", "hcp_50_75", "hcp_70_95", "listed", "g3", "g2", "g1"]) expect(tiers.has(t as never)).toBe(true);
  });
  it("nextOpenSlot is always still open", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 30 * DAY }), (dt) => {
        const s = nextOpenSlot(clock, T0 + dt);
        expect(s.entryCloseMs).toBeGreaterThan(T0 + dt);
        expect(s.entryCloseMs - (T0 + dt)).toBeLessThanOrEqual(SLOT_INTERVAL_MS);
      }),
    );
  });
  it("Weekend Features with weekday qualifiers, and a Season Final on the last day", () => {
    const cal = featureCalendar(clock, 2);
    const start = seasonStartMs(clock, 2);
    const finals = cal.filter((s) => s.kind === "season_final");
    expect(finals.length).toBe(4);
    for (const f of finals) expect(Math.floor((f.postTimeMs - start) / MS_PER_DAY)).toBe(SEASON_DAYS - 1);
    expect(cal.filter((s) => s.kind === "weekend_feature").length).toBeGreaterThanOrEqual(3);
    expect(cal.filter((s) => s.kind === "feature_qualifier").length).toBeGreaterThanOrEqual(15);
    for (const s of cal) expect(RaceSlotSchema.safeParse(s).success).toBe(true);
    expect(featureQualified([5, 2], 60)).toBe(true);
    expect(featureQualified([5], 60)).toBe(false);
  });
});

describe("Daily Cup (with the real engine)", () => {
  const cup = dailyCupDay("server-secret", 20000);
  it("is one fixed seeded field per day", () => {
    expect(dailyCupDay("server-secret", 20000)).toEqual(cup);
    expect(dailyCupDay("server-secret", 20001).seed).not.toBe(cup.seed);
    expect(cup.field.length).toBe(7);
  });
  it("identical conditions: the same horse gets the same time; the field never changes", () => {
    const h = toSharedHorse(makeHorse("cup1", { starts: 10 }), T0, SILKS);
    const a = runDailyCup(cup, h, h.style, simulateRace);
    const b = runDailyCup(cup, { ...h, id: "other-id", ownerId: "someone" }, h.style, simulateRace);
    expect(a.finishTimeUs).toBe(b.finishTimeUs);
    expect(RaceReplaySchema.safeParse(a.replay).success).toBe(true);
    expect(RaceInputSchema.safeParse(cupRaceInput(cup, h, "front")).success).toBe(true);
    // Field horses run the same race whoever enters (their own streams are keyed by gate).
    const other = toSharedHorse(makeHorse("cup2", { starts: 10, rarity: "rare" }), T0, SILKS);
    const c = runDailyCup(cup, other, other.style, simulateRace);
    expect(c.replay.horses.filter((x) => x.horseId !== CUP_ENTRANT_ID).map((x) => x.horseId)).toEqual(a.replay.horses.filter((x) => x.horseId !== CUP_ENTRANT_ID).map((x) => x.horseId));
  });
  it("one entry per player per day; ranked by time", () => {
    expect(cupEntryBlock(cup, cup.opensAtMs + 1, false)).toBeNull();
    expect(cupEntryBlock(cup, cup.opensAtMs + 1, true)).toBe("already_entered");
    expect(cupEntryBlock(cup, cup.closesAtMs, false)).toBe("closed");
    const ranked = rankCup([
      { ownerId: "a", horseId: "1", finishTimeUs: 100, position: 3, enteredAtMs: 5 },
      { ownerId: "b", horseId: "2", finishTimeUs: 90, position: 1, enteredAtMs: 9 },
      { ownerId: "c", horseId: "3", finishTimeUs: 100, position: 3, enteredAtMs: 1 },
    ]);
    expect(ranked.map((r) => r.ownerId)).toEqual(["b", "c", "a"]);
    expect(ranked[0]!.badge).toBe("gold");
  });
});

describe("leagues", () => {
  it("groups of ≤30, deterministic, everyone placed once", () => {
    const ids = Array.from({ length: 95 }, (_, i) => `o${i}`);
    const ls = formLeagues(7, "silver", ids);
    expect(ls.every((l) => l.members.length <= LEAGUE_SIZE)).toBe(true);
    expect(ls.flatMap((l) => l.members.map((m) => m.ownerId)).sort()).toEqual([...ids].sort());
    expect(formLeagues(7, "silver", [...ids].reverse())).toEqual(ls);
  });
  it("top 5 promoted, bottom 5 of those who raced relegated; absent owners never relegated", () => {
    let l = formLeagues(1, "silver", Array.from({ length: 30 }, (_, i) => `o${i}`))[0]!;
    l.members.forEach((m, i) => {
      if (i < 20) l = addPoints(l, m.ownerId, racePoints((i % 8) + 1, 10) + i, i % 3 === 0, (i % 8) + 1);
    });
    const moves = settleLeague(l);
    expect(moves.filter((m) => m.outcome === "promoted").length).toBe(5);
    expect(moves.filter((m) => m.outcome === "relegated").length).toBe(5);
    for (const m of moves.filter((x) => x.outcome === "relegated")) expect(l.members.find((x) => x.ownerId === m.ownerId)!.points).toBeGreaterThan(0);
    expect(standings(l)[0]!.points).toBeGreaterThanOrEqual(standings(l)[1]!.points);
  });
});

describe("social", () => {
  it("achievements unlock from stats", () => {
    const s: OwnerStats = { races: 3, wins: 1, gradedWins: 0, g1Wins: 0, photoFinishWins: 0, foalsBred: 1, bestBredGrade: "B", cupTop10: 0, cupRuns: 0, leaguePromotions: 0, seasonFinalWins: 0, hallOfFame: 0, careDays: 0 };
    const ids = unlockedAchievements(s).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(["first_race", "first_win", "first_foal", "bred_b"]));
    expect(ids).not.toContain("bred_a");
    expect(unlockedAchievements(s, new Set(["first_race"])).map((a) => a.id)).not.toContain("first_race");
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
  it("Hall of Fame criteria", () => {
    const h = makeHorse("hof");
    expect(hallOfFameReasons(h, { g1Wins: 2, gradedWins: 2, seasonFinalWins: 1, weekendFeatureWins: 0, recordTimes: 0, gradedWinnerOffspring: 3 })).toEqual(expect.arrayContaining(["champion", "season_winner", "foundation_sire"]));
    expect(hallOfFameReasons(h, { g1Wins: 0, gradedWins: 0, seasonFinalWins: 0, weekendFeatureWins: 0, recordTimes: 0, gradedWinnerOffspring: 0 })).toEqual([]);
  });
  it("rivalries: 3+ close adjacent finishes between two owners", () => {
    const race = (i: number, margin: number) => ({ raceId: `r${i}`, atMs: i, finishers: [{ ownerId: "a", position: 1, marginMm: 0 }, { ownerId: "b", position: 2, marginMm: margin }, { ownerId: "club", position: 3, marginMm: 100 }] });
    expect(detectRivalries([race(1, 500), race(2, 500)])).toEqual([]);
    const r = detectRivalries([race(1, 500), race(2, 900), race(3, 100), race(4, 10_000)]);
    expect(r).toEqual([{ owners: ["a", "b"], closeFinishes: 3, aWins: 3, lastAtMs: 3 }]);
  });
});
