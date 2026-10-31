/**
 * Notifications (services/notifications.ts, notificationEvents.ts): every kind has a category, every
 * write goes through notify(), each new event fires once and only when it should, the category
 * switches filter the bell and its unread count, and nothing in the bell spoils a race.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { and, eq, ne } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { genomeOf, gc } from "../gameCore";
import { horses, inboxItems } from "../schema";
import { createRace, enterRace, getRaceForSimulation, settleRace, type RunnerOutcome } from "../services/races";
import { listInbox, markInboxRead } from "../services/player";
import { expireListings, listHorse } from "../services/market";
import { healInjuries } from "../services/maintenance";
import { ensureRaceCard, meetingRaceOf, slotIndexAt, slotPostTime } from "../services/card";
import {
  BELL_ONLY_KINDS,
  CATEGORY_KEYS,
  INBOX_KINDS,
  MOMENT_CATEGORY,
  NOTIFICATION_CATEGORIES,
  UNREAD_WINDOW_MS,
  categoryOf,
  listNotifications,
  markNotificationsSeen,
  notificationPrefsOf,
  notify,
  setNotificationPrefs,
  unreadNotificationCount,
} from "../services/notifications";
import { noteRacesThatSuit, noteRecoveriesTx, noteTrainingWeekTx, sweepNotifications } from "../services/notificationEvents";
import { RULES } from "../rules";
import { DAY, MIN, T0, at, floorPrice, getHorseRow, makeHorse, makeSeller, memoryDb, newPlayer } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const notesOf = (accountId: string, kind?: string) =>
  h.db
    .select()
    .from(inboxItems)
    .where(and(eq(inboxItems.accountId, accountId), kind ? eq(inboxItems.kind, kind) : undefined));

let slot = 0;
/** A Live race on day `day`, settled with the given outcomes. */
async function race(entries: { accountId: string; horseId: string }[], extra: Record<string, Partial<RunnerOutcome>> = {}, day = 0) {
  const base = day * DAY + ++slot * 20 * MIN;
  const r = await createRace(h.db, {
    kind: "scheduled",
    name: `Bell Stakes ${slot}`,
    raceClass: "maiden",
    conditions: { distanceM: 1200, surface: "turf" },
    postTime: at(base + 10 * MIN),
    entriesCloseAt: at(base + 9 * MIN),
    targetRunners: 4,
  });
  for (const e of entries) await enterRace(h.db, { ...e, raceId: r.id, tactic: "stalker", now: at(base) });
  const now = at(base + 11 * MIN);
  const { field } = await getRaceForSimulation(h.db, r.id, now);
  // the players' horses finish behind the Club's (no first-win moment to account for)
  const mine = new Set(entries.map((e) => e.horseId));
  const order = [...field.runners.map((x) => x.horseId).filter((id) => !mine.has(id)), ...entries.map((e) => e.horseId)];
  await settleRace(h.db, { raceId: r.id, now, resultHash: "0".repeat(64), result: { order }, runners: order.map((horseId, i) => ({ horseId, position: i + 1, ...(extra[horseId] ?? {}) })) });
  return { race: r, now };
}

describe("categories", () => {
  it("every inbox kind and every moment kind has a known category", () => {
    for (const [kind, meta] of Object.entries(INBOX_KINDS)) expect(CATEGORY_KEYS, kind).toContain(meta.category);
    for (const [moment, cat] of Object.entries(MOMENT_CATEGORY)) expect(CATEGORY_KEYS, moment).toContain(cat);
    expect(NOTIFICATION_CATEGORIES.map((c) => c.label)).toEqual(["Races & results", "Horse health & care", "Training", "Market & sales", "Breeding & stud", "Jockeys", "Betting", "Club & news"]);
    expect(categoryOf("moment", { moment: "scan" })).toBe("breeding");
    expect(categoryOf("moment", { moment: "memorial" })).toBe("health");
    expect(categoryOf("listing_expired")).toBe("market");
  });

  it("every inbox write goes through notify() with a categorised kind (a new kind must be placed)", () => {
    const servicesDir = join(__dirname, "..", "services");
    const kinds = new Set(Object.keys(INBOX_KINDS));
    for (const file of readdirSync(servicesDir).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(servicesDir, file), "utf8");
      if (file !== "notifications.ts") {
        expect(src, `${file} writes inbox_items directly: use notify()`).not.toMatch(/insert\(inboxItems\)|insert into inbox_items/i);
      }
      // literal kinds handed to notify() / the services' note helpers
      for (const m of src.matchAll(/notify\(\w+, \{[^}]*?kind: "([a-z_]+)"/g)) expect(kinds, `${file}: ${m[1]}`).toContain(m[1]);
      for (const m of src.matchAll(/(?:await note|await inbox)\([^)]*?"([a-z_]+)"/g)) {
        if (/^(claim|horse|lease)_/.test(m[1]!)) expect(kinds, `${file}: ${m[1]}`).toContain(m[1]);
      }
    }
  });
});

describe("notify", () => {
  it("writes an event once per dedupe key", async () => {
    const p = await newPlayer(h.db);
    const first = await notify(h.db, { accountId: p.accountId, kind: "upkeep", dedupeKey: "upkeep:test", title: "Weekly upkeep", now: T0 });
    const again = await notify(h.db, { accountId: p.accountId, kind: "upkeep", dedupeKey: "upkeep:test", title: "Weekly upkeep (again)", now: at(MIN) });
    expect(first).toBeTruthy();
    expect(again).toBeNull();
    expect(await notesOf(p.accountId, "upkeep")).toHaveLength(1);
  });

  it("bell-only kinds never crowd the Estate's race list (listInbox)", async () => {
    const p = await newPlayer(h.db);
    for (const kind of BELL_ONLY_KINDS) await notify(h.db, { accountId: p.accountId, kind, dedupeKey: `${kind}:crowd`, title: kind, now: T0 });
    await notify(h.db, { accountId: p.accountId, kind: "upkeep", dedupeKey: "upkeep:crowd", title: "Upkeep", now: T0 });
    expect((await listInbox(h.db, p.accountId)).map((i) => i.kind)).toEqual(["upkeep"]);
  });
});

describe("injury and back in the race", () => {
  it("an injured runner: one note to the owner, held from the bell until the result is watched; then back in the race once", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId, { name: "Bramble Gate" });
    const q = await newPlayer(h.db);
    const other = await makeHorse(h.db, q.stableId, { name: "Plain Sailing" });
    const { race: r, now } = await race(
      [
        { accountId: p.accountId, horseId: horse.id },
        { accountId: q.accountId, horseId: other.id },
      ],
      { [horse.id]: { injury: { severity: "minor", recoveryMs: 2 * DAY } } },
    );
    const notes = await notesOf(p.accountId, "injury");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ horseId: horse.id, dedupeKey: `injury:${horse.id}:${r.id}`, raceId: null });
    expect(notes[0]!.title).toMatch(/^Bramble Gate has been injured/);
    expect((notes[0]!.data as { raceId?: string }).raceId).toBe(r.id);

    // Before the result is watched: the bell shows the result (neutral title), never the injury.
    let bell = await listNotifications(h.db, { accountId: p.accountId, now });
    expect(bell.some((n) => n.kind === "injury")).toBe(false);
    const results = bell.filter((n) => n.kind === "race_result");
    expect(results).toHaveLength(1);
    for (const n of results) {
      expect(n.title).toBe(`Your result is in from the ${r.name}: watch it`);
      expect(n.href).toBe(`/race/${r.id}`);
    }
    expect(await unreadNotificationCount(h.db, { accountId: p.accountId, now })).toBe(1);

    await markInboxRead(h.db, { accountId: p.accountId, raceId: r.id, now });
    bell = await listNotifications(h.db, { accountId: p.accountId, now });
    expect(bell.find((n) => n.kind === "injury")).toMatchObject({ unread: true, category: "health", href: `/horse/${horse.id}` });
    expect(bell.find((n) => n.kind === "race_result" && n.horseId === horse.id)!.title).toMatch(/Bramble Gate finished/);
    expect(await unreadNotificationCount(h.db, { accountId: p.accountId, now })).toBe(1);

    // Still recovering: nothing. Healed: once, whichever path runs (sweep, sweep again, daily heal).
    expect(await noteRecoveriesTx(h.db, at(DAY))).toBe(0);
    const healedAt = new Date((await getHorseRow(h.db, horse.id)).injuredUntil!.getTime() + MIN);
    await sweepNotifications(h.db, healedAt);
    await sweepNotifications(h.db, new Date(healedAt.getTime() + MIN));
    await healInjuries(h.db, new Date(healedAt.getTime() + 2 * MIN));
    const back = await notesOf(p.accountId, "back_in_race");
    expect(back).toHaveLength(1);
    expect(back[0]!.title).toMatch(/^Bramble Gate is over the .* and can race again$/);
    expect((await getHorseRow(h.db, horse.id)).injuredUntil).toBeNull();
    // the uninjured runner never got either note
    expect((await notesOf(q.accountId)).filter((n) => n.kind === "injury" || n.kind === "back_in_race")).toHaveLength(0);
  });

  it("a fatal injury is the memorial, not an injury note; a retired horse is never 'back in the race'", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId, { name: "Last Light" });
    await race([{ accountId: p.accountId, horseId: horse.id }], { [horse.id]: { injury: { severity: "fatal", recoveryMs: 0 } } }, 1);
    expect(await notesOf(p.accountId, "injury")).toHaveLength(0);

    const retired = await makeHorse(h.db, p.stableId, { careerStatus: "retired", retirementReason: "max_starts", retiredAt: T0, injury: { severity: "minor" }, injuredUntil: at(DAY) });
    await noteRecoveriesTx(h.db, at(2 * DAY));
    expect((await notesOf(p.accountId, "back_in_race")).filter((n) => n.horseId === retired.id)).toHaveLength(0);
  });
});

describe("training session available", () => {
  it("one note per stable per new week, only for horses that used every session of the last one", async () => {
    const p = await newPlayer(h.db);
    const week = gc.weekIndex(T0.getTime());
    const trained = await makeHorse(h.db, p.stableId, { name: "Hard Worker", dynamics: { training: { week: week - 1, sessionsThisWeek: 3, realisation: {} } } });
    const light = await makeHorse(h.db, p.stableId, { name: "Light Duty", dynamics: { training: { week: week - 1, sessionsThisWeek: 1, realisation: {} } } });
    await makeHorse(h.db, p.stableId, { name: "Never Trained" });
    const idle = await newPlayer(h.db);
    await makeHorse(h.db, idle.stableId, { dynamics: { training: { week: week - 1, sessionsThisWeek: 2, realisation: {} } } });

    await noteTrainingWeekTx(h.db, T0);
    await noteTrainingWeekTx(h.db, at(3 * DAY)); // same week: no repeat
    const notes = await notesOf(p.accountId, "training_ready");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ horseId: trained.id, dedupeKey: `training-week:${week}` });
    expect(notes[0]!.title).toBe("Hard Worker can train again: a new training week has started");
    expect(JSON.stringify(notes[0]!.data)).not.toContain(light.id);
    expect(await notesOf(idle.accountId, "training_ready")).toHaveLength(0);
    // The next week: it hasn't trained in this one, so nothing more.
    await noteTrainingWeekTx(h.db, at(7 * DAY));
    expect(await notesOf(p.accountId, "training_ready")).toHaveLength(1);
  });
});

describe("a new race that suits your horse", () => {
  it("one digest per meeting for races that suit (trip, surface, band); nothing for a horse they don't suit", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId, { name: "Right Trip" });
    const genome = genomeOf(horse.genome)!;
    const surface = gc.preferredSurface(genome);
    const trip = gc.preferredDistanceM(genome);
    const q = await newPlayer(h.db);
    // A horse whose best surface is never on this card: no note for its owner.
    let wrong = await makeHorse(h.db, q.stableId, { name: "Wrong Going" });
    for (let i = 0; i < 30 && gc.preferredSurface(genomeOf(wrong.genome)!) === surface; i++) wrong = await makeHorse(h.db, q.stableId, { name: `Wrong Going ${i}` });
    expect(gc.preferredSurface(genomeOf(wrong.genome)!)).not.toBe(surface);
    // any other horse of q's on this surface would get a note: keep only the wrong one racing
    await h.db.update(horses).set({ careerStatus: "retired", retirementReason: "max_starts", retiredAt: T0 }).where(and(eq(horses.ownerStableId, q.stableId), ne(horses.id, wrong.id)));
    const cardSurface = surface;
    const now = at(10 * DAY);
    const first = slotIndexAt(now) + 1;
    // the card: every meeting race on the slot grid, all on cardSurface at the right trip
    const cardSlot = (i: number) => {
      if (!meetingRaceOf(i)) return null;
      const postTime = slotPostTime(i);
      return { kind: "scheduled" as const, name: `Suits Stakes ${i}`, raceClass: "maiden", conditions: { distanceM: trip, surface: cardSurface }, postTime, entriesCloseAt: new Date(postTime.getTime() - 5 * MIN) };
    };
    await ensureRaceCard(h.db, now, { cardSlot });
    await ensureRaceCard(h.db, at(10 * DAY + MIN), { cardSlot });
    let meetings = 0;
    const last = slotIndexAt(new Date(now.getTime() + RULES.cardHorizonMs));
    for (let i = first; i <= last; i++) if (meetingRaceOf(i)?.race === gc.RACES_PER_MEETING - 1) meetings++;
    expect(meetings).toBeGreaterThan(0);
    const notes = await notesOf(p.accountId, "race_suits");
    expect(notes).toHaveLength(meetings);
    for (const n of notes) {
      expect(n.title).toMatch(/new races suit Right Trip at the meeting from \d\d:\d\d UTC|A new race suits Right Trip/);
      expect((n.data as { total: number }).total).toBeLessThanOrEqual(gc.RACES_PER_MEETING);
    }
    expect(notes.some((n) => (n.data as { total: number; href: string }).total === gc.RACES_PER_MEETING && (n.data as { href: string }).href === "/races")).toBe(true);
    expect(await notesOf(q.accountId, "race_suits")).toHaveLength(0);
    // Running the digest again for a meeting: no repeat.
    const m = meetingRaceOf(first + 1) ?? meetingRaceOf(first);
    if (m) await noteRacesThatSuit(h.db, { meeting: m.number, fromMs: m.startMs, toMs: m.lastPostMs, now });
    expect(await notesOf(p.accountId, "race_suits")).toHaveLength(notes.length);
  });
});

describe("market listing expired", () => {
  it("a credits listing that runs out tells its seller once", async () => {
    const s = await newPlayer(h.db);
    await makeSeller(h.db, s.accountId, s.stableId);
    const horse = await makeHorse(h.db, s.stableId, { name: "Unsold Dream" });
    const listing = await listHorse(h.db, { accountId: s.accountId, horseId: horse.id, price: await floorPrice(h.db, horse.id), now: T0, durationMs: DAY });
    await expireListings(h.db, at(DAY / 2));
    expect(await notesOf(s.accountId, "listing_expired")).toHaveLength(0);
    await expireListings(h.db, at(2 * DAY));
    await expireListings(h.db, at(2 * DAY + MIN));
    const notes = await notesOf(s.accountId, "listing_expired");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ horseId: horse.id, dedupeKey: `listing-expired:credits:${listing.id}` });
    expect(notes[0]!.title).toBe("Unsold Dream's listing expired unsold: Unsold Dream is back in your stable");
  });
});

describe("preferences, the bell and mark read", () => {
  it("a category switched off leaves the bell and the count; the full inbox still lists it (muted)", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId);
    await notify(h.db, { accountId: p.accountId, kind: "back_in_race", dedupeKey: "back:t1", title: "Back", horseId: horse.id, now: T0 });
    await notify(h.db, { accountId: p.accountId, kind: "upkeep", dedupeKey: "upkeep:t1", title: "Upkeep", now: at(MIN) });
    expect(await notificationPrefsOf(h.db, p.accountId)).toEqual([]);
    expect(await unreadNotificationCount(h.db, { accountId: p.accountId, now: at(2 * MIN) })).toBe(2);

    expect(await setNotificationPrefs(h.db, { accountId: p.accountId, disabled: ["health", "nonsense"], now: T0 })).toEqual(["health"]);
    expect(await unreadNotificationCount(h.db, { accountId: p.accountId, now: at(2 * MIN) })).toBe(1);
    expect((await listNotifications(h.db, { accountId: p.accountId, now: at(2 * MIN) })).map((n) => n.kind)).toEqual(["upkeep"]);
    const all = await listNotifications(h.db, { accountId: p.accountId, now: at(2 * MIN), all: true });
    expect(all.map((n) => [n.kind, n.muted])).toEqual([
      ["upkeep", false],
      ["back_in_race", true],
    ]);
    // back on
    await setNotificationPrefs(h.db, { accountId: p.accountId, disabled: [], now: T0 });
    expect(await unreadNotificationCount(h.db, { accountId: p.accountId, now: at(2 * MIN) })).toBe(2);
  });

  it("mark one / mark all seen; read_at untouched; old items don't nag; the count caps at 10", async () => {
    const p = await newPlayer(h.db);
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push((await notify(h.db, { accountId: p.accountId, kind: "jockey", dedupeKey: `jockey:t${i}`, title: `Jockey ${i}`, now: at(i * MIN) }))!);
    const now = at(20 * MIN);
    expect(await unreadNotificationCount(h.db, { accountId: p.accountId, now })).toBe(10);
    expect(await markNotificationsSeen(h.db, { accountId: p.accountId, now, ids: [ids[0]!] })).toBe(1);
    expect((await listNotifications(h.db, { accountId: p.accountId, now })).find((n) => n.id === ids[0])!.unread).toBe(false);
    expect(await markNotificationsSeen(h.db, { accountId: p.accountId, now })).toBe(11);
    expect(await unreadNotificationCount(h.db, { accountId: p.accountId, now })).toBe(0);
    const rows = await notesOf(p.accountId);
    expect(rows.every((r) => r.readAt === null && r.seenAt !== null)).toBe(true);
    // another account can't mark these
    const other = await newPlayer(h.db);
    await notify(h.db, { accountId: p.accountId, kind: "jockey", dedupeKey: "jockey:late", title: "Late", now });
    expect(await markNotificationsSeen(h.db, { accountId: other.accountId, now })).toBe(0);
    // an unread item older than the window stops counting
    expect(await unreadNotificationCount(h.db, { accountId: p.accountId, now: new Date(now.getTime() + UNREAD_WINDOW_MS + MIN) })).toBe(0);
  });

  it("mark all never touches a note held back for an unwatched result", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId, { name: "Held Back" });
    const { race: r, now } = await race([{ accountId: p.accountId, horseId: horse.id }], { [horse.id]: { injury: { severity: "minor", recoveryMs: DAY } } }, 2);
    await markNotificationsSeen(h.db, { accountId: p.accountId, now });
    const [injury] = await notesOf(p.accountId, "injury");
    expect(injury!.seenAt).toBeNull();
    const [result] = await notesOf(p.accountId, "race_result");
    expect(result!.seenAt).not.toBeNull();
    expect(result!.readAt).toBeNull(); // the reveal on the race page still waits
    await markInboxRead(h.db, { accountId: p.accountId, raceId: r.id, now });
    expect((await listNotifications(h.db, { accountId: p.accountId, now })).find((n) => n.kind === "injury")!.unread).toBe(true);

  });
});
