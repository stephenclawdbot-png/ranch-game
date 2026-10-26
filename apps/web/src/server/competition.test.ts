/**
 * Feature C on the web server, against PGlite: Daily Cup runs (once a day, sealed seed),
 * Story chapter races (named rivals, rewards, licences that gate Live classes) and the
 * league / Hall of Fame views.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as gc from "@thoroughbred/game-core";
import { createAccount, createDb, createRace, getBalance, getRace, listStableHorses, recordStoryResult, stableOf, storyState, type DbHandle } from "@thoroughbred/db";
import { cupRunView, cupView, hallView, leagueView, runCup } from "./competition";
import { createChapterRace, storyView } from "./story";
import { driveCard, enterLive, entryReason, licenceReason, myRaceResult, quickPickLive, raceCard, raceList } from "./game";
import type { Session } from "./session";

let h: DbHandle;
const T0 = new Date(Date.UTC(2026, 10, 3, 12, 0, 7));
const at = (ms: number) => new Date(T0.getTime() + ms);

async function player(name: string): Promise<Session> {
  const acc = await createAccount(h.db, { stableName: name, silks: { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" }, timezone: "Europe/London", now: T0 });
  return { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) };
}

async function refresh(s: Session): Promise<Session> {
  return { ...s, stable: await stableOf(h.db, s.accountId) };
}

beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

describe("Daily Cup", () => {
  it("one free run a day against the fixed field; ranked; replay sealed until the day closes", { timeout: 60_000 }, async () => {
    const a = await player("Cup Alpha");
    const b = await player("Cup Bravo");
    const before = await cupView(h.db, a, T0);
    expect(before.mine).toBeNull();
    expect(before.field).toHaveLength(gc.CUP_FIELD_SIZE);
    expect(before.horses?.length).toBe(3);
    const credits = await getBalance(h.db, a.accountId);
    const horseId = before.horses!.find((x) => !x.block)!.id;
    const { entryId } = await runCup(h.db, a, { horseId }, T0);
    await expect(runCup(h.db, a, { horseId }, at(60_000))).rejects.toMatchObject({ code: "DAILY_CUP_ALREADY_ENTERED" });
    expect(await getBalance(h.db, a.accountId)).toBe(credits + gc.CUP_PARTICIPATION_CREDITS + gc.DAILY_GOAL_CREDITS); // + the day's cup goal
    const bv = await cupView(h.db, b, T0);
    await runCup(h.db, b, { horseId: bv.horses![0]!.id, tactic: "front" }, T0);

    const view = await cupView(h.db, a, T0);
    expect(view.entrants).toBe(2);
    expect(view.mine?.entryId).toBe(entryId);
    expect(view.horses).toBeNull();
    expect(view.board.top.map((r) => r.rank)).toEqual([1, 2]);
    expect(view.board.top[0]!.timeUs).toBeLessThanOrEqual(view.board.top[1]!.timeUs);

    const run = (await cupRunView(h.db, entryId, a, T0))!;
    expect(run.mine).toBe(true);
    expect(run.sealed).toBe(true);
    expect(run.replay.seed).toMatch(/^0{64}$/);
    expect(run.replay.horses.some((x) => x.horseId === run.entrantId)).toBe(true);
    expect(run.replay.result.finishOrder.find((f) => f.horseId === run.entrantId)!.finishTimeUs).toBe(run.timeUs);
    // The horse is untouched: no start, no rating change.
    const after = await cupView(h.db, a, T0);
    expect(after.mine).not.toBeNull();
    // After the day closes the seed is revealed and the replay verifies against the commitment.
    const next = new Date(run.replay.race.postTimeMs + gc.MS_PER_DAY + 1000);
    const open = (await cupRunView(h.db, entryId, a, next))!;
    expect(open.sealed).toBe(false);
    expect(gc.commitSeed(open.replay.seed)).toBe(open.seedCommitment);
    const tomorrow = await cupView(h.db, a, next);
    expect(tomorrow.yesterday?.winner).not.toBeNull();
    expect(tomorrow.mine).toBeNull();
  });
});

describe("Story chapters", () => {
  it("a chapter race runs against named rivals, pays a capped reward once and records progress; licences gate Live classes", { timeout: 120_000 }, async () => {
    let p = await player("Story Yard");
    const view = await storyView(h.db, p, T0);
    expect(view.licence.level).toBe(1);
    expect(view.chapters.map((c) => c.unlocked)).toEqual([true, false, false, false]);
    expect(view.chapters[0]!.races.every((r) => r.bestHorse !== null)).toBe(true);
    expect(view.rivals.map((r) => r.id)).toEqual(expect.arrayContaining(["house-harrowgate", "house-larkspur", "house-vicarage"]));

    await expect(createChapterRace(h.db, p, { raceKey: "county-1", instant: true }, T0)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    const created = await createChapterRace(h.db, p, { raceKey: "club-1", instant: true }, T0);
    expect(created.pick?.reason).toBeTruthy();
    const race = (await getRace(h.db, created.raceId))!;
    expect(race.status).toBe("settled");
    expect(race.name).toBe("Larkspur Welcome Plate");
    const card = await raceCard(h.db, created.raceId, T0, p.stable.id);
    expect(card.kind).toBe("story");
    const rivalNames = new Set(gc.storyRaceByKey("club-1")!.rivals.map((id) => gc.rivalById(id)!.name));
    const house = card.field.filter((f) => !f.mine);
    expect(house.length).toBe(gc.storyRaceByKey("club-1")!.fieldSize - 1);
    for (const f of house) expect(rivalNames.has(f.stableName)).toBe(true);
    const mine = (await myRaceResult(h.db, p, created.raceId, T0)).runners[0]!;
    expect(mine.storyReward).toBe(mine.position === 1 ? gc.STORY_FIRST_WIN_REWARD.club : gc.STORY_REPLAY_REWARD);
    const st = await storyState(h.db, p.accountId);
    expect(st.wonKeys.includes("club-1")).toBe(mine.position === 1);

    // Licences: Club licence races maidens and novices; the 50-75 handicap needs the County licence.
    const hcp = await createRace(h.db, { kind: "scheduled", name: "Hcp", raceClass: "handicap", conditions: { minRating: 50, maxRating: 75 }, postTime: at(10 * 60_000), entriesCloseAt: at(9 * 60_000) });
    expect(licenceReason(hcp, 1)).toMatch(/County licence/);
    expect(licenceReason(hcp, 2)).toBeNull();
    const rows = await listStableHorses(h.db, p.stable.id);
    const free = rows.find((r) => !r.lockKind)!;
    expect(entryReason(free, hcp, T0, 1)).toMatch(/County licence/);
    await expect(enterLive(h.db, p, hcp.id, free.id, { tactic: "stalker", intensity: "normal" }, T0)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });

    // Winning three Club races earns the County licence (recorded directly here: race outcomes are honest).
    for (const k of ["club-2", "club-3", "club-4"]) await recordStoryResult(h.db, { accountId: p.accountId, raceId: created.raceId, raceKey: k, won: true, now: T0 });
    p = await refresh(p);
    expect(p.stable.licenceLevel).toBe(2);
    const after = await storyView(h.db, p, T0);
    expect(after.chapters[0]!.complete).toBe(true);
    expect(after.chapters[1]!.unlocked).toBe(true);
    expect(after.current).toBe("county");
    expect(after.recent[0]?.raceId).toBe(created.raceId);
  });
});

describe("leagues and the Hall of Fame", () => {
  it("entering a Live race joins this week's league; the views render", { timeout: 120_000 }, async () => {
    const p = await player("League Lodge");
    const v0 = await leagueView(h.db, p, T0);
    expect(v0.joined).toBe(false);
    expect(v0.calendar.length).toBeGreaterThan(0);
    await driveCard(h.db, T0, { force: true });
    expect((await raceList(h.db, T0, p.stable.id)).upcoming.length).toBeGreaterThan(0);
    await quickPickLive(h.db, p, T0);
    const v1 = await leagueView(h.db, p, T0);
    expect(v1.joined).toBe(true);
    expect(v1.tierName).toBe("bronze");
    expect(v1.rows.find((r) => r.mine)).toBeDefined();
    const hall = await hallView(h.db, p, T0);
    expect(hall.mine?.achievements.length).toBe(gc.ACHIEVEMENTS.length);
    expect(Array.isArray(hall.records)).toBe(true);
  });
});
