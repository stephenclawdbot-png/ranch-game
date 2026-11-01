/**
 * Coming back to the yard in the web app: the "While you were away" lines in the player view
 * (no spoilers, most important first), "Tomorrow at your yard" for a day-one stable (the gift
 * foal on the account's second UTC day, from state only), this week's table and the Saturday
 * Feature card from Thursday.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as gc from "@thoroughbred/game-core";
import { authenticate, createDb, createRace, enterRace, grantGiftFoal, rowsOf, type DbHandle } from "@thoroughbred/db";
import { foundStable } from "./founding";
import { onboardingView } from "./guide";
import { engageView, featureCard, tomorrowLines, weekBoard } from "./engage";
import type { Session } from "./session";

let h: DbHandle;
/** Tuesday 3 November 2026, 12:00 UTC. */
const T0 = new Date(Date.UTC(2026, 10, 3, 12, 0, 0));
const SILKS = { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" };
const MIN = 60_000;
const HOUR = 60 * MIN;

beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

let n = 0;
const q = async <T,>(text: string): Promise<T[]> => rowsOf<T>(await h.db.execute(text));
async function founded(now = T0): Promise<Session> {
  const acc = await foundStable(h.db, { stableName: `Engage Yard ${++n}`, silks: SILKS, inviteCode: null, now });
  return (await authenticate(h.db, acc.token))!;
}

/** A settled Live run with an unread result (the placing is in the database, never in the lines). */
async function ranLive(s: Session, position: number, at: Date) {
  const [horse] = await q<{ id: string }>(`select id from horses where owner_stable_id = '${s.stable.id}' order by id limit 1`);
  const race = await createRace(h.db, { kind: "scheduled", name: `Bellmont Live ${++n}`, raceClass: "maiden", conditions: { distanceM: 1200, surface: "turf" }, postTime: new Date(at.getTime() + 30 * MIN), entriesCloseAt: new Date(at.getTime() + 20 * MIN), targetRunners: 8 });
  await enterRace(h.db, { accountId: s.accountId, raceId: race.id, horseId: horse!.id, tactic: "front", now: at });
  await h.db.execute(`update races set status = 'settled', settled_at = '${new Date(at.getTime() + 30 * MIN).toISOString()}' where id = '${race.id}'`);
  await h.db.execute(`update race_entries set finish_position = ${position}, rating_after = rating_before + 7 where race_id = '${race.id}'`);
  await h.db.execute(`update horses set lock_kind = null, lock_ref = null where id = '${horse!.id}'`);
  await h.db.execute(
    `insert into inbox_items (account_id, kind, dedupe_key, title, race_id, horse_id, created_at) values ('${s.accountId}', 'race_result', 'race:${race.id}:${horse!.id}', 'Finished ${position}: won', '${race.id}', '${horse!.id}', '${new Date(at.getTime() + 30 * MIN).toISOString()}')`,
  );
  return race.id;
}

describe("while you were away (player view)", () => {
  it("after hours away: a waiting result first, said without the placing, then one big next action", async () => {
    const s = await founded();
    await onboardingView(h.db, s, T0);
    const raceId = await ranLive(s, 1, new Date(T0.getTime() + HOUR));
    const back = new Date(T0.getTime() + gc.WELCOME_BACK_AFTER_MS + HOUR);
    const w = (await onboardingView(h.db, s, back))!.welcomeBack!;
    expect(w).not.toBeNull();
    expect(w.lines?.[0]).toMatchObject({ kind: "result", href: `/race/${raceId}` });
    expect(w.lines![0]!.text).toMatch(/Live race has run: watch the finish$/);
    expect(w.lines!.length).toBeLessThanOrEqual(gc.AWAY_MAX_LINES);
    // no placing, no win, no rating move from the unwatched race anywhere in the card
    expect(JSON.stringify(w.lines)).not.toMatch(/won|1st|Finished|rating/i);
    expect(w.next.label).toBe("Watch the finish");
  });

  it("a short break raises no card (nothing to catch up on)", async () => {
    const s = await founded();
    await onboardingView(h.db, s, T0);
    expect((await onboardingView(h.db, s, new Date(T0.getTime() + gc.WELCOME_BACK_AFTER_MS - 10 * MIN)))!.welcomeBack).toBeNull();
  });
});

describe("tomorrow at your yard", () => {
  it("day one: the gift foal arrives tomorrow (the account's second UTC day), with the Cup and the Story", async () => {
    const s = await founded();
    const lines = await tomorrowLines(h.db, s, T0);
    expect(lines[0]).toMatchObject({ kind: "gift_foal", atMs: Date.UTC(2026, 10, 4) });
    expect(lines.some((l) => l.kind === "cup")).toBe(true);
    expect(lines.some((l) => l.kind === "results")).toBe(false); // no Live entries yet
    // Thursday 5 November is not tomorrow; Wednesday's Qualifier is.
    expect(lines.find((l) => l.kind === "calendar")).toMatchObject({ atMs: Date.UTC(2026, 10, 4, 19, 0) });
    // The next day the foal is due (and comes): it's no longer a hook.
    const day2 = new Date(Date.UTC(2026, 10, 4, 9, 0));
    expect((await grantGiftFoal(h.db, { accountId: s.accountId, now: day2 })).status).toBe("granted");
    expect((await tomorrowLines(h.db, s, day2)).some((l) => l.kind === "gift_foal")).toBe(false);
  });

  it("a Live entry still to run says its result will be waiting, never how it went", async () => {
    const s = await founded();
    const [horse] = await q<{ id: string }>(`select id from horses where owner_stable_id = '${s.stable.id}' order by id limit 1`);
    const race = await createRace(h.db, { kind: "scheduled", name: `Evening Live ${++n}`, raceClass: "maiden", conditions: { distanceM: 1200, surface: "turf" }, postTime: new Date(T0.getTime() + 3 * HOUR), entriesCloseAt: new Date(T0.getTime() + 2 * HOUR), targetRunners: 8 });
    await enterRace(h.db, { accountId: s.accountId, raceId: race.id, horseId: horse!.id, tactic: "front", now: T0 });
    const lines = await tomorrowLines(h.db, s, T0);
    expect(lines.find((l) => l.kind === "results")?.text).toBe("Your Live race will have run: the finish is waiting to be watched");
  });
});

describe("this week's table and the Saturday Feature", () => {
  it("everyone gets the table (signed out too); the viewer's place is theirs alone", async () => {
    const s = await founded();
    const anon = await engageView(h.db, null, T0);
    expect(anon.tomorrow).toEqual([]);
    expect(anon.board.mine).toBeNull();
    const mine = await weekBoard(h.db, s, T0);
    // No Live run this week yet: off the table, but your own row still shows (unplaced).
    expect(mine.mine).toMatchObject({ rank: 0, runs: 0, points: 0, mine: true, stableName: s.stable.name });
    expect(mine.top.every((r) => !r.mine && r.runs > 0)).toBe(true);
    expect(JSON.stringify(mine)).not.toMatch(/accountId/);
  });

  it("shows the Feature card from Thursday 00:00 UTC, with the post time and how to qualify", async () => {
    const s = await founded();
    expect(await featureCard(h.db, s, T0)).toBeNull(); // Tuesday
    expect(await featureCard(h.db, s, new Date(Date.UTC(2026, 10, 4, 23, 59)))).toBeNull(); // Wednesday night
    const thu = await featureCard(h.db, s, new Date(Date.UTC(2026, 10, 5, 0, 0)));
    expect(thu).not.toBeNull();
    expect(new Date(thu!.postTimeMs).toISOString()).toBe("2026-11-07T19:00:00.000Z");
    expect(thu!.qualifyTop).toBe(gc.FEATURE_QUALIFY_TOP);
    expect(thu!.ratingByRight).toBe(gc.FEATURE_RATING_BY_RIGHT);
    expect(thu!.qualifiersLeft.map((ms) => new Date(ms).toISOString().slice(0, 16))).toEqual(["2026-11-05T19:00", "2026-11-06T19:00"]);
    // Saturday evening after the race (plus a few hours): gone until next Thursday.
    expect(await featureCard(h.db, s, new Date(Date.UTC(2026, 10, 7, 22, 0)))).toBeNull();
  });
});
