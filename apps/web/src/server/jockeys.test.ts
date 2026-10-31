/**
 * Jockeys at the web layer: the Racing → Jockeys list and leaderboard, a jockey's page (sign /
 * release where allowed), the stable's own jockeys and the entry sheet's picker.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as gc from "@thoroughbred/game-core";
import { createAccount, createDb, createRace, ensureJockeyBackfill, signJockey, stableOf, SLOT_KEY_PREFIX, type DbHandle } from "@thoroughbred/db";
import { entryOptions } from "./game";
import { jockeyPage, jockeysPage, myJockeys } from "./jockeys";
import type { Session } from "./session";

let h: DbHandle;
const T0 = new Date(Date.UTC(2026, 10, 2, 12, 0, 7));
const MIN = 60_000;

async function player(name: string): Promise<Session> {
  const acc = await createAccount(h.db, { stableName: name, silks: { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" }, starterHorses: 1, startingCredits: 20_000, now: T0 });
  return { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) };
}

beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

describe("jockey pages", () => {
  it("list every active jockey with filters; a jockey's page offers Sign to a stable with room", async () => {
    const p = await player("Jockey Page Stable");
    await ensureJockeyBackfill(h.db, T0);
    const all = await jockeysPage(h.db, p, "all", T0);
    const free = await jockeysPage(h.db, p, "freelancers", T0);
    const mine = await jockeysPage(h.db, p, "mine", T0);
    expect(all.jockeys.length).toBe(free.jockeys.length + mine.jockeys.length);
    expect(mine.jockeys).toHaveLength(1);
    expect(mine.jockeys[0]!.mine).toBe(true);
    expect(mine.jockeys[0]!.cardName).toMatch(/^[A-Z]\. .+ \(7\)$/);
    expect(mine.jockeys[0]!.skills.map((s) => s.key)).toEqual([...gc.JOCKEY_SKILLS]);
    expect(JSON.stringify(all)).not.toMatch(/"seed"/);

    // The list's own numbers (playtest fix 13): career strike rate, rides this season, the
    // freelance floor fee, and career winners to lead with while the season has no winner yet.
    for (const j of all.jockeys) {
      expect(j.strikeRate).toBe(j.rides > 0 ? Math.round((j.wins * 100) / j.rides) : null);
      expect(j.ridesThisSeason).toBe(0);
      expect(j.feeFrom).toBe(j.stableId === null && !j.retired ? gc.freelanceFee(j.grade, 0) : null);
    }
    expect(all.leaderboard).toEqual([]); // fresh season: nothing settled
    expect(all.careerLeaders.length).toBeGreaterThan(0);
    expect(all.careerLeaders.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < all.careerLeaders.length; i++) {
      expect(all.careerLeaders[i]!.wins).toBeLessThanOrEqual(all.careerLeaders[i - 1]!.wins);
    }
    expect(all.careerLeaders[0]!.wins).toBe(Math.max(...all.jockeys.map((j) => j.wins)));

    const target = free.jockeys[0]!;
    const page = (await jockeyPage(h.db, p, target.id, T0))!;
    expect(page.actions.canSign).toBe(true);
    expect(page.actions.signFee).toBe(gc.signingFee(target.grade));
    expect(page.career[0]!.kind).toBe("debut");
    await signJockey(h.db, { accountId: p.accountId, jockeyId: target.id, now: T0 });
    const after = (await jockeyPage(h.db, p, target.id, T0))!;
    expect(after.actions.canRelease).toBe(true);
    expect(after.jockey.stableName).toBe("Jockey Page Stable");
    expect((await myJockeys(h.db, p, T0)).map((j) => j.id)).toContain(target.id);
    // A visitor sees the page without actions.
    expect((await jockeyPage(h.db, null, target.id, T0))!.actions.canSign).toBe(false);
    expect(await jockeyPage(h.db, null, "not-a-jockey", T0)).toBeNull();
  });

  it("the entry sheet offers own jockeys (free, the default) and Club freelancers with fees", async () => {
    const p = await player("Sheet Jockey Stable");
    await ensureJockeyBackfill(h.db, T0);
    const race = await createRace(h.db, {
      kind: "scheduled",
      name: "Jockey Sheet Handicap",
      raceClass: "handicap",
      conditions: { minRating: 0, maxRating: 55, distanceM: 1600, surface: "turf", going: "good", weather: "clear" },
      postTime: new Date(T0.getTime() + 10 * MIN),
      entriesCloseAt: new Date(T0.getTime() + 10 * MIN - 30_000),
      purse: 2_000,
      maxRunners: 12,
      targetRunners: 6,
      slotKey: `${SLOT_KEY_PREFIX}9000001`,
    });
    const sheet = await entryOptions(h.db, p, race.id, T0);
    const r = sheet.raceDay.riders!;
    expect(r.own).toHaveLength(1);
    expect(r.defaultId).toBe(r.own[0]!.id);
    expect(r.freelancers.length).toBeGreaterThan(0);
    for (const f of r.freelancers) expect(f.fee).toBe(gc.freelanceFee(f.grade, 2_000));
  });
});
