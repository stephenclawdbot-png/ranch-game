import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../client";
import { declaredRivals, fraudEvents, racePicks } from "../schema";
import { gc } from "../gameCore";
import { recordAccountSignal } from "../services/accounts";
import { ensureReferralCode } from "../services/affiliates";
import { getBalance } from "../services/ledger";
import { cancelRace, createRace, enterRace, getRaceForSimulation, scratchEntry, settleRace } from "../services/races";
import { makePick, racePickView, scorePicks, tipsterProfile, tipsterWeek, todaysPicks } from "../services/picks";
import { acceptRivalInvite, declaredRivalsOf, rivalsView } from "../services/rivals";
import { DAY, MIN, at, expectDbError, makeHorse, memoryDb, newPlayer } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const FINISH_US = 70_000_000;
let slot = 0;

/** A Live race (post time base+10 min, entries close at +9 min) with the given entries, not yet run. */
async function openRace(entries: { accountId: string; horseId: string }[], day = 0) {
  const base = day * DAY + ++slot * 20 * MIN;
  const r = await createRace(h.db, {
    kind: "scheduled",
    name: `Pick Stakes ${slot}`,
    raceClass: "maiden",
    conditions: { distanceM: 1200, surface: "turf", track: "Saltmarsh" },
    postTime: at(base + 10 * MIN),
    entriesCloseAt: at(base + 9 * MIN),
    targetRunners: Math.max(2, entries.length),
    purse: 1_000,
  });
  for (const e of entries) await enterRace(h.db, { ...e, raceId: r.id, tactic: "stalker", now: at(base) });
  return { race: r, base };
}

/** Runs and settles it with `order` in front, 61 s after the off; the result is public at +80 s. */
async function run(r: { id: string; postTime: Date }, order: string[]) {
  const now = new Date(r.postTime.getTime() + 61_000);
  const { field } = await getRaceForSimulation(h.db, r.id, now);
  const full = [...order, ...field.runners.map((x) => x.horseId).filter((id) => !order.includes(id))];
  const finishOrder = full.map((horseId, i) => ({ horseId, position: i + 1, finishTimeUs: FINISH_US - (full.length - 1 - i) * 100_000, marginMm: i ? 5_000 : 0, marginLabel: i ? "2" : "", prize: 0 }));
  await settleRace(h.db, { raceId: r.id, now, resultHash: "0".repeat(64), result: { finishOrder, winningTimeUs: FINISH_US, photoFinish: false, resultHash: "0".repeat(64) }, runners: full.map((horseId, i) => ({ horseId, position: i + 1 })) });
  return { now, after: new Date(r.postTime.getTime() + 80_000) };
}

describe("pick the winner", () => {
  it("opens with the card, closes at the off, scores by rating rank only once the result is public", async () => {
    const owners = [await newPlayer(h.db), await newPlayer(h.db), await newPlayer(h.db)];
    const tipster = await newPlayer(h.db);
    const late = await newPlayer(h.db);
    const hs = [
      await makeHorse(h.db, owners[0]!.stableId, { name: "Top Rated", rating: 70 }),
      await makeHorse(h.db, owners[1]!.stableId, { name: "Middle Way", rating: 55 }),
      await makeHorse(h.db, owners[2]!.stableId, { name: "Long Shot", rating: 40 }),
    ];
    const { race, base } = await openRace(owners.map((o, i) => ({ accountId: o.accountId, horseId: hs[i]!.id })));

    // before entries close (declared field), change of mind allowed
    await makePick(h.db, { accountId: tipster.accountId, raceId: race.id, horseId: hs[0]!.id, now: at(base + MIN) });
    await makePick(h.db, { accountId: tipster.accountId, raceId: race.id, horseId: hs[2]!.id, now: at(base + 2 * MIN) });
    // an owner may pick (even their own runner): nothing of value is at stake
    await makePick(h.db, { accountId: owners[0]!.accountId, raceId: race.id, horseId: hs[0]!.id, now: at(base + 3 * MIN) });
    const view = await racePickView(h.db, { raceId: race.id, stableId: tipster.stableId, now: at(base + 3 * MIN) });
    expect(view).toMatchObject({ open: true, picks: 2, mine: { horseId: hs[2]!.id, outcome: "open" } });
    expect(view!.runners.map((r) => [r.horseName, r.pointsIfWins])).toEqual([["Top Rated", 10], ["Middle Way", 30], ["Long Shot", 50]]);

    // not a runner; at or after the off: refused
    const stranger = await makeHorse(h.db, late.stableId);
    await expectDbError(makePick(h.db, { accountId: late.accountId, raceId: race.id, horseId: stranger.id, now: at(base + 4 * MIN) }), /isn't declared/);
    await expectDbError(makePick(h.db, { accountId: late.accountId, raceId: race.id, horseId: hs[1]!.id, now: race.postTime }), /closed at the off/);
    await expectDbError(makePick(h.db, { accountId: tipster.accountId, raceId: race.id, horseId: hs[0]!.id, now: new Date(race.postTime.getTime() + 1) }), /closed at the off/);

    const { now, after } = await run(race, [hs[2]!.id, hs[0]!.id, hs[1]!.id]);
    // settled but the broadcast isn't over: nothing scored, nothing revealed
    expect(await scorePicks(h.db, { now })).toBe(0);
    expect((await racePickView(h.db, { raceId: race.id, stableId: tipster.stableId, now }))!.mine).toMatchObject({ outcome: "open", points: 0 });
    expect((await tipsterWeek(h.db, { now })).rows.find((r) => r.stableId === tipster.stableId)).toBeUndefined();

    expect(await scorePicks(h.db, { now: after })).toBe(2);
    expect(await scorePicks(h.db, { now: after })).toBe(0); // once
    const mine = (await racePickView(h.db, { raceId: race.id, stableId: tipster.stableId, now: after }))!.mine;
    expect(mine).toMatchObject({ outcome: "won", points: 50 });
    const owner = (await racePickView(h.db, { raceId: race.id, stableId: owners[0]!.stableId, now: after }))!.mine;
    expect(owner).toMatchObject({ outcome: "lost", points: 0 });

    const week = await tipsterWeek(h.db, { now: after });
    expect(week.rows[0]).toMatchObject({ stableId: tipster.stableId, points: 50, wins: 1, picks: 1, position: 1, badge: true });
    expect(week.rows.find((r) => r.stableId === owners[0]!.stableId)).toMatchObject({ points: 0, badge: false });
    const prof = await tipsterProfile(h.db, { stableId: tipster.stableId, now: after });
    expect(prof).toMatchObject({ week: { points: 50, position: 1 }, bestWeek: 50, allTimePoints: 50, streak: { current: 1, best: 1 } });
  });

  it("voids picks on runners that don't run and on called-off races", async () => {
    const a = await newPlayer(h.db);
    const b = await newPlayer(h.db);
    const c = await newPlayer(h.db);
    const tipster = await newPlayer(h.db);
    const ha = await makeHorse(h.db, a.stableId, { rating: 60 });
    const hb = await makeHorse(h.db, b.stableId, { rating: 50 });
    const hc = await makeHorse(h.db, c.stableId, { rating: 45 });
    const { race, base } = await openRace([
      { accountId: a.accountId, horseId: ha.id },
      { accountId: b.accountId, horseId: hb.id },
      { accountId: c.accountId, horseId: hc.id },
    ]);
    await makePick(h.db, { accountId: tipster.accountId, raceId: race.id, horseId: hc.id, now: at(base + MIN) });
    await scratchEntry(h.db, { accountId: c.accountId, raceId: race.id, horseId: hc.id, now: at(base + 2 * MIN) });
    const { after } = await run(race, [ha.id, hb.id]);
    await scorePicks(h.db, { now: after });
    const [p] = await h.db.select().from(racePicks).where(eq(racePicks.raceId, race.id));
    expect(p).toMatchObject({ outcome: "void", points: 0 });

    const off = await openRace([{ accountId: a.accountId, horseId: ha.id }], 1);
    await makePick(h.db, { accountId: tipster.accountId, raceId: off.race.id, horseId: ha.id, now: at(off.base + MIN) });
    await cancelRace(h.db, { raceId: off.race.id, now: at(off.base + 9 * MIN), reason: "test" });
    await expectDbError(makePick(h.db, { accountId: b.accountId, raceId: off.race.id, horseId: ha.id, now: at(off.base + 9 * MIN) }), /closed/);
    await scorePicks(h.db, { now: new Date(off.race.postTime.getTime() + 1) });
    const [q] = await h.db.select().from(racePicks).where(eq(racePicks.raceId, off.race.id));
    expect(q).toMatchObject({ outcome: "void" });
    // void picks don't count in the table
    expect((await tipsterWeek(h.db, { now: after })).rows.find((r) => r.stableId === tipster.stableId)).toBeUndefined();
  });

  it("resets the table every Monday UTC; Home lists races open for picks", async () => {
    const a = await newPlayer(h.db);
    const b = await newPlayer(h.db);
    const tipster = await newPlayer(h.db);
    const ha = await makeHorse(h.db, a.stableId, { rating: 60 });
    const hb = await makeHorse(h.db, b.stableId, { rating: 50 });
    // T0 is Monday 2026-11-02 12:00 UTC: day 6 is Sunday, day 7 the next Monday
    const sunday = await openRace([{ accountId: a.accountId, horseId: ha.id }, { accountId: b.accountId, horseId: hb.id }], 6);
    const home = await todaysPicks(h.db, { stableId: tipster.stableId, now: at(sunday.base + MIN), limit: 10 });
    expect(home.upcoming.some((r) => r.raceId === sunday.race.id && r.mine === null)).toBe(true);
    await makePick(h.db, { accountId: tipster.accountId, raceId: sunday.race.id, horseId: ha.id, now: at(sunday.base + MIN) });
    expect((await todaysPicks(h.db, { stableId: tipster.stableId, now: at(sunday.base + MIN), limit: 10 })).upcoming.find((r) => r.raceId === sunday.race.id)!.mine).not.toBeNull();
    const sun = await run(sunday.race, [ha.id, hb.id]);
    expect((await tipsterWeek(h.db, { now: sun.after })).rows.find((r) => r.stableId === tipster.stableId)).toMatchObject({ points: 10 });
    expect((await todaysPicks(h.db, { stableId: tipster.stableId, now: sun.after })).recent[0]).toMatchObject({ outcome: "won", points: 10 });

    const monday = at(7 * DAY + MIN);
    expect(gc.tipsterWeekStartMs(monday.getTime())).toBeGreaterThan(sunday.race.postTime.getTime());
    const fresh = await tipsterWeek(h.db, { now: monday });
    expect(fresh.rows.find((r) => r.stableId === tipster.stableId)).toBeUndefined();
    const last = await tipsterWeek(h.db, { now: monday, weekStartMs: gc.tipsterWeekStartMs(sunday.race.postTime.getTime()) });
    expect(last.rows.find((r) => r.stableId === tipster.stableId)).toMatchObject({ points: 10, badge: true });
    const prof = await tipsterProfile(h.db, { stableId: tipster.stableId, now: monday });
    expect(prof.week.points).toBe(0);
    expect(prof.bestWeek).toBe(10);
    expect(prof.badges).toBeGreaterThanOrEqual(1);
  });
});

describe("bring a rival", () => {
  it("makes the two stables rivals both ways and pays both welcomes once", async () => {
    const inviter = await newPlayer(h.db);
    const code = await ensureReferralCode(h.db, inviter.accountId);
    const friend = await newPlayer(h.db);
    const before = { i: await getBalance(h.db, inviter.accountId), f: await getBalance(h.db, friend.accountId) };
    const res = await acceptRivalInvite(h.db, { inviteeAccountId: friend.accountId, code, now: at(MIN) });
    expect(res).toMatchObject({ ok: true, welcome: "granted", credits: { invitee: gc.RIVAL_INVITE_CREDITS, inviter: gc.RIVAL_INVITE_CREDITS } });
    expect(await getBalance(h.db, inviter.accountId)).toBe(before.i + gc.RIVAL_INVITE_CREDITS);
    expect(await getBalance(h.db, friend.accountId)).toBe(before.f + gc.RIVAL_INVITE_CREDITS);

    expect(await acceptRivalInvite(h.db, { inviteeAccountId: friend.accountId, code, now: at(2 * MIN) })).toEqual({ ok: false, problem: "already" });
    expect(await getBalance(h.db, friend.accountId)).toBe(before.f + gc.RIVAL_INVITE_CREDITS);
    expect(await acceptRivalInvite(h.db, { inviteeAccountId: inviter.accountId, code, now: at(2 * MIN) })).toEqual({ ok: false, problem: "self" });
    expect(await acceptRivalInvite(h.db, { inviteeAccountId: friend.accountId, code: "R-NOPE-NOPE", now: at(2 * MIN) })).toEqual({ ok: false, problem: "unknown_code" });

    expect(await declaredRivalsOf(h.db, inviter.stableId)).toMatchObject([{ stableId: friend.stableId, direction: "invited" }]);
    expect(await declaredRivalsOf(h.db, friend.stableId)).toMatchObject([{ stableId: inviter.stableId, direction: "invited_by" }]);
    const vi = await rivalsView(h.db, inviter.stableId, at(3 * MIN));
    const vf = await rivalsView(h.db, friend.stableId, at(3 * MIN));
    expect(vi.rivals[0]).toMatchObject({ stableId: friend.stableId, declared: "invited", meetings: 0 });
    expect(vf.rivals[0]).toMatchObject({ stableId: inviter.stableId, declared: "invited_by" });
  });

  it("refuses the welcome for linked accounts (same device or wallet) and caps the inviter's side weekly", async () => {
    const inviter = await newPlayer(h.db);
    const code = await ensureReferralCode(h.db, inviter.accountId);
    const alt = await newPlayer(h.db);
    await recordAccountSignal(h.db, { accountId: inviter.accountId, kind: "device", value: "browser-1" });
    await recordAccountSignal(h.db, { accountId: alt.accountId, kind: "device", value: "browser-1" });
    const before = await getBalance(h.db, alt.accountId);
    const res = await acceptRivalInvite(h.db, { inviteeAccountId: alt.accountId, code, now: at(MIN) });
    expect(res).toMatchObject({ ok: true, welcome: "refused", reason: "linked_accounts" });
    expect(await getBalance(h.db, alt.accountId)).toBe(before);
    const flagged = await h.db.select().from(fraudEvents).where(eq(fraudEvents.kind, "rival_invite_linked"));
    expect(flagged.some((f) => f.accountId === alt.accountId)).toBe(true);
    // still rivals (nothing of value moves)
    expect((await declaredRivalsOf(h.db, alt.stableId))[0]).toMatchObject({ stableId: inviter.stableId });

    const walletAlt = await newPlayer(h.db);
    await recordAccountSignal(h.db, { accountId: inviter.accountId, kind: "wallet", value: "0xabc" });
    await recordAccountSignal(h.db, { accountId: walletAlt.accountId, kind: "wallet", value: "0xABC" });
    expect(await acceptRivalInvite(h.db, { inviteeAccountId: walletAlt.accountId, code, now: at(MIN) })).toMatchObject({ welcome: "refused" });

    const start = await getBalance(h.db, inviter.accountId);
    for (let i = 0; i < gc.RIVAL_INVITE_WEEKLY_WELCOMES + 1; i++) {
      const f = await newPlayer(h.db);
      await acceptRivalInvite(h.db, { inviteeAccountId: f.accountId, code, now: at(2 * MIN) });
      expect(await getBalance(h.db, f.accountId)).toBe(5_000 + gc.RIVAL_INVITE_CREDITS);
    }
    expect(await getBalance(h.db, inviter.accountId)).toBe(start + gc.RIVAL_INVITE_WEEKLY_WELCOMES * gc.RIVAL_INVITE_CREDITS);
    expect((await h.db.select().from(declaredRivals).where(eq(declaredRivals.inviterStableId, inviter.stableId))).length).toBe(gc.RIVAL_INVITE_WEEKLY_WELCOMES + 3);
  });
});
