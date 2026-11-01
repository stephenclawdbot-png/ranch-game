import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { inboxItems, races } from "../schema";
import { createRace, enterRace } from "../services/races";
import { START_EARLY_LEAD_MS, earlyPostTime, startRaceEarly } from "../services/startEarly";
import { MIN, T0, at, makeHorse, memoryDb, newPlayer } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

let n = 0;
function liveRace(maxRunners: number, extra: Record<string, unknown> = {}) {
  n++;
  return createRace(h.db, {
    kind: "scheduled",
    name: `Early Stakes ${n}`,
    raceClass: "handicap",
    conditions: { minRating: 0, maxRating: 140, distanceM: 1400, surface: "dirt", going: "good", ...extra },
    postTime: at(180 * MIN),
    entriesCloseAt: at(175 * MIN),
    purse: 2_000,
    maxRunners,
    targetRunners: maxRunners,
    slotKey: `live:test-${n}`,
  });
}

describe("starting a Live race early", () => {
  it("a full field goes off 10 minutes after the last entry, and every entrant hears", async () => {
    const r = await liveRace(3);
    const players = [await newPlayer(h.db, { credits: 10_000 }), await newPlayer(h.db, { credits: 10_000 }), await newPlayer(h.db, { credits: 10_000 })];
    for (let i = 0; i < players.length; i++) {
      const horse = await makeHorse(h.db, players[i]!.stableId, { rating: 40 });
      await enterRace(h.db, { accountId: players[i]!.accountId, raceId: r.id, horseId: horse.id, tactic: "stalker", now: at(10 * MIN + i * MIN) });
    }
    const [after] = await h.db.select().from(races).where(eq(races.id, r.id));
    const last = at(12 * MIN).getTime();
    expect(after!.postTime.getTime()).toBe(Math.ceil((last + START_EARLY_LEAD_MS) / 60_000) * 60_000);
    expect(after!.entriesCloseAt.getTime()).toBeLessThanOrEqual(after!.postTime.getTime());
    expect(after!.entriesCloseAt.getTime()).toBeGreaterThanOrEqual(last);
    for (const p of players) {
      const notes = (await h.db.select().from(inboxItems).where(eq(inboxItems.accountId, p.accountId))).filter((x) => x.kind === "race_moved");
      expect(notes).toHaveLength(1);
      expect(notes[0]!.title).toMatch(/now goes off in 10 minutes \(the field is full\)/);
    }
  });

  it("a race that isn't full keeps its time; the admin can bring it forward", async () => {
    const r = await liveRace(12);
    const p = await newPlayer(h.db, { credits: 10_000 });
    const horse = await makeHorse(h.db, p.stableId, { rating: 40 });
    await enterRace(h.db, { accountId: p.accountId, raceId: r.id, horseId: horse.id, tactic: "stalker", now: at(10 * MIN) });
    expect((await h.db.select().from(races).where(eq(races.id, r.id)))[0]!.postTime.getTime()).toBe(at(180 * MIN).getTime());
    const moved = await startRaceEarly(h.db, { raceId: r.id, now: at(20 * MIN), minutes: 10 });
    expect(moved?.postTime.getTime()).toBe(at(30 * MIN).getTime());
    // never moved later, never twice into the past
    expect(await startRaceEarly(h.db, { raceId: r.id, now: at(25 * MIN), minutes: 10 })).toBeNull();
  });

  it("calendar races, story races and closed races never move", () => {
    const base = { status: "open" as const, field: null, entriesCloseAt: at(175 * MIN), postTime: at(180 * MIN), slotKey: "live:x" };
    expect(earlyPostTime({ ...base, conditions: { calendar: { kind: "feature" } } } as never, at(10 * MIN))).toBeNull();
    expect(earlyPostTime({ ...base, slotKey: null, conditions: {} } as never, at(10 * MIN))).toBeNull();
    expect(earlyPostTime({ ...base, conditions: {} } as never, at(176 * MIN))).toBeNull();
    expect(earlyPostTime({ ...base, conditions: {} } as never, at(10 * MIN))?.getTime()).toBe(at(20 * MIN).getTime());
  });
});
