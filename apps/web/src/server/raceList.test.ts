/** The race list: the whole day of race meetings, the evening's Feature Qualifier in the morning, stables entered per race. */
import { afterAll, beforeAll, expect, it } from "vitest";
import * as gc from "@thoroughbred/game-core";
import { createAccount, createDb, getRace, stableOf, type DbHandle } from "@thoroughbred/db";
import { enterLive, entryOptions, raceCard, raceList } from "./game";

let h: DbHandle;
beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

it("a morning visit sees and can enter the 19:00 Feature Qualifier", { timeout: 120_000 }, async () => {
  const t = new Date(Date.UTC(2026, 10, 11, 8, 0, 0)); // a Wednesday morning
  const acc = await createAccount(h.db, { stableName: "Morning Stable", startingCredits: 50_000, silks: { pattern: "hoops", primary: "#1f4e9c", secondary: "#f3e7c9", cap: "#1f4e9c" }, timezone: "Europe/London", now: t });
  await h.db.execute(`update stables set licence_level = 3 where account_id = '${acc.accountId}'`);
  const s = { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) };
  const list = await raceList(h.db, t, s.stable.id, { upcoming: 8, recent: 0 });
  const q = list.upcoming.find((r) => r.name.includes("Feature Qualifier"));
  expect(q).toBeDefined();
  expect(new Date(q!.postTimeMs).getUTCHours()).toBe(19);
  const sheet = await entryOptions(h.db, s, q!.id, t);
  expect(sheet.options.some((o) => o.reason === null)).toBe(true);
});

it("a 10:00 visit sees the whole day of race meetings, with the stables entered in each race; an empty race is called off at the close", { timeout: 120_000 }, async () => {
  const t = new Date(Date.UTC(2026, 10, 12, 10, 0, 0)); // a Thursday, between the morning and afternoon meetings
  const mk = async (name: string) => {
    const acc = await createAccount(h.db, { stableName: name, startingCredits: 20_000, silks: { pattern: "hoops", primary: "#1f4e9c", secondary: "#f3e7c9", cap: "#1f4e9c" }, timezone: "Europe/London", starterHorses: 3, now: t });
    return { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) };
  };
  const a = await mk("Evening Stable A");
  const b = await mk("Evening Stable B");
  const list = await raceList(h.db, t, a.stable.id, { upcoming: 120, recent: 0 });
  // the published day: 24 meeting races (tomorrow's 07:00 meeting included), grouped by meeting
  expect(list.upcoming.length).toBe(gc.LIVE_RACES_PER_DAY);
  const meetings = [...new Set(list.upcoming.map((r) => r.meetingStartMs))];
  expect(meetings.map((ms) => new Date(ms).getUTCHours())).toEqual([13, 19, 7]);
  for (const r of list.upcoming) expect(r.postTimeMs - r.meetingStartMs).toBeLessThan(gc.RACES_PER_MEETING * gc.MEETING_RACE_SPACING_MS);
  const evening = list.upcoming.filter((r) => new Date(r.meetingStartMs).getUTCHours() === 19);
  expect(evening).toHaveLength(gc.RACES_PER_MEETING);
  expect(evening.every((r) => r.stables === 0 && r.phase === "open")).toBe(true);

  // both stables enter the same evening race: the card shows "2 stables entered"
  let target: string | null = null;
  for (const r of evening) {
    const ha = (await entryOptions(h.db, a, r.id, t)).options.find((o) => o.reason === null);
    const hb = (await entryOptions(h.db, b, r.id, t)).options.find((o) => o.reason === null);
    if (!ha || !hb) continue;
    await enterLive(h.db, a, r.id, ha.horseId, { tactic: "stalker", intensity: "normal" }, t);
    await enterLive(h.db, b, r.id, hb.horseId, { tactic: "stalker", intensity: "normal" }, t);
    target = r.id;
    break;
  }
  expect(target).not.toBeNull();
  const after = await raceList(h.db, new Date(t.getTime() + 60_000), b.stable.id, { upcoming: 120, recent: 0 });
  const entered = after.upcoming.find((r) => r.id === target)!;
  expect(entered.stables).toBe(2);
  expect(entered.mine).toBe(1);

  // the afternoon meeting's first race closes with nobody in it: called off, gone from the card
  const first = list.upcoming[0]!;
  expect(first.stables).toBe(0);
  const later = await raceList(h.db, new Date(first.entriesCloseAtMs + 1_000), null, { upcoming: 120, recent: 6 });
  expect(later.upcoming.some((r) => r.id === first.id)).toBe(false);
  expect(later.recent.some((r) => r.id === first.id)).toBe(false);
  expect((await getRace(h.db, first.id))!.status).toBe("cancelled");
  // the race with two stables runs: Club horses fill it to its field size when it closes
  const card = await raceCard(h.db, target!, new Date(entered.entriesCloseAtMs + 1_000), a.stable.id);
  expect(card.fieldLocked).toBe(true);
  expect(card.field.filter((e) => e.isPlayer).map((e) => e.stableName).sort()).toEqual(["Evening Stable A", "Evening Stable B"]);
  expect(card.field).toHaveLength(Math.max(2, card.targetRunners));
  expect(card.targetRunners).toBeGreaterThanOrEqual(5);
});
