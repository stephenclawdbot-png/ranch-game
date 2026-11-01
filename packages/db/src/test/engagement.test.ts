/**
 * Coming back to the yard (services/engagement.ts): the away summary's facts come only from
 * records since the last visit and never say how an unwatched race went; tomorrow's hooks come
 * only from state; the week's table ranks every stable fairly and hides the viewer's unwatched
 * races; the Saturday Feature lists who has qualified without spoiling a Qualifier.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { accounts, inboxItems, raceEntries, raceResults, races } from "../schema";
import { createRace } from "../services/races";
import { notify } from "../services/notifications";
import { grantGiftFoal } from "../services/onboarding";
import { awayFacts, nextLocalMidnight, saturdayFeatureOf, tomorrowFacts, weekBoardOf } from "../services/engagement";
import { DAY, MIN, makeHorse, memoryDb, newPlayer } from "./helpers";
import type { Db } from "../types";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const HOUR = 60 * MIN;
/** Wednesday 2026-11-04 12:00 UTC (week of Monday 2 November; the Feature is Saturday the 7th at 19:00). */
const NOW = new Date("2026-11-04T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

let raceN = 0;
async function settledLive(db: Db, input: { postTime: Date; finishers: { horseId: string; stableId: string | null; ratingBefore?: number; ratingAfter?: number }[]; calendar?: string; kind?: "scheduled" | "feature" }) {
  raceN++;
  const race = await createRace(db, {
    kind: input.kind ?? "scheduled",
    name: `Bellmont Stakes ${raceN}`,
    raceClass: "maiden",
    conditions: { distanceM: 1200, surface: "turf", going: "good", ...(input.calendar ? { calendar: { kind: input.calendar } } : {}) },
    postTime: input.postTime,
    entriesCloseAt: new Date(input.postTime.getTime() - MIN),
  });
  await db.update(races).set({ status: "settled", settledAt: input.postTime }).where(eq(races.id, race.id));
  const order = input.finishers.map((f, i) => ({ horseId: f.horseId, position: i + 1, finishTimeUs: 70_000_000 + i * 200_000, marginMm: i === 0 ? 0 : 3000, marginLabel: "1", prize: 0 }));
  for (const [i, f] of input.finishers.entries()) {
    await db.insert(raceEntries).values({ raceId: race.id, horseId: f.horseId, stableId: f.stableId, isHouse: f.stableId === null, gate: i + 1, tactic: "stalker", snapshot: {}, ratingBefore: f.ratingBefore ?? 0, ratingAfter: f.ratingAfter ?? null, finishPosition: i + 1, finishTimeUs: order[i]!.finishTimeUs });
  }
  await db.insert(raceResults).values({ raceId: race.id, seedCommitment: "c", seedReveal: "s", resultHash: "r", result: { finishOrder: order, winningTimeUs: order[0]!.finishTimeUs, photoFinish: false } });
  return race;
}

async function resultNote(db: Db, accountId: string, raceId: string, horseId: string, at: Date, watched: boolean) {
  await notify(db, { accountId, kind: "race_result", dedupeKey: `result:${raceId}:${horseId}`, title: "Finished 1st", raceId, horseId, now: at });
  if (watched) await db.update(inboxItems).set({ readAt: at }).where(eq(inboxItems.dedupeKey, `result:${raceId}:${horseId}`));
}

describe("while you were away", () => {
  it("reads only real events since the last visit, most important first, and never spoils an unwatched race", async () => {
    const p = await newPlayer(h.db, { now: ago(10 * DAY) });
    const other = await newPlayer(h.db, { now: ago(10 * DAY) });
    const from = ago(20 * HOUR);
    const watchedHorse = await makeHorse(h.db, p.stableId, { name: "Bramble" });
    const unwatchedHorse = await makeHorse(h.db, p.stableId, { name: "Tansy", injuredUntil: ago(HOUR), injury: { kind: "sore shins", severity: "minor", careerEnding: false } as never });
    const healed = await makeHorse(h.db, p.stableId, { name: "Hollin", injuredUntil: ago(2 * HOUR) });
    const healedLongAgo = await makeHorse(h.db, p.stableId, { name: "Oldwound", injuredUntil: ago(30 * HOUR) });
    const fresh = await makeHorse(h.db, p.stableId, { name: "Sorrel", fatigue: gc.TIRED_THRESHOLD + 10 * gc.FATIGUE_RECOVERY_PER_HOUR, fatigueAt: ago(21 * HOUR) });
    await makeHorse(h.db, p.stableId, { name: "Wren", origin: "bred", bornAt: ago(3 * HOUR) });
    await makeHorse(h.db, p.stableId, { name: "Oldfoal", origin: "bred", bornAt: ago(3 * DAY) });
    const rival = await makeHorse(h.db, other.stableId);

    const watched = await settledLive(h.db, { postTime: ago(10 * HOUR), finishers: [{ horseId: watchedHorse.id, stableId: p.stableId, ratingBefore: 60, ratingAfter: 64 }, { horseId: rival.id, stableId: other.stableId }] });
    const unwatched = await settledLive(h.db, { postTime: ago(5 * HOUR), finishers: [{ horseId: unwatchedHorse.id, stableId: p.stableId, ratingBefore: 50, ratingAfter: 58 }, { horseId: rival.id, stableId: other.stableId }] });
    await resultNote(h.db, p.accountId, watched.id, watchedHorse.id, ago(10 * HOUR), true);
    await resultNote(h.db, p.accountId, unwatched.id, unwatchedHorse.id, ago(5 * HOUR), false);
    await notify(h.db, { accountId: p.accountId, kind: "training_ready", dedupeKey: "training-week:1", title: "Bramble can train again: a new training week has started", data: { href: `/horse/${watchedHorse.id}` }, horseId: watchedHorse.id, now: ago(8 * HOUR) });
    await notify(h.db, { accountId: p.accountId, kind: "training_ready", dedupeKey: "training-week:0", title: "Old training note", now: ago(2 * DAY) });

    // A Live race later today (the player's local day is UTC).
    const later = await createRace(h.db, { kind: "scheduled", name: "Ashcombe Handicap", raceClass: "maiden", conditions: {}, postTime: new Date(NOW.getTime() + 3 * HOUR), entriesCloseAt: new Date(NOW.getTime() + 3 * HOUR - MIN) });
    await h.db.insert(raceEntries).values({ raceId: later.id, horseId: healed.id, stableId: p.stableId, tactic: "stalker", snapshot: {}, ratingBefore: 0 });

    const f = await awayFacts(h.db, { accountId: p.accountId, stableId: p.stableId, from, now: NOW });
    expect(JSON.stringify(f)).not.toMatch(/position|Finished|prize/);
    expect(f.unwatched).toEqual([{ raceId: unwatched.id, horseName: "Tansy", live: true }]);
    expect(f.liveToday).toEqual([{ raceId: later.id, horseName: "Hollin", raceName: "Ashcombe Handicap", postTimeMs: NOW.getTime() + 3 * HOUR }]);
    expect(f.foalsBorn.map((b) => b.name)).toEqual(["Wren"]);
    // Tansy healed too, but her injury came from a race still to watch: she stays quiet.
    expect(f.recovered.map((r) => r.name)).toEqual(["Hollin"]);
    expect(f.recovered.some((r) => r.horseId === healedLongAgo.id)).toBe(false);
    expect(f.fresh.map((r) => r.horseId)).toEqual([fresh.id]);
    // Only the watched race's rating move.
    expect(f.ratings).toEqual([{ horseId: watchedHorse.id, name: "Bramble", from: 60, to: 64 }]);
    expect(f.training).toEqual([{ title: "Bramble can train again: a new training week has started", href: `/horse/${watchedHorse.id}` }]);

    const lines = gc.awaySummary(f);
    expect(lines.map((l) => l.kind)).toEqual(["result", "live_today", "foal_born", "recovered", "fresh"]);
    expect(lines[0]!.text).toBe("Tansy's Live race has run: watch the finish");
    expect(lines.every((l) => !/won|1st|58|50/.test(l.text))).toBe(true);
  });

  it("says nothing at all after a quiet absence", async () => {
    const p = await newPlayer(h.db, { now: ago(10 * DAY) });
    await makeHorse(h.db, p.stableId);
    const f = await awayFacts(h.db, { accountId: p.accountId, stableId: p.stableId, from: ago(12 * HOUR), now: NOW });
    expect(gc.awaySummary(f)).toEqual([]);
  });

  it("waits for the broadcast: a race still being shown is not 'run' yet", async () => {
    const p = await newPlayer(h.db, { now: ago(10 * DAY) });
    const horse = await makeHorse(h.db, p.stableId);
    const race = await settledLive(h.db, { postTime: ago(MIN), finishers: [{ horseId: horse.id, stableId: p.stableId }] });
    await resultNote(h.db, p.accountId, race.id, horse.id, ago(MIN), false);
    const f = await awayFacts(h.db, { accountId: p.accountId, stableId: p.stableId, from: ago(12 * HOUR), now: NOW });
    expect(f.unwatched).toEqual([]);
  });
});

describe("tomorrow at your yard", () => {
  it("brings the gift foal tomorrow on the founding day only, and stops once it has come", async () => {
    const founded = new Date("2026-11-04T09:00:00.000Z");
    const p = await newPlayer(h.db, { now: founded });
    await h.db.update(accounts).set({ createdAt: founded }).where(eq(accounts.id, p.accountId));
    const t = await tomorrowFacts(h.db, { accountId: p.accountId, stableId: p.stableId, now: NOW });
    expect(t.giftFoalAtMs).toBe(Date.parse("2026-11-05T00:00:00.000Z"));
    // The rule agrees: not due before then, due at it.
    expect((await grantGiftFoal(h.db, { accountId: p.accountId, now: new Date(t.giftFoalAtMs! - 1) })).status).toBe("not_due");
    expect((await grantGiftFoal(h.db, { accountId: p.accountId, now: new Date(t.giftFoalAtMs!) })).status).toBe("granted");
    const after = await tomorrowFacts(h.db, { accountId: p.accountId, stableId: p.stableId, now: new Date(t.giftFoalAtMs! + HOUR) });
    expect(after.giftFoalAtMs).toBeNull();
  });

  it("reads Live races still to run, horses fresh or healed within a day, the Cup, the calendar and the entry allowance", async () => {
    const p = await newPlayer(h.db, { now: ago(10 * DAY) });
    const tired = await makeHorse(h.db, p.stableId, { name: "Tired", fatigue: gc.TIRED_THRESHOLD + 5 * gc.FATIGUE_RECOVERY_PER_HOUR, fatigueAt: NOW });
    await makeHorse(h.db, p.stableId, { name: "Mending", injuredUntil: new Date(NOW.getTime() + 6 * HOUR) });
    await makeHorse(h.db, p.stableId, { name: "Longcure", injuredUntil: new Date(NOW.getTime() + 3 * DAY) });
    const race = await createRace(h.db, { kind: "scheduled", name: "Later", raceClass: "maiden", conditions: {}, postTime: new Date(NOW.getTime() + 2 * HOUR), entriesCloseAt: new Date(NOW.getTime() + HOUR) });
    await h.db.insert(raceEntries).values({ raceId: race.id, horseId: tired.id, stableId: p.stableId, tactic: "stalker", snapshot: {}, ratingBefore: 0 });
    const t = await tomorrowFacts(h.db, { accountId: p.accountId, stableId: p.stableId, now: NOW, story: { chapter: 1, raceName: "Club Maiden" } });
    expect(t.giftFoalAtMs).toBeNull(); // founded days ago
    expect(t.livePending).toBe(1);
    expect(t.freshSoon).toEqual({ names: ["Tired"], atMs: NOW.getTime() + 5 * HOUR });
    expect(t.healSoon).toEqual({ names: ["Mending"], atMs: NOW.getTime() + 6 * HOUR });
    expect(t.cup?.opensAtMs).toBe(Date.parse("2026-11-05T00:00:00.000Z"));
    // Thursday 5 November has a Feature Qualifier at 19:00 UTC.
    expect(t.calendar?.kind).toBe("feature_qualifier");
    expect(new Date(t.calendar!.atMs).toISOString().slice(0, 16)).toBe("2026-11-05T19:00");
    expect(t.story).toEqual({ chapter: 1, raceName: "Club Maiden" });
    const lines = gc.tomorrowHooks(t);
    expect(lines[0]).toMatchObject({ kind: "results" });
    expect(lines.every((l) => !/Longcure/.test(l.text))).toBe(true);
  });

  it("finds the next local midnight in the player's zone", () => {
    expect(nextLocalMidnight("UTC", NOW).toISOString()).toBe("2026-11-05T00:00:00.000Z");
    expect(nextLocalMidnight("America/New_York", NOW).toISOString()).toBe("2026-11-05T05:00:00.000Z");
    expect(nextLocalMidnight("Asia/Tokyo", NOW).toISOString()).toBe("2026-11-04T15:00:00.000Z");
  });
});

describe("this week's table", () => {
  it("ranks stables by League points with shared places, shows your place and movement since this morning, and hides your unwatched races", async () => {
    const db = (await memoryDb()).db;
    const a = await newPlayer(db, { now: ago(10 * DAY) });
    const b = await newPlayer(db, { now: ago(10 * DAY) });
    const c = await newPlayer(db, { now: ago(10 * DAY) });
    const [ha, hb, hc] = [await makeHorse(db, a.stableId), await makeHorse(db, b.stableId), await makeHorse(db, c.stableId)];
    const houses = [await makeHorse(db, null), await makeHorse(db, null), await makeHorse(db, null)].map((x) => ({ horseId: x.id, stableId: null }));
    // Monday: a beats b; c beats the house (fields of four, so placings score).
    await settledLive(db, { postTime: ago(2 * DAY), finishers: [{ horseId: ha.id, stableId: a.stableId }, { horseId: hb.id, stableId: b.stableId }, ...houses.slice(0, 2)] });
    await settledLive(db, { postTime: ago(2 * DAY - HOUR), finishers: [{ horseId: hc.id, stableId: c.stableId }, ...houses] });
    // Today: c wins again, a second (c's owner hasn't watched it yet).
    const today = await settledLive(db, { postTime: ago(HOUR), finishers: [{ horseId: hc.id, stableId: c.stableId }, { horseId: ha.id, stableId: a.stableId }, ...houses.slice(0, 2)] });
    await resultNote(db, c.accountId, today.id, hc.id, ago(HOUR), false);

    const forA = await weekBoardOf(db, { now: NOW, accountId: a.accountId });
    expect(forA.weekStart).toBe("2026-11-02");
    expect(forA.stables).toBe(3);
    // This morning a and c shared first; today's race split them.
    expect(forA.top[0]).toMatchObject({ accountId: c.accountId, rank: 1, move: 0 });
    expect(forA.mine).toMatchObject({ accountId: a.accountId, rank: 2, move: -1 });
    expect(forA.top.find((r) => r.accountId === b.accountId)).toMatchObject({ rank: 3 });
    expect(forA.sinceMs).toBe(Date.parse("2026-11-04T00:00:00.000Z"));

    // c's owner hasn't watched today's race: their table leaves it out entirely.
    const forC = await weekBoardOf(db, { now: NOW, accountId: c.accountId });
    const pts = gc.racePoints(1, 4, 0);
    expect(forC.mine?.points).toBe(pts);
    expect(forC.top.every((r) => r.move === 0)).toBe(true);
    // a and c both won one race on Monday: a shared first place in c's view.
    expect(forC.top.filter((r) => r.rank === 1).map((r) => r.accountId).sort()).toEqual([a.accountId, c.accountId].sort());
    expect(forC.top.every((r) => r.rank !== 1 || r.tied)).toBe(true);

    // Nobody moves on the week's first day; a stable without a Live run has no place.
    const monday = await weekBoardOf(db, { now: new Date("2026-11-02T23:00:00.000Z"), accountId: a.accountId });
    expect(monday.sinceMs).toBeNull();
    expect(monday.top.every((r) => r.move === null)).toBe(true);
    const idle = await newPlayer(db, { now: ago(DAY) });
    expect((await weekBoardOf(db, { now: NOW, accountId: idle.accountId })).mine).toBeNull();
  });
});

describe("the Saturday Feature", () => {
  it("lists qualified horses from public Qualifier results only, and never one from a Qualifier you haven't watched", async () => {
    const db = (await memoryDb()).db;
    const a = await newPlayer(db, { now: ago(10 * DAY) });
    const b = await newPlayer(db, { now: ago(10 * DAY) });
    const ha = await makeHorse(db, a.stableId, { name: "Qualifier Star" });
    const hb = await makeHorse(db, b.stableId, { name: "Late Show" });
    const house = await makeHorse(db, null);
    const mon = await settledLive(db, { postTime: new Date("2026-11-02T19:00:00.000Z"), calendar: "feature_qualifier", finishers: [{ horseId: ha.id, stableId: a.stableId }, { horseId: house.id, stableId: null }] });
    const tue = await settledLive(db, { postTime: new Date("2026-11-03T19:00:00.000Z"), calendar: "feature_qualifier", finishers: [{ horseId: hb.id, stableId: b.stableId }] });
    await resultNote(db, b.accountId, tue.id, hb.id, new Date("2026-11-03T19:00:00.000Z"), false);
    void mon;

    const forA = await saturdayFeatureOf(db, { now: NOW, stableId: a.stableId, accountId: a.accountId });
    expect(forA).not.toBeNull();
    expect(new Date(forA!.postTimeMs).toISOString()).toBe("2026-11-07T19:00:00.000Z");
    expect(forA!.qualified.map((q) => [q.horseName, q.mine])).toEqual([
      ["Qualifier Star", true],
      ["Late Show", false],
    ]);
    expect(forA!.qualifiersLeft.map((ms) => new Date(ms).toISOString().slice(0, 10))).toEqual(["2026-11-04", "2026-11-05", "2026-11-06"]);
    expect(forA!.status).toBe("upcoming");
    // b hasn't watched Tuesday's Qualifier: its own horse's place stays a surprise.
    const forB = await saturdayFeatureOf(db, { now: NOW, stableId: b.stableId, accountId: b.accountId });
    expect(forB!.qualified.map((q) => q.horseName)).toEqual(["Qualifier Star"]);
  });
});
