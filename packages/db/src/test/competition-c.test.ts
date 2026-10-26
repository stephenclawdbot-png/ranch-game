/**
 * Feature C services: Story progress and licences, the Daily Cup, weekly leagues and the
 * Hall of Fame (PGlite).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { leagueMembers, raceEntries, raceResults, races, stables } from "../schema";
import { stableOf } from "../services/accounts";
import { getBalance } from "../services/ledger";
import { createRace } from "../services/races";
import { recordStoryResult, storyState } from "../services/story";
import { cupDayEntries, cupDaySecret, runCupEntry } from "../services/dailyCup";
import { ensureLeagueMembership, leagueOf, nextTier, seasonStandings, settleLeagueWeeks, weekScore } from "../services/leagues";
import { championHorses, inductHallOfFame, listAchievements, ownerStats, recordTimes, rivalsOf, syncAchievements } from "../services/hall";
import { at, DAY, makeHorse, memoryDb, MIN, newPlayer, settledAll, T0 } from "./helpers";
import type { Db } from "../types";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

let raceN = 0;
/** A settled Live card race with the given finishers (stable null = house horse). */
async function settledLive(db: Db, input: { postTime: Date; raceClass?: string; distanceM?: number; surface?: string; kind?: "scheduled" | "feature" | "final"; finishers: { horseId: string; stableId: string | null; timeUs?: number; marginMm?: number }[] }) {
  raceN++;
  const race = await createRace(db, {
    kind: input.kind ?? "scheduled",
    name: `Live ${raceN}`,
    raceClass: input.raceClass ?? "maiden",
    conditions: { distanceM: input.distanceM ?? 1200, surface: input.surface ?? "turf", going: "good" },
    postTime: input.postTime,
    entriesCloseAt: new Date(input.postTime.getTime() - MIN),
  });
  await db.update(races).set({ status: "settled", settledAt: input.postTime }).where(eq(races.id, race.id));
  const order = input.finishers.map((f, i) => ({ horseId: f.horseId, position: i + 1, finishTimeUs: f.timeUs ?? 70_000_000 + i * 200_000, marginMm: f.marginMm ?? (i === 0 ? 0 : 3000), marginLabel: "1", prize: 0 }));
  for (const [i, f] of input.finishers.entries()) {
    await db.insert(raceEntries).values({ raceId: race.id, horseId: f.horseId, stableId: f.stableId, isHouse: f.stableId === null, gate: i + 1, tactic: "stalker", snapshot: {}, ratingBefore: 0, finishPosition: i + 1, finishTimeUs: order[i]!.finishTimeUs });
  }
  await db.insert(raceResults).values({ raceId: race.id, seedCommitment: "c", seedReveal: "s", resultHash: "r", result: { finishOrder: order, winningTimeUs: order[0]!.finishTimeUs, photoFinish: false } });
  return race;
}

describe("story progress and licences", () => {
  it("records first wins once, completes a chapter on the third win and raises the licence (never lowers it)", async () => {
    const p = await newPlayer(h.db);
    expect(await storyState(h.db, p.accountId)).toEqual({ licenceLevel: 1, wonKeys: [] });
    const rec = (raceKey: string, won = true) => recordStoryResult(h.db, { accountId: p.accountId, raceId: "00000000-0000-4000-8000-000000000001", raceKey, won, now: T0 });
    expect((await rec("club-1", false)).newWin).toBe(false);
    expect((await rec("club-1")).newWin).toBe(true);
    expect((await rec("club-1")).newWin).toBe(false);
    // County races don't count without the County licence.
    expect((await rec("county-1")).newWin).toBe(false);
    await rec("club-2");
    const third = await rec("club-5");
    expect(third).toMatchObject({ newWin: true, licenceBefore: 1, licenceAfter: 2, chaptersCompleted: ["club"] });
    expect((await stableOf(h.db, p.accountId)).licenceLevel).toBe(2);
    const st = await storyState(h.db, p.accountId);
    expect(st.licenceLevel).toBe(2);
    expect(new Set(st.wonKeys)).toEqual(new Set(["club-1", "club-2", "club-5"]));
    // Concurrent results serialise on the stable lock.
    const res = await settledAll(["county-1", "county-2", "county-3", "county-4"].map((k) => rec(k)));
    expect(res.errors).toHaveLength(0);
    expect((await storyState(h.db, p.accountId)).licenceLevel).toBe(3);
    expect((await listAchievements(h.db, p.accountId)).map((a) => a.code)).toEqual(expect.arrayContaining(["story-chapter:club", "story-chapter:county"]));
  });
});

describe("Daily Cup", () => {
  it("one run per player per day, participation credits once, ranked by time", async () => {
    const a = await newPlayer(h.db, { credits: 0 });
    const b = await newPlayer(h.db, { credits: 0 });
    const ha = await makeHorse(h.db, a.stableId);
    const hb = await makeHorse(h.db, b.stableId);
    const ha2 = await makeHorse(h.db, a.stableId);
    const day = gc.dayIndex(T0.getTime());
    const secret = await cupDaySecret(h.db, day);
    expect(await cupDaySecret(h.db, day)).toBe(secret);
    expect(await cupDaySecret(h.db, day + 1)).not.toBe(secret);
    const run = (accountId: string, horseId: string, timeUs: number, now = T0) =>
      runCupEntry(h.db, { accountId, horseId, now, credits: gc.CUP_PARTICIPATION_CREDITS, run: () => ({ finishPosition: 3, finishTimeUs: timeUs, result: { t: timeUs } }) });
    const res = await settledAll([run(a.accountId, ha.id, 71_000_000), run(a.accountId, ha2.id, 70_000_000)]);
    expect(res.ok).toHaveLength(1);
    expect(res.errors[0]).toMatchObject({ code: "DAILY_CUP_ALREADY_ENTERED" });
    await run(b.accountId, hb.id, 69_000_000);
    expect(await getBalance(h.db, a.accountId)).toBe(gc.CUP_PARTICIPATION_CREDITS + gc.DAILY_GOAL_CREDITS); // + the day's cup goal
    const board = await cupDayEntries(h.db, T0.toISOString().slice(0, 10));
    expect(board.map((r) => r.accountId)).toEqual([b.accountId, a.accountId]);
    // The horse is untouched (no start, no fatigue).
    const [after] = await h.db.select().from(stables).where(eq(stables.accountId, a.accountId));
    expect(after).toBeDefined();
    // A new UTC day opens a new Cup.
    await run(a.accountId, ha.id, 72_000_000, at(DAY));
    expect(await getBalance(h.db, a.accountId)).toBe(2 * (gc.CUP_PARTICIPATION_CREDITS + gc.DAILY_GOAL_CREDITS));
    // Not your horse.
    await expect(run(b.accountId, ha.id, 1, at(2 * DAY))).rejects.toMatchObject({ code: "NOT_OWNER" });
  });
});

describe("weekly leagues", () => {
  it("points come from settled Live runs; the week settles once with promotion, and absent owners stay put", async () => {
    const monday = new Date("2026-11-02T00:00:00.000Z"); // T0's week
    const owners = await Promise.all(Array.from({ length: 12 }, () => newPlayer(h.db)));
    const horsesOf = await Promise.all(owners.map((o) => makeHorse(h.db, o.stableId)));
    for (const o of owners) await ensureLeagueMembership(h.db, { accountId: o.accountId, now: T0 });
    const table = (await leagueOf(h.db, owners[0]!.accountId, T0))!;
    expect(table.rows).toHaveLength(12);
    expect(table.tier).toBe(1);
    // Owners 0..10 race; owner 11 is away all week.
    for (let r = 0; r < 3; r++) {
      await settledLive(h.db, {
        postTime: new Date(monday.getTime() + (r + 1) * 3_600_000),
        finishers: owners.slice(0, 11).map((o, i) => ({ horseId: horsesOf[i]!.id, stableId: o.stableId })),
      });
    }
    const live = (await leagueOf(h.db, owners[0]!.accountId, T0))!;
    expect(live.rows[0]!.accountId).toBe(owners[0]!.accountId);
    expect(live.rows[0]!.points).toBe(3 * weekScore([{ position: 1, fieldSize: 11, raceClass: "maiden" }]).points);
    expect(live.rows.find((r) => r.accountId === owners[11]!.accountId)!.points).toBe(0);

    // Next week: settles the finished week once.
    const nextWeek = new Date(monday.getTime() + 7 * DAY + 3_600_000);
    expect(await settleLeagueWeeks(h.db, nextWeek)).toBe(12);
    expect(await settleLeagueWeeks(h.db, nextWeek)).toBe(0);
    const rows = await h.db.select().from(leagueMembers).where(eq(leagueMembers.weekStart, "2026-11-02"));
    const by = new Map(rows.map((r) => [r.accountId, r]));
    expect(by.get(owners[0]!.accountId)!.movement).toBe(1);
    expect(by.get(owners[11]!.accountId)!.movement).toBe(0); // absent: never relegated
    expect(await nextTier(h.db, owners[0]!.accountId, "2026-11-09")).toBe(2);
    const m = await ensureLeagueMembership(h.db, { accountId: owners[0]!.accountId, now: nextWeek });
    expect(m.weekStart).toBe("2026-11-09");
    expect((await leagueOf(h.db, owners[0]!.accountId, nextWeek))!.tier).toBe(2);
    expect((await leagueOf(h.db, owners[11]!.accountId, nextWeek))).toBeNull();

    const season = await seasonStandings(h.db, { season: gc.seasonOf({ epochMs: Date.UTC(2026, 0, 5) }, T0.getTime()), now: nextWeek, accountId: owners[5]!.accountId, limit: 3 });
    expect(season.rows[0]!.accountId).toBe(owners[0]!.accountId);
    expect(season.mine?.rank).toBe(6);
  });

  it("weekly points are capped", () => {
    const many = Array.from({ length: 40 }, () => ({ position: 1, fieldSize: 10, raceClass: "graded" }));
    expect(weekScore(many).points).toBe(gc.WEEKLY_RACE_POINTS_CAP);
  });
});

describe("Hall of Fame", () => {
  it("record times, champions, inductions, achievements and rivalries from settled races", async () => {
    const a = await newPlayer(h.db);
    const b = await newPlayer(h.db);
    const star = await makeHorse(h.db, a.stableId, { name: "Record Breaker" });
    const other = await makeHorse(h.db, b.stableId, { name: "Shadow" });
    const house = await makeHorse(h.db, null, { name: "Club Plodder" });
    const base = new Date("2026-11-03T10:00:00.000Z");
    for (let i = 0; i < 4; i++) {
      await settledLive(h.db, {
        postTime: new Date(base.getTime() + i * 3_600_000),
        raceClass: "graded",
        kind: i < 2 ? "feature" : "scheduled",
        distanceM: 1400,
        surface: "synthetic",
        finishers: [
          { horseId: star.id, stableId: a.stableId, timeUs: 84_000_000 - i * 10_000 },
          { horseId: other.id, stableId: b.stableId, marginMm: 500 },
          { horseId: house.id, stableId: null },
        ],
      });
    }
    const recs = await recordTimes(h.db);
    const r = recs.find((x) => x.surface === "synthetic" && x.distanceM === 1400)!;
    expect(r.horseName).toBe("Record Breaker");
    expect(r.timeUs).toBe(84_000_000 - 30_000);
    const champs = await championHorses(h.db);
    expect(champs.find((c) => c.horseId === star.id)?.liveWins).toBe(4);
    expect(await inductHallOfFame(h.db, T0)).toBeGreaterThan(0);
    expect(await inductHallOfFame(h.db, T0)).toBe(0);
    const stats = await ownerStats(h.db, a.accountId);
    expect(stats).toMatchObject({ races: 4, wins: 4, gradedWins: 4 });
    const earned = await syncAchievements(h.db, a.accountId);
    expect(earned).toEqual(expect.arrayContaining(["first_race", "first_win", "graded_win"]));
    expect(await syncAchievements(h.db, a.accountId)).toEqual([]);
    const rivals = await rivalsOf(h.db, a.stableId);
    expect(rivals[0]).toMatchObject({ stableId: b.stableId, closeFinishes: 4, yourWins: 4 });
  });
});
