/**
 * The Live wait (first-hour follow-up): the soonest race first (a meeting in progress often still
 * has later races open), who else is in so far, a race to watch now, and only the things a stable
 * can actually do while it waits. Outcome-free throughout.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as gc from "@thoroughbred/game-core";
import { RULES, createAccount, isClaimingRace, listCardRaces, stableOf, type DbHandle, createDb } from "@thoroughbred/db";
import { LIVE_FIRST_WAIT_POINTS, LIVE_GOOD_FIT, LIVE_WAIT_STEP_MS, chooseLiveRace, driveCard, entryOptions, quickPickLive } from "./game";
import { WATCH_SOON_MS, liveWaitView } from "./liveWait";

let h: DbHandle;
beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

const clock = { epochMs: RULES.seasonEpochMs };
const SILKS = { pattern: "hoops", primary: "#1f4e9c", secondary: "#f3e7c9", cap: "#1f4e9c" } as const;

async function stable(name: string, now: Date) {
  const acc = await createAccount(h.db, { stableName: name, startingCredits: 20_000, silks: { ...SILKS }, timezone: "Europe/London", starterHorses: 3, now });
  return { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) };
}

describe("the Live wait", () => {
  it("points a new stable at the soonest race its horses can run (a later race of the meeting in progress), shows who else is in, a race to watch now and only available actions", { timeout: 240_000 }, async () => {
    // 20 minutes into a meeting: its first two races are off, the last two still open.
    const meeting = gc.meetingsOn(clock, Date.UTC(2026, 10, 12)).find((m) => new Date(m.startMs).getUTCHours() === 13)!;
    const now = new Date(meeting.startMs + 20 * 60_000);
    // Players who entered the meeting's early races, so there is something running to watch.
    await driveCard(h.db, new Date(meeting.startMs - 60 * 60_000), { force: true });
    const early = await stable("Early Bird Yard", new Date(meeting.startMs - 60 * 60_000));
    await quickPickLive(h.db, early, new Date(meeting.startMs - 60 * 60_000));
    await driveCard(h.db, now, { force: true });

    const a = await stable("Soonest Yard", now);
    // The race the entry sheet's own numbers make soonest-first: the best fit once an hour of waiting
    // costs 4 x LIVE_FIRST_WAIT_POINTS (a new stable: no Live race yet), up to the first good fit.
    const card = (await listCardRaces(h.db, { from: new Date(now.getTime() + 1), to: new Date(now.getTime() + RULES.cardHorizonMs), stableId: a.stable.id }))
      .filter((r) => r.status === "open" && r.entriesCloseAt.getTime() > now.getTime() + 5_000 && !isClaimingRace(r))
      .sort((x, y) => x.postTime.getTime() - y.postTime.getTime())
      .slice(0, 12);
    let expected: { id: string; score: number; postMs: number } | null = null;
    let oldRule: { id: string; loss: number; postMs: number } | null = null;
    for (const r of card) {
      const sheet = await entryOptions(h.db, a, r.id, now);
      const losses = sheet.options.filter((o) => o.reason === null).map((o) => o.fitLoss);
      if (!losses.length) continue;
      const loss = Math.min(...losses);
      const bonus = 6 * Math.min(Number(r.stables), 4); // other players in it
      const score = loss - bonus + LIVE_FIRST_WAIT_POINTS * Math.floor((r.postTime.getTime() - card[0]!.postTime.getTime()) / LIVE_WAIT_STEP_MS);
      if (!oldRule || loss < oldRule.loss) oldRule = { id: r.id, loss, postMs: r.postTime.getTime() };
      if (!expected || score < expected.score) expected = { id: r.id, score, postMs: r.postTime.getTime() };
      if (loss - bonus <= LIVE_GOOD_FIT) break;
    }
    expect(expected).not.toBeNull();
    const choice = (await chooseLiveRace(h.db, a, now))!;
    expect(choice.race.id).toBe(expected!.id);
    // Never later than the best fit on the card (the old rule): usually much sooner.
    expect(choice.race.postTime.getTime()).toBeLessThanOrEqual(oldRule!.postMs);

    // Not entered yet: the wait card suggests that same soonest race.
    const before = await liveWaitView(h.db, a, null, now);
    expect(before.race).toBeNull();
    expect(before.soonest?.raceId).toBe(choice.race.id);

    // Entered (Quick Pick takes the same race), and a second stable joins it.
    const pick = await quickPickLive(h.db, a, now);
    expect(pick.raceId).toBe(choice.race.id);
    const b = await stable("Second Yard", now);
    const sheetB = await entryOptions(h.db, b, pick.raceId, now);
    const horseB = sheetB.options.find((o) => o.reason === null);
    if (horseB) {
      const { enterLive } = await import("./game");
      await enterLive(h.db, b, pick.raceId, horseB.horseId, { tactic: "stalker", intensity: "normal" }, now);
    }
    const wait = await liveWaitView(h.db, a, pick.raceId, now);
    expect(wait.race).toMatchObject({ id: pick.raceId, entriesOpen: true, otherStables: horseB ? 1 : 0 });
    expect(wait.soonest).toBeNull();
    // A race to watch now: never your own, running or going off within WATCH_SOON_MS.
    if (wait.watchNow) {
      expect(wait.watchNow.raceId).not.toBe(pick.raceId);
      expect(wait.watchNow.postTimeMs).toBeLessThanOrEqual(now.getTime() + WATCH_SOON_MS);
    }
    // Only available actions, at most three: the stable has horses that haven't been cared for and a Cup run.
    expect(wait.actions.length).toBeGreaterThan(0);
    expect(wait.actions.length).toBeLessThanOrEqual(3);
    for (const x of wait.actions) expect(["story", "care", "cup", "quick"]).toContain(x.key);
    // Outcome-free: nothing about a result in the view.
    expect(JSON.stringify(wait)).not.toMatch(/seed|finish|winner|position/i);
  });
});
