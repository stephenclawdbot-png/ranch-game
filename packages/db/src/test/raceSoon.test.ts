/**
 * The bell shortly before a Live race goes off (first-hour follow-up: the Live wait). One note per
 * (race, stable) inside RACE_SOON_MS of the off, from the lazy sweep; outcome-free; never written
 * for an account that switched "Races & results" off.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { inboxItems } from "../schema";
import { createRace, enterRace } from "../services/races";
import { SLOT_KEY_PREFIX } from "../services/card";
import { RACE_SOON_MS, noteRacesSoon, sweepNotifications } from "../services/notificationEvents";
import { setNotificationPrefs, unreadNotificationCount } from "../services/notifications";
import { MIN, at, makeHorse, memoryDb, newPlayer } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const soonOf = (accountId: string) => h.db.select().from(inboxItems).where(and(eq(inboxItems.accountId, accountId), eq(inboxItems.kind, "race_soon")));

let n = 0;
async function liveRace(postMin: number, entrants: { accountId: string; horseId: string }[]) {
  n++;
  const r = await createRace(h.db, {
    kind: "scheduled",
    name: `Reminder Stakes ${n}`,
    raceClass: "maiden",
    conditions: { distanceM: 1200, surface: "turf" },
    postTime: at(postMin * MIN),
    entriesCloseAt: at((postMin - 1) * MIN),
    targetRunners: 6,
    slotKey: `${SLOT_KEY_PREFIX}${900_000 + n}`,
  });
  for (const e of entrants) await enterRace(h.db, { ...e, raceId: r.id, tactic: "stalker", now: at(0) });
  return r;
}

describe("the bell before the off", () => {
  it("rings once per stable and race within RACE_SOON_MS of a Live race it entered, and not before", async () => {
    const p = await newPlayer(h.db);
    const a = await makeHorse(h.db, p.stableId, { name: "Fair Wind" });
    const other = await newPlayer(h.db);
    const c = await makeHorse(h.db, other.stableId, { name: "Other Yard Runner" });
    const race = await liveRace(60, [
      { accountId: p.accountId, horseId: a.id },
      { accountId: other.accountId, horseId: c.id },
    ]);
    // Too early: nothing.
    expect(await noteRacesSoon(h.db, at(60 * MIN - RACE_SOON_MS - MIN))).toBe(0);
    expect(await soonOf(p.accountId)).toHaveLength(0);
    // Inside the window: one note per stable.
    expect(await noteRacesSoon(h.db, at(52 * MIN))).toBe(2);
    const [mine] = await soonOf(p.accountId);
    expect(mine!.title).toBe(`Fair Wind runs in the ${race.name} in 8 minutes: watch it live`);
    expect(mine!.raceId).toBe(race.id);
    expect((mine!.data as { href: string }).href).toBe(`/race/${race.id}`);
    expect((await soonOf(other.accountId))[0]!.title).toBe(`Other Yard Runner runs in the ${race.name} in 8 minutes: watch it live`);
    // Idempotent, also from the sweep; after the off, nothing new.
    expect(await noteRacesSoon(h.db, at(55 * MIN))).toBe(0);
    expect((await sweepNotifications(h.db, at(56 * MIN))).racesSoon).toBe(0);
    expect(await noteRacesSoon(h.db, at(61 * MIN))).toBe(0);
    expect(await soonOf(p.accountId)).toHaveLength(1);
    expect(await unreadNotificationCount(h.db, { accountId: p.accountId, now: at(56 * MIN) })).toBeGreaterThan(0);
  });

  it("respects the switches: no reminder for an account that turned Races & results off", async () => {
    const p = await newPlayer(h.db);
    const a = await makeHorse(h.db, p.stableId, { name: "Quiet One" });
    await setNotificationPrefs(h.db, { accountId: p.accountId, disabled: ["races"], now: at(0) });
    await liveRace(120, [{ accountId: p.accountId, horseId: a.id }]);
    expect(await noteRacesSoon(h.db, at(115 * MIN))).toBe(0);
    expect(await soonOf(p.accountId)).toHaveLength(0);
    // Another category off doesn't matter.
    await setNotificationPrefs(h.db, { accountId: p.accountId, disabled: ["health"], now: at(0) });
    expect(await noteRacesSoon(h.db, at(116 * MIN))).toBe(1);
  });

  it("ignores Story races (no slot on the Live card)", async () => {
    const p = await newPlayer(h.db);
    const a = await makeHorse(h.db, p.stableId, { name: "Story Horse" });
    const r = await createRace(h.db, { kind: "quick", name: "Larkspur Club Maiden", raceClass: "maiden", conditions: { distanceM: 1200, surface: "turf" }, postTime: at(200 * MIN), entriesCloseAt: at(199 * MIN), targetRunners: 6 });
    await enterRace(h.db, { accountId: p.accountId, horseId: a.id, raceId: r.id, tactic: "front", now: at(0) });
    expect(await noteRacesSoon(h.db, at(195 * MIN))).toBe(0);
  });
});
