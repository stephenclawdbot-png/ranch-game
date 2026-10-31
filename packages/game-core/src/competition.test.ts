import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { RaceInputSchema, RaceReplaySchema } from "@thoroughbred/shared";
import { simulateRace } from "../../racing-engine/src/index";
import { featureCalendar, featureQualified, nextOpenSlot, regularSlot, regularSlots, ENTRY_CLOSE_BEFORE_MS, SLOT_INTERVAL_MS, SLOTS_PER_DAY } from "./seasons";
import { cupEntryBlock, cupRaceInput, dailyCupDay, rankCup, runDailyCup, CUP_ENTRANT_ID, CUP_ROTATION_FROM_DAY, cupRotation } from "./dailyCup";
import { climateSeasonOfDay, yearSeasonOf } from "./climate";
import { addPoints, formLeagues, racePoints, settleLeague, LEAGUE_SIZE, standings } from "./leagues";
import { ACHIEVEMENTS, detectRivalries, hallOfFameReasons, unlockedAchievements, type OwnerStats } from "./social";
import { RaceSlotSchema } from "./types";
import { seasonStartMs, SEASON_DAYS, MS_PER_DAY } from "./time";
import { toSharedHorse } from "./phenotype";
import { DAY, SILKS, T0, makeHorse } from "./test-helpers";

const clock = { epochMs: T0 };

describe("season calendar", () => {
  it("a race every slot with published conditions; entries close 30 s before", () => {
    const slots = regularSlots(clock, T0, T0 + DAY);
    expect(slots.length).toBe(SLOTS_PER_DAY);
    slots.forEach((s, i) => {
      expect(RaceSlotSchema.safeParse(s).success).toBe(true);
      expect(s.postTimeMs).toBe(T0 + i * SLOT_INTERVAL_MS);
      expect(s.postTimeMs - s.entryCloseMs).toBe(ENTRY_CLOSE_BEFORE_MS);
    });
    expect(regularSlot(clock, 1234)).toEqual(regularSlot(clock, 1234));
    // every class comes round within a few days of slots
    const tiers = new Set(regularSlots(clock, T0, T0 + 5 * DAY).map((s) => s.tier));
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

describe("Daily Cup weekday rotation", () => {
  const conds = (c: { distanceM: number; surface: string; going: string; weather: string }) => `${c.distanceM}:${c.surface}:${c.going}:${c.weather}`;
  it("deterministic by date and identical for every player: no secret in the conditions", () => {
    const day = CUP_ROTATION_FROM_DAY + 40;
    const a = dailyCupDay("one-secret", day);
    const b = dailyCupDay("another-secret", day);
    expect(conds(dailyCupDay("one-secret", day))).toBe(conds(a));
    expect(conds(a)).toBe(conds(b)); // the rotation is the same for everyone
    expect(a.seed).not.toBe(b.seed); // the day's seed (field and luck) still differs
    expect(conds(a)).toBe(conds(cupRotation(day)));
  });

  it("the week runs sprint to staying; the trip steps weekly within its division", () => {
    for (let w = 0; w < 8; w++) {
      const trips = Array.from({ length: 7 }, (_, i) => cupRotation(CUP_ROTATION_FROM_DAY + w * 7 + i).distanceM);
      expect(Math.min(...trips)).toBeLessThanOrEqual(1200); // a sprint
      expect(Math.max(...trips)).toBeGreaterThanOrEqual(2400); // a staying trip
    }
    // Monday is the sprint day, Thursday the staying day on the all-weather
    expect(cupRotation(CUP_ROTATION_FROM_DAY).distanceM).toBeLessThanOrEqual(1200);
    expect(cupRotation(CUP_ROTATION_FROM_DAY + 3)).toMatchObject({ surface: "synthetic", going: "good" });
    expect(cupRotation(CUP_ROTATION_FROM_DAY + 3).distanceM).toBeGreaterThanOrEqual(2400);
    // the trip within a division moves one step a week and repeats every third week
    const mondays = [0, 1, 2, 3].map((w) => cupRotation(CUP_ROTATION_FROM_DAY + w * 7).distanceM);
    expect(new Set(mondays).size).toBe(3);
    expect(mondays[3]).toBe(mondays[0]);
  });

  it("the going is the time of year's on turf, good on the all-weather, heavy only on wet dirt; the weather agrees", () => {
    const clock = { epochMs: 0 };
    const turfBySeason: Record<string, Set<string>> = {};
    for (let d = CUP_ROTATION_FROM_DAY; d < CUP_ROTATION_FROM_DAY + 4 * 28; d++) {
      const r = cupRotation(d, clock);
      const season = yearSeasonOf(climateSeasonOfDay(clock, d));
      if (r.surface === "synthetic") expect(r.going).toBe("good");
      else if (r.surface === "dirt") expect(r.going === "heavy" ? season === "winter" : r.going === "good").toBe(true);
      else (turfBySeason[season] ??= new Set()).add(r.going);
      if (r.going === "firm" || r.going === "good") expect(["clear", "overcast", "dusk"]).toContain(r.weather);
      if (r.weather === "rain") expect(["soft", "heavy"]).toContain(r.going);
    }
    expect(turfBySeason).toEqual({ spring: new Set(["good"]), summer: new Set(["firm"]), autumn: new Set(["soft"]), winter: new Set(["heavy"]) });
  });

  it("the Cup runs the rotation from the cutover day on, with the deployment's clock", () => {
    const clock = { epochMs: T0 };
    const day = CUP_ROTATION_FROM_DAY + 11;
    expect(dailyCupDay("secret", day, clock)).toMatchObject(cupRotation(day, clock));
    // without a clock the time of year counts from the Unix epoch: only the going can differ
    expect(dailyCupDay("secret", day)).toMatchObject({ distanceM: cupRotation(day).distanceM, surface: cupRotation(day).surface, weather: cupRotation(day).weather });
  });

  it("days before the cutover keep the rng-picked conditions they were published with", () => {
    const day = CUP_ROTATION_FROM_DAY - 1;
    // the old draw varied with the day's secret; the rotation never does
    expect(new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((s) => conds(dailyCupDay(s, day)))).size).toBeGreaterThan(1);
    const c = dailyCupDay("a", day);
    const r = cupRotation(day);
    expect(`${c.distanceM}:${c.surface}`).not.toBe(`${r.distanceM}:${r.surface}`);
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
  it("top 5 promoted, bottom 5 of those who raced relegated from Gold up; absent owners never relegated", () => {
    const fill = (tier: "silver" | "gold") => {
      let l = formLeagues(1, tier, Array.from({ length: 30 }, (_, i) => `o${i}`))[0]!;
      l.members.forEach((m, i) => {
        if (i < 20) l = addPoints(l, m.ownerId, racePoints((i % 8) + 1, 10) + i, i % 3 === 0, (i % 8) + 1);
      });
      return l;
    };
    // Silver is a floor: promotion only
    const silver = settleLeague(fill("silver"));
    expect(silver.filter((m) => m.outcome === "promoted").length).toBe(5);
    expect(silver.filter((m) => m.outcome === "relegated").length).toBe(0);
    const l = fill("gold");
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
