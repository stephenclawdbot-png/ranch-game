import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DbHandle } from "../client";
import { horses, inboxItems, newsItems, raceTargets } from "../schema";
import { gc } from "../gameCore";
import { RULES } from "../rules";
import { createRace, enterRace, getRaceForSimulation, scratchEntry, settleRace } from "../services/races";
import { slotIndexAt, slotKeyOf, slotPostTime } from "../services/card";
import { listNews, putNews, resultPublicAt } from "../services/news";
import { raceRivalLinesFor, recordAgainst, rivalsView } from "../services/rivals";
import { addTarget, planView, sweepTargets } from "../services/planner";
import { DAY, MIN, T0, at, expectDbError, makeHorse, memoryDb, newPlayer } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const FINISH_US = 70_000_000; // the last finisher crosses the line 70 s after the off

let slot = 0;
/**
 * A Live race entered by the given horses (one per stable), settled 61 s after the off with
 * `order` in front and the given margins (mm behind the horse ahead, by position from 2nd).
 */
async function race(entries: { accountId: string; horseId: string }[], opts: { order: string[]; margins?: number[]; kind?: "scheduled" | "feature"; raceClass?: string; purse?: number; day?: number; name?: string }) {
  const base = (opts.day ?? 0) * DAY + ++slot * 20 * MIN;
  const r = await createRace(h.db, {
    kind: opts.kind ?? "scheduled",
    name: opts.name ?? `Rival Stakes ${slot}`,
    raceClass: opts.raceClass ?? "maiden",
    conditions: { distanceM: 1200, surface: "turf", track: "Saltmarsh" },
    postTime: at(base + 10 * MIN),
    entriesCloseAt: at(base + 9 * MIN),
    targetRunners: Math.max(2, entries.length),
    purse: opts.purse ?? 1_000,
  });
  for (const e of entries) await enterRace(h.db, { ...e, raceId: r.id, tactic: "stalker", now: at(base) });
  const now = at(base + 10 * MIN + 61_000);
  const { field } = await getRaceForSimulation(h.db, r.id, now);
  const order = [...opts.order, ...field.runners.map((x) => x.horseId).filter((id) => !opts.order.includes(id))];
  const finishOrder = order.map((horseId, i) => ({
    horseId,
    position: i + 1,
    finishTimeUs: FINISH_US - (order.length - 1 - i) * 100_000,
    marginMm: i === 0 ? 0 : (opts.margins?.[i - 1] ?? 5_000),
    marginLabel: i === 0 ? "" : (opts.margins?.[i - 1] ?? 5_000) < 150 ? "nose" : "2",
    prize: 0,
  }));
  const result = { finishOrder, winningTimeUs: finishOrder[0]!.finishTimeUs, photoFinish: (opts.margins?.[0] ?? 5_000) < 150, resultHash: "0".repeat(64) };
  await settleRace(h.db, { raceId: r.id, now, resultHash: "0".repeat(64), result, runners: order.map((horseId, i) => ({ horseId, position: i + 1 })) });
  // the broadcast is over 2 s + 70 s + the grace after the off
  const after = new Date(r.postTime.getTime() + 80_000);
  return { race: r, now, after };
}

describe("rivals and head-to-head", () => {
  it("ranks rival stables from close finishes, keeps H2H records and finds the nemesis; Club runners are never rivals", async () => {
    const a = await newPlayer(h.db);
    const b = await newPlayer(h.db);
    const c = await newPlayer(h.db);
    const a1 = await makeHorse(h.db, a.stableId, { name: "Sea Lavender" });
    const b1 = await makeHorse(h.db, b.stableId, { name: "Copper Comet" });
    const c1 = await makeHorse(h.db, c.stableId, { name: "Far Away" });
    const ea = { accountId: a.accountId, horseId: a1.id };
    const eb = { accountId: b.accountId, horseId: b1.id };
    const ec = { accountId: c.accountId, horseId: c1.id };
    // B beats A three times by a neck or less; C is always miles away
    await race([ea, eb, ec], { order: [b1.id, a1.id, c1.id], margins: [200, 9_000] });
    await race([ea, eb, ec], { order: [b1.id, a1.id, c1.id], margins: [100, 9_000], day: 1 });
    await race([ea, eb], { order: [b1.id, a1.id], margins: [600], day: 2 });
    const last = await race([ea, eb, ec], { order: [a1.id, b1.id, c1.id], margins: [300, 9_000], day: 3 });

    const v = await rivalsView(h.db, a.stableId, last.after);
    expect(v.rivals.map((r) => r.stableId)).toEqual([b.stableId]);
    expect(v.rivals[0]).toMatchObject({ stableName: expect.any(String), meetings: 4, ahead: 1, behind: 3, close: 4, closeAhead: 1 });
    expect(v.rivals[0]!.last).toMatchObject({ raceId: last.race.id, ahead: true });
    expect(v.nemesis).toMatchObject({ horseId: b1.id, horseName: "Copper Comet", closeBeats: 3 });
    expect(v.rivals.some((r) => !r.stableId)).toBe(false);

    const rec = await recordAgainst(h.db, a.stableId, c.stableId, last.after);
    expect(rec.record).toMatchObject({ meetings: 3, ahead: 3, close: 0 });
    expect(rec.pairs[0]).toMatchObject({ mineId: a1.id, theirId: c1.id, meetings: 3 });

    // the post-race line, only once the result is public
    expect(await raceRivalLinesFor(h.db, a.stableId, last.race.id, last.now)).toEqual([]);
    const lines = await raceRivalLinesFor(h.db, a.stableId, last.race.id, last.after);
    expect(lines[0]).toMatch(/^You beat Stable \d+'s Copper Comet for the first time in 4 meetings\.$/);
  });

  it("a Club horse beating you by a nose every time is never a rival or a nemesis", async () => {
    const a = await newPlayer(h.db);
    const a1 = await makeHorse(h.db, a.stableId);
    let after = T0;
    for (let d = 0; d < 4; d++) {
      // the Club fills the second gate and wins each time by a nose
      const r = await race([{ accountId: a.accountId, horseId: a1.id }], { order: [], margins: [50], day: 10 + d });
      after = r.after;
    }
    const v = await rivalsView(h.db, a.stableId, after);
    expect(v.rivals).toEqual([]);
    expect(v.nemesis).toBeNull();
  });

  it("nothing about a race shows before its broadcast end", async () => {
    const a = await newPlayer(h.db);
    const b = await newPlayer(h.db);
    const a1 = await makeHorse(h.db, a.stableId);
    const b1 = await makeHorse(h.db, b.stableId);
    const runs = [];
    for (let d = 0; d < 3; d++) runs.push(await race([{ accountId: a.accountId, horseId: a1.id }, { accountId: b.accountId, horseId: b1.id }], { order: [b1.id, a1.id], margins: [100], day: 20 + d, kind: "feature", name: `Saltmarsh Feature ${d}` }));
    const last = runs[2]!;
    expect(resultPublicAt(last.race, { finishOrder: [{ finishTimeUs: FINISH_US }] }).getTime()).toBe(last.race.postTime.getTime() + 2_000 + 70_000 + 2_750);
    // settled, but the broadcast is still running: no rival, no line, no news
    expect((await rivalsView(h.db, a.stableId, last.now)).rivals).toEqual([]);
    expect((await rivalsView(h.db, a.stableId, last.after)).rivals.map((r) => r.stableId)).toEqual([b.stableId]);
    const before = await listNews(h.db, { now: last.now, limit: 100 });
    expect(before.some((n) => n.raceId === last.race.id)).toBe(false);
    const after = await listNews(h.db, { now: last.after, limit: 100 });
    expect(after.filter((n) => n.raceId === last.race.id).map((n) => n.kind).sort()).toEqual(["feature_win", "photo_finish"]);
  });
});

describe("news", () => {
  it("race news is written once, reads the same every time, and the My stable tab narrows it", async () => {
    const a = await newPlayer(h.db);
    const b = await newPlayer(h.db);
    const a1 = await makeHorse(h.db, a.stableId, { name: "Thistle Down" });
    const b1 = await makeHorse(h.db, b.stableId, { name: "Marsh Light" });
    const { race: r, now, after } = await race([{ accountId: a.accountId, horseId: a1.id }, { accountId: b.accountId, horseId: b1.id }], { order: [a1.id, b1.id], margins: [60], raceClass: "listed", day: 30, name: "Saltmarsh Listed Stakes" });
    const rows = await h.db.select().from(newsItems).where(eq(newsItems.raceId, r.id));
    expect(rows.map((x) => x.kind).sort()).toEqual(["first_big_win", "photo_finish"]);
    const photo = rows.find((x) => x.kind === "photo_finish")!;
    expect(photo.headline).toBe(gc.newsHeadline("photo_finish", photo.data as gc.NewsFacts, photo.dedupeKey));
    expect(photo.headline).toMatch(/Thistle Down/);
    expect(photo.headline).toMatch(/a nose/);
    expect(photo.href).toBe(`/race/${r.id}`);
    // settling again (or writing the same item) adds nothing
    await settleRace(h.db, { raceId: r.id, now, resultHash: "0".repeat(64), result: {}, runners: [] });
    expect(await putNews(h.db, { dedupeKey: photo.dedupeKey, kind: "photo_finish", facts: {}, href: "/", publicAt: now })).toBe(false);
    expect(await h.db.select().from(newsItems).where(eq(newsItems.raceId, r.id))).toHaveLength(2);
    // a second Listed win is not a "first"
    const again = await race([{ accountId: a.accountId, horseId: a1.id }, { accountId: b.accountId, horseId: b1.id }], { order: [a1.id, b1.id], raceClass: "listed", day: 31 });
    expect((await h.db.select().from(newsItems).where(eq(newsItems.raceId, again.race.id))).map((x) => x.kind)).toEqual([]);
    // My stable: items involving the given stables only
    const other = await newPlayer(h.db);
    expect((await listNews(h.db, { now: after, stableIds: [a.stableId] })).some((n) => n.raceId === r.id)).toBe(true);
    expect((await listNews(h.db, { now: after, stableIds: [other.stableId] })).some((n) => n.raceId === r.id)).toBe(false);
  });

  it("templates: three or more per kind, picked by key", () => {
    for (const k of gc.NEWS_KINDS) expect(gc.NEWS_TEMPLATES[k].length).toBeGreaterThanOrEqual(3);
    const f = { horse: "Copper Comet", stable: "Thistle Mead", race: "Saltmarsh Handicap", amount: 2_500 };
    expect(gc.newsHeadline("sale", f, "sale:1")).toBe(gc.newsHeadline("sale", f, "sale:1"));
  });
});

describe("campaign planner", () => {
  const nowSlot = slotIndexAt(T0);
  /** A published Live card race in the slot `k` slots after T0's. */
  async function cardRace(k: number, opts: { maxWins?: number; maxRating?: number } = {}) {
    const index = nowSlot + k;
    const post = slotPostTime(index);
    return createRace(h.db, {
      kind: "scheduled",
      name: `Saltmarsh Handicap ${index}`,
      raceClass: opts.maxWins === 0 ? "maiden" : "handicap",
      conditions: { distanceM: 2000, surface: "turf", ...(opts.maxWins !== undefined ? { maxWins: opts.maxWins } : {}), ...(opts.maxRating !== undefined ? { maxRating: opts.maxRating } : {}) },
      postTime: post,
      entriesCloseAt: new Date(post.getTime() - 30_000),
      targetRunners: 4,
      slotKey: slotKeyOf(index),
    });
  }

  it("checks eligibility, the freshness peak and clashes; at most five targets", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId, { starts: 4, wins: 2, dynamics: { lastHardWorkMs: T0.getTime() - 60 * 3_600_000 } as never });
    const maiden = await cardRace(8, { maxWins: 0 });
    await expectDbError(addTarget(h.db, { accountId: p.accountId, horseId: horse.id, raceId: maiden.id, now: T0 }), /maiden|wins/);
    const r1 = await cardRace(10); // 2.5 h ahead
    const r2 = await cardRace(16); // same UTC day: a clash
    const t1 = await addTarget(h.db, { accountId: p.accountId, horseId: horse.id, raceId: r1.id, now: T0 });
    expect((await addTarget(h.db, { accountId: p.accountId, horseId: horse.id, raceId: r1.id, now: T0 })).id).toBe(t1.id);
    await addTarget(h.db, { accountId: p.accountId, horseId: horse.id, raceId: r2.id, now: T0 });
    const v = await planView(h.db, { stableId: p.stableId, horseId: horse.id, now: T0 });
    expect(v.targets).toHaveLength(2);
    const [a, b] = v.targets;
    expect(a!.eligibility).toBeNull();
    expect(a!.entry.state).toBe("open");
    // 60 h since hard work + 2.5 h: still before the peak (72-120 h)
    expect(a!.freshness.phase).toBe("building");
    expect(a!.freshness.peakFromMs).toBe(T0.getTime() + 12 * 3_600_000);
    expect(a!.clashes[0]).toMatch(/one Live race per horse per day/);
    expect(b!.clashes).toHaveLength(1);
    // a calendar race beyond the card can be pinned before it is published
    const cal = gc.featureCalendar({ epochMs: RULES.seasonEpochMs }, 11).find((x) => x.kind === "weekend_feature" && x.postTimeMs > T0.getTime() + RULES.cardHorizonMs)!;
    const calIndex = Math.floor((cal.postTimeMs - RULES.seasonEpochMs) / RULES.slotMs);
    const tc = await addTarget(h.db, { accountId: p.accountId, horseId: horse.id, slotIndex: calIndex, now: T0 });
    expect(tc.raceId).toBeNull();
    const withCal = await planView(h.db, { stableId: p.stableId, horseId: horse.id, now: T0 });
    const ct = withCal.targets.find((t) => t.id === tc.id)!;
    expect(ct).toMatchObject({ calendar: true, entry: { state: "not_open" } });
    expect(ct.name).toMatch(/Ashcombe Weekend Feature/);
    expect(ct.eligibility).toMatch(/Weekend Feature/);
    for (const k of [40, 120]) await addTarget(h.db, { accountId: p.accountId, horseId: horse.id, raceId: (await cardRace(k)).id, now: T0 });
    await expectDbError(addTarget(h.db, { accountId: p.accountId, horseId: horse.id, raceId: (await cardRace(200)).id, now: T0 }), /at most 5 targets/);
  });

  it("reminds once when entries open and once two hours before they close", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId);
    const r = await cardRace(41); // 10 h ahead
    await addTarget(h.db, { accountId: p.accountId, horseId: horse.id, raceId: r.id, now: T0 });
    const mine = () => h.db.select().from(inboxItems).where(and(eq(inboxItems.accountId, p.accountId), eq(inboxItems.kind, "plan_reminder")));
    await sweepTargets(h.db, T0);
    await sweepTargets(h.db, at(MIN));
    expect((await mine()).map((x) => x.dedupeKey)).toEqual([expect.stringMatching(/^plan-open:/)]);
    const late = new Date(r.entriesCloseAt.getTime() - 3_600_000);
    await sweepTargets(h.db, late);
    await sweepTargets(h.db, new Date(late.getTime() + MIN));
    expect((await mine()).map((x) => x.dedupeKey.split(":")[0]).sort()).toEqual(["plan-closing", "plan-open"]);
    // entered: no reminder for another target
    const r2 = await cardRace(45);
    await addTarget(h.db, { accountId: p.accountId, horseId: horse.id, raceId: r2.id, now: T0 });
    await enterRace(h.db, { accountId: p.accountId, horseId: horse.id, raceId: r2.id, tactic: "stalker", now: T0 });
    await sweepTargets(h.db, at(2 * MIN));
    expect((await mine()).filter((x) => x.raceId === r2.id)).toEqual([]);
  });

  it("drops targets by itself: ran, scratched, ineligible, missed", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId, { name: "Planned Horse" });
    const other = await makeHorse(h.db, p.stableId);
    const ran = await cardRace(60);
    const scratched = await cardRace(64);
    const missed = await cardRace(68);
    const band = await cardRace(72, { maxRating: 55 });
    for (const r of [ran, scratched, missed]) await addTarget(h.db, { accountId: p.accountId, horseId: horse.id, raceId: r.id, now: T0 });
    await addTarget(h.db, { accountId: p.accountId, horseId: other.id, raceId: band.id, now: T0 });
    // scratched
    await enterRace(h.db, { accountId: p.accountId, horseId: horse.id, raceId: scratched.id, tactic: "stalker", now: T0 });
    await scratchEntry(h.db, { accountId: p.accountId, raceId: scratched.id, horseId: horse.id, now: at(MIN) });
    // ran
    await enterRace(h.db, { accountId: p.accountId, horseId: horse.id, raceId: ran.id, tactic: "stalker", now: at(2 * MIN) });
    const settleAt = new Date(ran.postTime.getTime() + 61_000);
    const { field } = await getRaceForSimulation(h.db, ran.id, settleAt);
    await settleRace(h.db, { raceId: ran.id, now: settleAt, resultHash: "0".repeat(64), result: {}, runners: field.runners.map((x, i) => ({ horseId: x.horseId, position: i + 1 })) });
    // ineligible: rated above the band at its best
    await h.db.update(horses).set({ rating: 70, dynamics: { peakOr: 70 } }).where(eq(horses.id, other.id));
    // missed: entries closed without an entry
    await sweepTargets(h.db, new Date(missed.entriesCloseAt.getTime() + 1));
    const rows = await h.db.select().from(raceTargets).where(eq(raceTargets.stableId, p.stableId));
    const reason = (raceId: string) => rows.find((t) => t.raceId === raceId)?.removedReason ?? "";
    expect(reason(ran.id)).toMatch(/^ran: ran in the Saltmarsh Handicap/);
    expect(reason(scratched.id)).toMatch(/^scratched:/);
    expect(reason(missed.id)).toMatch(/^missed: entries for the .* closed without an entry/);
    expect(reason(band.id)).toMatch(/^ineligible: .* rated 70 at best/);
    const v = await planView(h.db, { stableId: p.stableId, now: new Date(missed.entriesCloseAt.getTime() + 2) });
    expect(v.targets).toEqual([]);
    expect(v.removed.map((x) => x.note)).toContain("scratched from the " + scratched.name);
  });
});
