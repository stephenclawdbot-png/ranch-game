/**
 * The demand-aware Live card (services/card.ts ensureRaceCard with cardPlanMode "demand", the
 * default; game-core cardPlan.ts): a meeting's ordinary races are chosen from the horses that
 * exist, once, when the meeting is published. The fixed card's own tests are in
 * live-races.test.ts; the plan's rules are unit-tested in game-core cardPlan.test.ts.
 */
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { RULES } from "../rules";
import { gc } from "../gameCore";
import { horses, raceSponsorships, races, stables, type RaceRow } from "../schema";
import {
  cardDemand,
  cardMarkOf,
  cardPlanMode,
  claimingSlotOfDay,
  defaultCardSlot,
  ensureRaceCard,
  expectedMeetingEntries,
  isCalendarSlot,
  isCardSlot,
  isClaimingSlot,
  meetingRaceOf,
  ordinarySlotsOf,
  slotIndexAt,
  slotIndexOf,
  slotKeyOf,
  slotPostTime,
  tickRaceCard,
} from "../services/card";
import { isClaimingRace } from "../services/claiming";
import { enterRace, type PublicRace, type RaceConditions } from "../services/races";
import { sponsorOf, sponsorRace } from "../services/sponsorship";
import { at, count, DAY, makeHorse, makeSeller, memoryDb, MIN, newPlayer } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const DEMAND = { plan: "demand" } as const;
const FIXED = { plan: "fixed" } as const;
const CLOCK = { epochMs: RULES.seasonEpochMs };
const HOUR = 60 * MIN;
const isCalendar = (r: Pick<RaceRow, "conditions">) => !!((r.conditions ?? {}) as RaceConditions).calendar;
const ordinary = (card: PublicRace[]) => card.filter((r) => !isCalendar(r));
/** Card races by meeting number (calendar races apart). */
function byMeeting(card: PublicRace[]): Map<number, PublicRace[]> {
  const out = new Map<number, PublicRace[]>();
  for (const r of ordinary(card)) {
    const m = meetingRaceOf(slotIndexOf(r.slotKey)!)!;
    out.set(m.number, [...(out.get(m.number) ?? []), r]);
  }
  return out;
}
/** Every row on the meeting's slot keys, wherever its post time is. */
async function meetingRows(m: gc.Meeting): Promise<RaceRow[]> {
  return h.db.select().from(races).where(inArray(races.slotKey, ordinarySlotsOf(m).map(slotKeyOf)));
}
/** A stable that plays at `now`, with `n` young horses (rated about 40, no wins). */
async function youngStable(now: Date, n = 2) {
  const p = await newPlayer(h.db, { now });
  const own = [];
  for (let k = 0; k < n; k++) own.push(await makeHorse(h.db, p.stableId, { rating: 38 + k, wins: 0, starts: 2 }));
  return { ...p, horses: own };
}

describe("the demand-aware card", () => {
  it("is the default; LIVE_CARD_PLAN=fixed switches back", () => {
    expect(cardPlanMode({})).toBe("demand");
    expect(cardPlanMode({ LIVE_CARD_PLAN: "demand" })).toBe("demand");
    expect(cardPlanMode({ LIVE_CARD_PLAN: "fixed" })).toBe("fixed");
  });

  it("an empty world: one ordinary race a meeting in a class every new horse can enter, calendar races as always, exactly once across concurrent instances", async () => {
    const now = at(100 * DAY);
    const cards = await Promise.all([ensureRaceCard(h.db, now, DEMAND), ensureRaceCard(h.db, now, DEMAND), ensureRaceCard(h.db, now, DEMAND)]);
    const card = await ensureRaceCard(h.db, now, DEMAND);
    // the same rows and seed commitments, whichever instance published them
    for (const c of cards) expect(c.map((r) => [r.id, r.seedCommitment])).toEqual(card.map((r) => [r.id, r.seedCommitment]));
    const first = slotIndexAt(now) + 1;
    const window = Array.from({ length: RULES.cardHorizonMs / RULES.slotMs }, (_, i) => first + i);
    // every calendar race of the window, in its own slot, unmarked
    const calendar = window.filter(isCalendarSlot);
    expect(calendar.length).toBeGreaterThan(0);
    expect(card.filter(isCalendar).map((r) => r.slotKey)).toEqual(calendar.map(slotKeyOf));
    for (const r of card.filter(isCalendar)) expect(r.name).toBe(defaultCardSlot(slotIndexOf(r.slotKey)!).name);
    // every meeting of the day: one race, in its first free slot, of a starter class
    const meetings = byMeeting(card);
    expect(meetings.size).toBe(gc.MEETINGS_PER_DAY);
    for (const [number, rs] of meetings) {
      expect(rs).toHaveLength(gc.CARD_MIN_RACES_PER_MEETING);
      const r = rs[0]!;
      const m = meetingRaceOf(slotIndexOf(r.slotKey)!)!;
      expect(m.number).toBe(number);
      expect(slotIndexOf(r.slotKey)).toBe(ordinarySlotsOf(m)[0]);
      expect(["maiden", "novice", "handicap"]).toContain(r.raceClass);
      expect((r.conditions as RaceConditions).maxRating).toBeLessThanOrEqual(70);
      expect(cardMarkOf(r)).toMatchObject({ reason: "demand", stables: 0 });
      // an ordinary card race in every other way
      expect(r.entriesCloseAt.getTime()).toBe(r.postTime.getTime() - RULES.entriesCloseBeforePostMs);
      expect(r.postTime.getTime()).toBe(slotPostTime(slotIndexOf(r.slotKey)!).getTime());
      expect(r.targetRunners).toBeGreaterThanOrEqual(RULES.minField);
      expect(r.targetRunners).toBeLessThanOrEqual(RULES.maxField);
      expect(r.purse).toBeGreaterThan(0);
      expect(r.entryFee).toBe(Math.round((r.purse * 50) / 1000));
    }
    // the three starter classes take turns
    expect(new Set(ordinary(card).map((r) => `${r.raceClass}:${(r.conditions as RaceConditions).maxWins ?? "any"}`)).size).toBe(3);
    // one row per published slot, none in the slots the plan left empty
    expect(await count(h.db, "races", `slot_key in (${window.map((i) => `'${slotKeyOf(i)}'`).join(",")})`)).toBe(card.length);
    // later ticks never fill a planned meeting's empty slots; they publish the meetings that come into the horizon
    const later = await ensureRaceCard(h.db, new Date(now.getTime() + 6 * HOUR), DEMAND);
    const before = new Map(card.map((r) => [r.slotKey, r.id]));
    for (const [, rs] of byMeeting(later)) expect(rs).toHaveLength(1);
    for (const r of later) if (before.has(r.slotKey)) expect(r.id).toBe(before.get(r.slotKey));
    expect(byMeeting(later).size).toBe(gc.MEETINGS_PER_DAY);
    expect(later.some((r) => !before.has(r.slotKey))).toBe(true);
  });

  it("the card follows the horses: classes the active stables can enter, a cover race for the few in a band of their own, never a band nobody is in", async () => {
    const now = at(120 * DAY);
    const young = [];
    for (let k = 0; k < 8; k++) young.push(await youngStable(now));
    // two stables with a County licence and a horse too good for the open classes (four wins, rated 62)
    const better = [];
    for (let k = 0; k < 2; k++) {
      const p = await newPlayer(h.db, { now });
      await h.db.update(stables).set({ licenceLevel: 2 }).where(eq(stables.id, p.stableId));
      better.push(await makeHorse(h.db, p.stableId, { rating: 62, wins: 4, starts: 12, dynamics: { peakOr: 62 } }));
    }
    // a stable that stopped playing long ago does not count
    const gone = await newPlayer(h.db, { now: at(60 * DAY) });
    await makeHorse(h.db, gone.stableId, { rating: 90, wins: 6, starts: 20 });
    const demand = await cardDemand(h.db, now);
    expect(new Set(demand.map((d) => d.stable)).size).toBe(10);
    expect(demand.filter((d) => d.rating === 62).map((d) => d.licence)).toEqual([2, 2]);
    expect(demand.some((d) => d.rating === 90)).toBe(false);

    const card = await ensureRaceCard(h.db, now, DEMAND);
    const meetings = [...byMeeting(card).entries()].sort((a, b) => a[0] - b[0]);
    expect(meetings).toHaveLength(gc.MEETINGS_PER_DAY);
    let covers = 0;
    let last: PublicRace[] = [];
    for (const [, rs] of meetings) {
      const demandRaces = rs.filter((r) => cardMarkOf(r)?.reason === "demand");
      const coverRaces = rs.filter((r) => cardMarkOf(r)?.reason === "cover");
      expect(demandRaces).toHaveLength(1);
      expect(cardMarkOf(demandRaces[0]!)!.stables).toBeGreaterThanOrEqual(6);
      expect((demandRaces[0]!.conditions as RaceConditions).maxRating).toBeLessThanOrEqual(70);
      for (const c of coverRaces) {
        expect(c.name).toMatch(/Handicap \(50-75\)$/);
        expect(cardMarkOf(c)!.stables).toBe(2);
        // after the meeting's main race
        expect(c.postTime.getTime()).toBeGreaterThan(demandRaces[0]!.postTime.getTime());
      }
      covers += coverRaces.length;
      // the two good horses have a race here or had one in the meeting before
      if (last.length) expect(coverRaces.length + last.filter((r) => cardMarkOf(r)?.reason === "cover").length).toBe(1);
      last = rs;
      for (const r of rs) expect(["listed", "graded"]).not.toContain(r.raceClass);
    }
    expect(covers).toBe(gc.MEETINGS_PER_DAY / gc.CARD_COVER_EVERY_MEETINGS);
    // the trips are ones the horses are suited to
    for (const r of ordinary(card).filter((x) => cardMarkOf(x)?.reason === "demand")) {
      const d = (r.conditions as RaceConditions).distanceM!;
      expect(demand.filter((x) => gc.tripSuits(x.distanceM, d)).length).toBeGreaterThanOrEqual(gc.CARD_TRIP_MIN_HORSES);
    }
    void young;
    void better;
  });

  it("the size follows the entries: a meeting that drew eight stables gets two races the next day", async () => {
    const now = at(140 * DAY);
    const players = [];
    for (let k = 0; k < 2 * gc.CARD_TARGET_STABLES_PER_RACE; k++) players.push(await youngStable(now, 1));
    const card = await ensureRaceCard(h.db, now, DEMAND);
    // the first meeting that is still wholly ahead
    const m = gc.meetingFor(CLOCK, now.getTime() + 4 * HOUR);
    const [race] = (await meetingRows(m)).filter((r) => !isCalendar(r));
    expect(race).toBeDefined();
    expect(card.some((r) => r.id === race!.id)).toBe(true);
    // novice or 0-55: every young horse may run (a maiden would too: none has a win)
    for (const p of players) await enterRace(h.db, { accountId: p.accountId, raceId: race!.id, horseId: p.horses[0]!.id, tactic: "front", now });
    const next = gc.meetingsOn(CLOCK, m.startMs + DAY)[m.ofDay]!;
    expect(await expectedMeetingEntries(h.db, next)).toBe(players.length);
    // at the meeting's first post time the same meeting of the next day comes into the horizon
    await ensureRaceCard(h.db, new Date(m.startMs), DEMAND);
    const rows = (await meetingRows(next)).filter((r) => !isCalendar(r));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => cardMarkOf(r)?.reason === "demand")).toBe(true);
    // two races, two classes, two trips, in the meeting's first two free slots
    expect(new Set(rows.map((r) => r.name.replace(/^\S+( \S+)? (?=Maiden|Novice|Handicap)/, ""))).size).toBe(2);
    expect(new Set(rows.map((r) => (r.conditions as RaceConditions).distanceM)).size).toBe(2);
    expect(rows.map((r) => slotIndexOf(r.slotKey)).sort()).toEqual(ordinarySlotsOf(next).slice(0, 2));
    // the meeting after it drew nobody: one race
    const quiet = gc.meetingFor(CLOCK, next.lastPostMs + 1);
    await ensureRaceCard(h.db, new Date(quiet.startMs - DAY), DEMAND);
    expect((await meetingRows(quiet)).filter((r) => !isCalendar(r))).toHaveLength(1);
  });

  it("a race that started early is not published again, and its meeting is not planned twice", async () => {
    const now = at(160 * DAY);
    await ensureRaceCard(h.db, now, DEMAND);
    const m = gc.meetingFor(CLOCK, now.getTime() + 8 * HOUR);
    const [race] = await meetingRows(m);
    // a full race starts early: its post time moves forward (startEarly.ts), its slot key stays
    const early = new Date(now.getTime() + 10 * MIN);
    await h.db.update(races).set({ postTime: early, entriesCloseAt: new Date(early.getTime() - 30_000) }).where(eq(races.id, race!.id));
    const card = await ensureRaceCard(h.db, new Date(now.getTime() + MIN), DEMAND);
    expect(card.find((r) => r.id === race!.id)?.postTime.getTime()).toBe(early.getTime());
    // after it has run (its post time is behind us) the meeting still holds just that race
    await ensureRaceCard(h.db, new Date(now.getTime() + 2 * HOUR), DEMAND);
    const rows = await meetingRows(m);
    expect(rows.map((r) => r.id)).toEqual([race!.id]);
  });

  it("a sponsor's race is published as the sponsor bought it, in its slot, beside the meeting's own; a slot bought after the meeting was planned joins it", async () => {
    const now = at(180 * DAY);
    const sponsor = await newPlayer(h.db, { credits: 200_000, now });
    // a slot two days ahead that is not the meeting's first: the plan would leave it empty
    const ahead = gc.meetingFor(CLOCK, now.getTime() + 2 * DAY);
    const slot = ordinarySlotsOf(ahead)[2]!;
    const wanted = defaultCardSlot(slot, { claiming: false });
    const bought = await sponsorRace(h.db, { accountId: sponsor.accountId, slotIndex: slot, idempotencyKey: "demand-sponsor-1", now });
    expect(bought.raceId).toBeNull();
    await ensureRaceCard(h.db, new Date(ahead.startMs - DAY + MIN), DEMAND);
    const rows = await meetingRows(ahead);
    const named = rows.find((r) => r.slotKey === slotKeyOf(slot))!;
    expect(sponsorOf(named)?.stableId).toBe(sponsor.stableId);
    expect(sponsorOf(named)?.baseName).toBe(wanted.name);
    expect(named.raceClass).toBe(wanted.raceClass);
    expect(named.purse).toBe(wanted.purse);
    expect(cardMarkOf(named)?.reason).toBe("sponsor");
    // the meeting's own race is there too, in its first slot
    const own = rows.filter((r) => cardMarkOf(r)?.reason === "demand");
    expect(own).toHaveLength(1);
    expect(slotIndexOf(own[0]!.slotKey)).toBe(ordinarySlotsOf(ahead)[0]);
    expect(rows).toHaveLength(2);

    // a meeting already planned: buying one of its empty slots puts that race on the card
    const planned = gc.meetingFor(CLOCK, now.getTime() + 20 * HOUR);
    await ensureRaceCard(h.db, now, DEMAND);
    expect(await meetingRows(planned)).toHaveLength(1);
    const empty = ordinarySlotsOf(planned)[3]!;
    await sponsorRace(h.db, { accountId: sponsor.accountId, slotIndex: empty, idempotencyKey: "demand-sponsor-2", now });
    await ensureRaceCard(h.db, new Date(now.getTime() + MIN), DEMAND);
    const after = await meetingRows(planned);
    expect(after).toHaveLength(2);
    const late = after.find((r) => r.slotKey === slotKeyOf(empty))!;
    expect(sponsorOf(late)?.stableId).toBe(sponsor.stableId);
    expect(late.raceClass).toBe(defaultCardSlot(empty, { claiming: false }).raceClass);
    const [s2] = await h.db.select().from(raceSponsorships).where(eq(raceSponsorships.slotIndex, empty));
    expect(s2!.raceId).toBe(late.id);
    expect(s2!.refundedAt).toBeNull();
  });

  it("the day's claiming race keeps its slot when enough horses could enter one", async () => {
    // a day whose claiming candidate is the 0-55 band (the band fresh test horses fit)
    let D = Math.floor(at(200 * DAY).getTime() / DAY) * DAY;
    while (defaultCardSlot(claimingSlotOfDay(D)!).conditions.maxRating !== 55) D += DAY;
    const candidate = claimingSlotOfDay(D)!;
    expect(isClaimingSlot(candidate)).toBe(true);
    const now = new Date(slotPostTime(candidate).getTime() - 12 * HOUR);
    const s = await newPlayer(h.db, { now });
    await makeSeller(h.db, s.accountId, s.stableId);
    for (let k = 0; k < gc.CLAIMING_MIN_ELIGIBLE; k++) await makeHorse(h.db, s.stableId, { rating: 40, starts: 10, tradeMinStarts: 0 });
    await ensureRaceCard(h.db, now, DEMAND);
    const m = meetingRaceOf(candidate)!;
    const rows = await meetingRows(m);
    const claiming = rows.find((r) => r.slotKey === slotKeyOf(candidate))!;
    expect(isClaimingRace(claiming)).toBe(true);
    expect(claiming.name).toMatch(/Claiming Stakes \(0-55\)$/);
    expect(cardMarkOf(claiming)?.reason).toBe("claiming");
    // the meeting's own race beside it; one claiming race that day
    expect(rows.filter((r) => cardMarkOf(r)?.reason === "demand")).toHaveLength(1);
    expect(await count(h.db, "races", `post_time >= '${new Date(D).toISOString()}' and post_time < '${new Date(D + DAY).toISOString()}' and (conditions->>'claiming') = 'true'`)).toBe(1);
    // (the tests below want days without a claiming race: these horses stop being for sale)
    await h.db.update(horses).set({ bound: true }).where(eq(horses.ownerStableId, s.stableId));
  });

  it("the switch-over: races of the fixed card run as published and their meeting is completed from the pattern; the next meetings are planned; the kill switch fills the empty slots", async () => {
    const now = at(220 * DAY);
    // the fixed card, published up to the middle of a meeting (as a deploy finds it: the horizon cuts a meeting)
    const cut = gc.meetingFor(CLOCK, now.getTime() + 12 * HOUR);
    const half = ordinarySlotsOf(cut).slice(0, 2);
    const old = await ensureRaceCard(h.db, now, FIXED, slotPostTime(half[1]!).getTime() - now.getTime());
    expect(old.filter((r) => half.includes(slotIndexOf(r.slotKey)!))).toHaveLength(2);
    const card = await ensureRaceCard(h.db, now, DEMAND);
    expect(await ensureRaceCard(h.db, now, DEMAND)).toEqual(card); // idempotent
    // every old race is the same row
    const byId = new Map(card.map((r) => [r.id, r]));
    for (const r of old) expect(byId.get(r.id)).toMatchObject({ seedCommitment: r.seedCommitment, name: r.name, slotKey: r.slotKey });
    // the cut meeting: all its slots, from the pattern, unmarked
    const cutRows = (await meetingRows(cut)).sort((a, b) => a.postTime.getTime() - b.postTime.getTime());
    expect(cutRows.map((r) => r.slotKey)).toEqual(ordinarySlotsOf(cut).map(slotKeyOf));
    for (const r of cutRows) {
      expect(cardMarkOf(r)).toBeNull();
      expect(r.name).toBe(defaultCardSlot(slotIndexOf(r.slotKey)!, { claiming: isClaimingRace(r) }).name);
    }
    // the meetings after it are planned: one race each in this small world
    const next = gc.meetingFor(CLOCK, cut.lastPostMs + 1);
    const nextRows = await meetingRows(next);
    expect(nextRows).toHaveLength(1);
    expect(cardMarkOf(nextRows[0]!)?.reason).toBe("demand");
    // no two races at one post time, no duplicate keys
    expect(new Set(card.map((r) => r.slotKey)).size).toBe(card.length);
    expect(new Set(card.map((r) => r.postTime.getTime())).size).toBe(card.length);

    // LIVE_CARD_PLAN=fixed: every empty slot inside the horizon is filled from the pattern; planned races stay
    const fixed = await ensureRaceCard(h.db, now, FIXED);
    const first = slotIndexAt(now) + 1;
    const window = Array.from({ length: RULES.cardHorizonMs / RULES.slotMs }, (_, i) => first + i).filter(isCardSlot);
    expect(fixed.map((r) => r.slotKey)).toEqual(window.map(slotKeyOf));
    for (const r of card) expect(fixed.find((x) => x.slotKey === r.slotKey)?.id).toBe(r.id);
    // ...and back: a meeting that now holds fixed races is left to the pattern (nothing to add, nothing removed)
    expect(await ensureRaceCard(h.db, now, DEMAND)).toEqual(fixed);
  });

  it("Finals day: the four Season Finals keep their times and the Finals meeting is planned around them", async () => {
    // the last day of a season far from the other tests' days
    const seasonEnd = RULES.seasonEpochMs + 30 * RULES.seasonMs;
    const finalsDay = seasonEnd - DAY;
    const now = new Date(finalsDay - 2 * HOUR);
    const card = await ensureRaceCard(h.db, now, DEMAND);
    const onDay = card.filter((r) => r.postTime.getTime() >= finalsDay && r.postTime.getTime() < seasonEnd);
    const finals = onDay.filter((r) => ((r.conditions as RaceConditions).calendar as { kind?: string } | undefined)?.kind === "season_final");
    expect(finals).toHaveLength(gc.FINALS_MEETING_RACES);
    for (const f of finals) {
      expect(f.name).toBe(defaultCardSlot(slotIndexOf(f.slotKey)!).name);
      expect(cardMarkOf(f)).toBeNull();
    }
    // the Finals meeting: its own ordinary races, planned (one in this small world), in a slot between the Finals
    const m = meetingRaceOf(slotIndexOf(finals[0]!.slotKey)!)!;
    expect(m.finals).toBe(true);
    const own = ordinarySlotsOf(m);
    expect(own).toHaveLength(gc.RACES_PER_MEETING);
    for (const i of own) expect(isCalendarSlot(i)).toBe(false);
    const rows = await meetingRows(m);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.length).toBeLessThanOrEqual(gc.RACES_PER_MEETING);
    expect(rows.every((r) => cardMarkOf(r) !== null)).toBe(true);
    // no two races at one post time that day; every meeting of the day has an ordinary race
    expect(new Set(onDay.map((r) => r.postTime.getTime())).size).toBe(onDay.length);
    expect(new Set(ordinary(onDay).map((r) => meetingRaceOf(slotIndexOf(r.slotKey)!)!.number)).size).toBeGreaterThanOrEqual(gc.MEETINGS_PER_DAY - 1);
    expect(await ensureRaceCard(h.db, now, DEMAND)).toEqual(card);
  });

  it("tickRaceCard drives it: a planned race nobody entered is called off, one with a player runs", async () => {
    const now = at(240 * DAY);
    const p = await youngStable(now, 1);
    await tickRaceCard(h.db, now, DEMAND);
    const a = gc.meetingFor(CLOCK, now.getTime() + 2 * HOUR);
    const b = gc.meetingFor(CLOCK, a.lastPostMs + 1);
    const [ra] = await meetingRows(a);
    const [rb] = await meetingRows(b);
    await enterRace(h.db, { accountId: p.accountId, raceId: ra!.id, horseId: p.horses[0]!.id, tactic: "front", now });
    const done = { locked: [] as string[], calledOff: [] as string[] };
    for (let k = 0; k < 10; k++) {
      const t = await tickRaceCard(h.db, rb!.entriesCloseAt, DEMAND);
      done.locked.push(...t.locked);
      done.calledOff.push(...t.calledOff);
      if (!t.locked.length && !t.calledOff.length) break;
    }
    expect(done.locked).toContain(ra!.id);
    expect(done.calledOff).toContain(rb!.id);
  });
});
