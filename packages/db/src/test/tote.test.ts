import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { fraudEvents, horses, ledgerAccounts, toteBets, totePools } from "../schema";
import { recordAccountSignal } from "../services/accounts";
import { economyHealth } from "../services/health";
import { getBalance, ledgerHealth } from "../services/ledger";
import { cancelRace, createRace, enterRace, listRaceEntries, lockField, scratchEntry, settleRace, type CreateRaceInput } from "../services/races";
import {
  confirmToteAdult,
  grantPracticeUsdg,
  myToteBets,
  myToteRace,
  placeToteBet,
  selfExcludeTote,
  setToteLimits,
  settleDueTote,
  settleTote,
  toteAdminStats,
  toteBoard,
  toteSettingsView,
  toteUsdgEnabled,
  type PlaceToteBetInput,
} from "../services/tote";
import { at, count, DAY, makeHorse, memoryDb, MIN, newPlayer, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const PRACTICE = { USDG_MODE: "practice" };
let n = 0;
let k = 0;

function liveRace(extra: Partial<CreateRaceInput> = {}) {
  return createRace(h.db, {
    kind: "scheduled",
    name: `Tote ${++n}`,
    raceClass: "handicap",
    conditions: { minRating: 0, maxRating: 140, distanceM: 1400, surface: "turf" },
    postTime: at(10 * MIN),
    entriesCloseAt: at(9 * MIN),
    purse: 3_000,
    maxRunners: 12,
    targetRunners: 6,
    ...extra,
  });
}

/** A race with `runners` player horses entered (one stable each). */
async function raceWithField(runners = 6, extra: Partial<CreateRaceInput> = {}) {
  const race = await liveRace({ targetRunners: runners, ...extra });
  const owners = [];
  for (let i = 0; i < runners; i++) {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId, { rating: 30 });
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: horse.id, tactic: "stalker", now: T0 });
    owners.push({ ...p, horseId: horse.id });
  }
  return { race, owners };
}

async function bettor(credits = 50_000) {
  const p = await newPlayer(h.db, { credits });
  await confirmToteAdult(h.db, { accountId: p.accountId, now: T0 });
  return p;
}

function bet(accountId: string, raceId: string, horseId: string, stake: number, extra: Partial<PlaceToteBetInput> = {}) {
  return placeToteBet(h.db, { accountId, raceId, horseId, pool: "win", currency: "CR", stake, clientKey: `k${++k}`, now: at(5 * MIN), ...extra }, { dbClock: false });
}

/** Locks the field and settles the race with the given finishing order (positions may tie). */
async function runRace(raceId: string, positions: Record<string, number>, now = at(10 * MIN)) {
  await lockField(h.db, raceId, at(9 * MIN));
  const entries = await listRaceEntries(h.db, raceId);
  const order = [...entries].sort((a, b) => (positions[a.horseId] ?? 99) - (positions[b.horseId] ?? 99));
  await settleRace(h.db, {
    raceId,
    now,
    resultHash: "0".repeat(64),
    result: { order: order.map((e) => e.horseId) },
    runners: order.map((e, i) => ({ horseId: e.horseId, position: positions[e.horseId] ?? i + 1 })),
  });
}

async function house(currency: "CR" | "TUSDG" = "CR") {
  const [r] = await h.db.select({ b: ledgerAccounts.balance }).from(ledgerAccounts).where(and(eq(ledgerAccounts.kind, "tote_house"), eq(ledgerAccounts.currency, currency)));
  return r?.b ?? 0;
}

async function ledgerClean() {
  const health = await ledgerHealth(h.db);
  expect(health.totalPostings).toBe(0);
  expect(health.unbalancedTransactions).toEqual([]);
  expect(health.driftedAccounts).toEqual([]);
  expect(health.negativeAccounts).toEqual([]);
}

describe("the tote: pools, settlement and the house take", () => {
  it("pays winners pro rata, sends take + rounding to tote_house, and balances exactly (idempotent)", async () => {
    const { race, owners } = await raceWithField(6);
    const [a, b, c] = [await bettor(), await bettor(), await bettor()];
    const [w, x, y] = owners.map((o) => o.horseId);
    const houseBefore = await house();
    await bet(a.accountId, race.id, w!, 100);
    await bet(b.accountId, race.id, w!, 33);
    await bet(c.accountId, race.id, x!, 200);
    await bet(a.accountId, race.id, y!, 17);
    await bet(a.accountId, race.id, w!, 50, { pool: "place" });
    await bet(c.accountId, race.id, y!, 70, { pool: "place" });
    expect(await getBalance(h.db, a.accountId)).toBe(50_000 - 167);

    // Live odds on the board: pool maths only.
    const board = (await toteBoard(h.db, race.id, at(5 * MIN)))!;
    expect(board.status).toBe("open");
    expect(board.places).toBe(2);
    const win = board.pools[0]!.win;
    expect(win.total).toBe(350);
    expect(win.runners.find((r) => r.horseId === w)!.oddsMilli).toBe(Math.floor((298 * 1000) / 133));

    // Not before the race has run; not before the result is public.
    expect((await settleTote(h.db, race.id, at(10 * MIN))).reason).toBe("not_run");
    const positions = Object.fromEntries(owners.map((o, i) => [o.horseId, i + 1]));
    await runRace(race.id, positions);
    expect((await settleTote(h.db, race.id, at(10 * MIN))).reason).toBe("not_public");
    expect(await count(h.db, "tote_pools", `race_id = '${race.id}'`)).toBe(0);
    expect((await toteBoard(h.db, race.id, at(10 * MIN)))!.audit).toEqual([]);

    expect((await settleTote(h.db, race.id, at(30 * MIN))).settled).toBe(true);
    const winPool = (await h.db.select().from(totePools).where(and(eq(totePools.raceId, race.id), eq(totePools.pool, "win"))))[0]!;
    expect(winPool).toMatchObject({ total: 350, takeout: 52, outcome: "paid", winningTickets: 2, bettors: 3, tickets: 4 });
    expect(winPool.paid + winPool.takeout + winPool.remainder).toBe(winPool.total);
    const aWin = Math.floor((298 * 100) / 133);
    const bWin = Math.floor((298 * 33) / 133);
    expect(winPool.paid).toBe(aWin + bWin);
    // place: 2 places from 6 runners; w (1st) backed, y (3rd) not placed -> w takes the net place pool.
    const placePool = (await h.db.select().from(totePools).where(and(eq(totePools.raceId, race.id), eq(totePools.pool, "place"))))[0]!;
    expect(placePool).toMatchObject({ total: 120, takeout: 18, places: 2, paid: 102, remainder: 0 });
    expect(await getBalance(h.db, a.accountId)).toBe(50_000 - 167 + aWin + 102);
    expect(await getBalance(h.db, b.accountId)).toBe(50_000 - 33 + bWin);
    expect(await getBalance(h.db, c.accountId)).toBe(50_000 - 270);
    expect((await house()) - houseBefore).toBe(350 - aWin - bWin + 18);

    // Idempotent: settling again changes nothing.
    expect((await settleTote(h.db, race.id, at(40 * MIN))).settled).toBe(false);
    expect(await getBalance(h.db, a.accountId)).toBe(50_000 - 167 + aWin + 102);
    const audit = (await toteBoard(h.db, race.id, at(40 * MIN)))!;
    expect(audit.status).toBe("settled");
    expect(audit.audit.every((r) => r.balanced)).toBe(true);
    const mine = await myToteBets(h.db, a.accountId, { now: at(40 * MIN) });
    expect(mine.summary[0]).toMatchObject({ currency: "CR", staked: 167, returned: aWin + 102 });
    await ledgerClean();
  });

  it("dead heat for first: each dead-heated runner's backers share half the net win pool", async () => {
    const { race, owners } = await raceWithField(6);
    const [a, b, c] = [await bettor(), await bettor(), await bettor()];
    const [w1, w2, x] = owners.map((o) => o.horseId);
    await bet(a.accountId, race.id, w1!, 100);
    await bet(b.accountId, race.id, w2!, 300);
    await bet(c.accountId, race.id, x!, 600);
    await runRace(race.id, { [w1!]: 1, [w2!]: 1, [x!]: 3 });
    await settleTote(h.db, race.id, at(30 * MIN));
    const [p] = await h.db.select().from(totePools).where(and(eq(totePools.raceId, race.id), eq(totePools.pool, "win")));
    expect(p).toMatchObject({ total: 1000, takeout: 150, paid: 850, remainder: 0 });
    expect(await getBalance(h.db, a.accountId)).toBe(50_000 - 100 + 425);
    expect(await getBalance(h.db, b.accountId)).toBe(50_000 - 300 + 425);
    await ledgerClean();
  });

  it("nobody backed the winner: the net pool goes back to every staker (no carryover)", async () => {
    const { race, owners } = await raceWithField(6);
    const [a, b] = [await bettor(), await bettor()];
    await bet(a.accountId, race.id, owners[1]!.horseId, 100);
    await bet(b.accountId, race.id, owners[2]!.horseId, 300);
    await runRace(race.id, Object.fromEntries(owners.map((o, i) => [o.horseId, i + 1])));
    await settleTote(h.db, race.id, at(30 * MIN));
    expect(await getBalance(h.db, a.accountId)).toBe(50_000 - 100 + 85);
    expect(await getBalance(h.db, b.accountId)).toBe(50_000 - 300 + 255);
    const bets = await h.db.select().from(toteBets).where(eq(toteBets.raceId, race.id));
    expect(bets.every((x) => x.status === "returned")).toBe(true);
    const [p] = await h.db.select().from(totePools).where(eq(totePools.raceId, race.id));
    expect(p!.outcome).toBe("no_winner");
    expect(p!.paid + p!.takeout + p!.remainder).toBe(p!.total);
  });

  it("a scratched horse's stakes are refunded in full and leave the pool", async () => {
    const { race, owners } = await raceWithField(6);
    const a = await bettor();
    await bet(a.accountId, race.id, owners[0]!.horseId, 200);
    await bet(a.accountId, race.id, owners[1]!.horseId, 100);
    await scratchEntry(h.db, { accountId: owners[0]!.accountId, raceId: race.id, horseId: owners[0]!.horseId, now: at(6 * MIN) });
    expect(await getBalance(h.db, a.accountId)).toBe(50_000 - 100);
    const board = (await toteBoard(h.db, race.id, at(6 * MIN)))!;
    expect(board.pools[0]!.win.total).toBe(100);
    const [v] = await h.db.select().from(toteBets).where(and(eq(toteBets.raceId, race.id), eq(toteBets.horseId, owners[0]!.horseId)));
    expect(v).toMatchObject({ status: "void", payout: 200 });
    expect(v!.voidReason).toMatch(/non-runner/);
    await ledgerClean();
  });

  it("an abandoned race refunds every stake, no take", async () => {
    const { race, owners } = await raceWithField(6);
    const a = await bettor();
    const houseBefore = await house();
    await bet(a.accountId, race.id, owners[0]!.horseId, 300);
    await bet(a.accountId, race.id, owners[1]!.horseId, 200, { pool: "place" });
    await cancelRace(h.db, { raceId: race.id, now: at(9 * MIN), reason: "test" });
    expect(await getBalance(h.db, a.accountId)).toBe(50_000);
    expect(await house()).toBe(houseBefore);
    expect((await toteBoard(h.db, race.id, at(20 * MIN)))!.status).toBe("abandoned");
    const pools = await h.db.select().from(totePools).where(eq(totePools.raceId, race.id));
    expect(pools.map((p) => p.outcome)).toEqual(["abandoned", "abandoned"]);
    expect(await settleDueTote(h.db, at(30 * MIN))).not.toContain(race.id);
    await ledgerClean();
  });
});

describe("the window: bets close at the off", () => {
  it("refuses a bet at or after the post time, accepts one a moment before", async () => {
    const { race, owners } = await raceWithField(5);
    const a = await bettor();
    await expect(bet(a.accountId, race.id, owners[0]!.horseId, 50, { now: new Date(race.postTime.getTime() - 1) })).resolves.toBeDefined();
    await expect(bet(a.accountId, race.id, owners[0]!.horseId, 50, { now: race.postTime })).rejects.toMatchObject({ code: "RACE_CLOSED" });
    await expect(bet(a.accountId, race.id, owners[0]!.horseId, 50, { now: at(20 * MIN) })).rejects.toMatchObject({ code: "RACE_CLOSED" });
  });

  it("checks the off against the database clock, whatever time the caller claims", async () => {
    const real = Date.now();
    const race = await liveRace({ postTime: new Date(real - 60_000), entriesCloseAt: new Date(real - 90_000) });
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId);
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: horse.id, tactic: "front", now: new Date(real - 120_000) });
    const a = await bettor();
    // The caller says it is two minutes ago (before the off); the database clock says otherwise.
    await expect(
      placeToteBet(h.db, { accountId: a.accountId, raceId: race.id, horseId: horse.id, pool: "win", currency: "CR", stake: 50, clientKey: `k${++k}`, now: new Date(real - 120_000) }),
    ).rejects.toMatchObject({ code: "RACE_CLOSED" });
  });

  it("no tote on Story races, and a double tap places one bet", async () => {
    const quick = await liveRace({ kind: "quick" });
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId);
    await enterRace(h.db, { accountId: p.accountId, raceId: quick.id, horseId: horse.id, tactic: "front", now: T0 });
    const a = await bettor();
    await expect(bet(a.accountId, quick.id, horse.id, 50)).rejects.toMatchObject({ code: "TOTE_UNAVAILABLE" });
    expect(await toteBoard(h.db, quick.id, T0)).toBeNull();
    const { race, owners } = await raceWithField(5);
    const one = await bet(a.accountId, race.id, owners[0]!.horseId, 40, { clientKey: "same" });
    const two = await bet(a.accountId, race.id, owners[0]!.horseId, 40, { clientKey: "same" });
    expect(two.id).toBe(one.id);
    expect(await getBalance(h.db, a.accountId)).toBe(50_000 - 40);
  });

  it("no place pool under 5 runners", async () => {
    const { race, owners } = await raceWithField(4, { targetRunners: 4 });
    const a = await bettor();
    await expect(bet(a.accountId, race.id, owners[0]!.horseId, 40, { pool: "place" })).rejects.toMatchObject({ code: "TOTE_UNAVAILABLE" });
  });
});

describe("integrity", () => {
  it("refuses owners and lease partners of a runner", async () => {
    const { race, owners } = await raceWithField(5);
    await confirmToteAdult(h.db, { accountId: owners[0]!.accountId, now: T0 });
    await expect(bet(owners[0]!.accountId, race.id, owners[1]!.horseId, 50)).rejects.toMatchObject({ code: "TOTE_CONFLICT" });
    // a stable leasing a (different) horse to the owner of a runner
    const lessor = await bettor();
    const leased = await makeHorse(h.db, lessor.stableId);
    await h.db.update(horses).set({ lesseeStableId: owners[1]!.stableId }).where(eq(horses.id, leased.id));
    await expect(bet(lessor.accountId, race.id, owners[2]!.horseId, 50)).rejects.toMatchObject({ code: "TOTE_CONFLICT" });
    const view = (await myToteRace(h.db, lessor.accountId, race.id, at(5 * MIN)))!;
    expect(view.canBet).toMatchObject({ ok: false, reason: "conflict" });
  });

  it("refuses linked accounts with a fraud event", async () => {
    const { race, owners } = await raceWithField(5);
    const alt = await bettor();
    await recordAccountSignal(h.db, { accountId: owners[2]!.accountId, kind: "device", value: `tote-dev-${race.id}` });
    await recordAccountSignal(h.db, { accountId: alt.accountId, kind: "device", value: `tote-dev-${race.id}` });
    await expect(bet(alt.accountId, race.id, owners[0]!.horseId, 50)).rejects.toMatchObject({ code: "LINKED_ACCOUNTS" });
    const ev = await h.db.select().from(fraudEvents).where(and(eq(fraudEvents.accountId, alt.accountId), eq(fraudEvents.kind, "tote_linked_bet_blocked")));
    expect(ev).toHaveLength(1);
  });

  it("voids and refunds a bet when the bettor (or a linked account) enters a runner afterwards", async () => {
    const { race, owners } = await raceWithField(5);
    const a = await bettor();
    await bet(a.accountId, race.id, owners[0]!.horseId, 100);
    const mine = await makeHorse(h.db, a.stableId, { rating: 30 });
    await enterRace(h.db, { accountId: a.accountId, raceId: race.id, horseId: mine.id, tactic: "front", now: at(1 * MIN) });
    const [v] = await h.db.select().from(toteBets).where(eq(toteBets.accountId, a.accountId));
    expect(v).toMatchObject({ status: "void", payout: 100 });
    expect(await count(h.db, "ledger_transactions", `kind = 'tote_refund' and meta->>'betId' = '${v!.id}'`)).toBe(1);

    const b = await bettor();
    await bet(b.accountId, race.id, owners[1]!.horseId, 60);
    const friend = await newPlayer(h.db);
    await recordAccountSignal(h.db, { accountId: friend.accountId, kind: "device", value: `void-dev-${race.id}` });
    await recordAccountSignal(h.db, { accountId: b.accountId, kind: "device", value: `void-dev-${race.id}` });
    const fh = await makeHorse(h.db, friend.stableId, { rating: 30 });
    await enterRace(h.db, { accountId: friend.accountId, raceId: race.id, horseId: fh.id, tactic: "front", now: at(2 * MIN) });
    expect((await h.db.select().from(toteBets).where(eq(toteBets.accountId, b.accountId)))[0]!.status).toBe("void");
    expect(await count(h.db, "fraud_events", `kind = 'tote_linked_bet_voided' and account_id = '${b.accountId}'`)).toBe(1);
    await ledgerClean();
  });

  it("flags a conservative ride when accounts later linked to its connections bet against it", async () => {
    const race = await liveRace({ targetRunners: 5 });
    const owners = [];
    for (let i = 0; i < 5; i++) {
      const p = await newPlayer(h.db);
      const horse = await makeHorse(h.db, p.stableId, { rating: 30 });
      await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: horse.id, tactic: "stalker", now: T0, meta: i === 0 ? { plan: { intensity: "conservative" } } : {} });
      owners.push({ ...p, horseId: horse.id });
    }
    const punter = await bettor();
    await bet(punter.accountId, race.id, owners[1]!.horseId, 200);
    // the link shows up only after the bet
    await recordAccountSignal(h.db, { accountId: owners[0]!.accountId, kind: "fingerprint", value: `fp-${race.id}` });
    await recordAccountSignal(h.db, { accountId: punter.accountId, kind: "fingerprint", value: `fp-${race.id}` });
    await runRace(race.id, Object.fromEntries(owners.map((o, i) => [o.horseId, 5 - i])));
    await settleTote(h.db, race.id, at(30 * MIN));
    expect(await count(h.db, "fraud_events", `kind = 'tote_conservative_ride_linked_bettor' and related_account_id = '${punter.accountId}'`)).toBe(1);
  });
});

describe("limits, self-exclusion and 18+", () => {
  it("needs the 18+ confirmation first", async () => {
    const { race, owners } = await raceWithField(5);
    const p = await newPlayer(h.db);
    await expect(bet(p.accountId, race.id, owners[0]!.horseId, 50)).rejects.toMatchObject({ code: "TOTE_AGE_CONFIRM" });
    await confirmToteAdult(h.db, { accountId: p.accountId, now: T0 });
    await expect(bet(p.accountId, race.id, owners[0]!.horseId, 50)).resolves.toBeDefined();
  });

  it("enforces the minimum, the per-race cap (1,000 or 10 % of balance) and the daily cap", async () => {
    const { race, owners } = await raceWithField(5);
    const poor = await bettor(2_000);
    await expect(bet(poor.accountId, race.id, owners[0]!.horseId, 9)).rejects.toMatchObject({ code: "TOTE_LIMIT" });
    await bet(poor.accountId, race.id, owners[0]!.horseId, 150);
    await expect(bet(poor.accountId, race.id, owners[1]!.horseId, 60)).rejects.toMatchObject({ code: "TOTE_LIMIT" }); // 10 % of 2,000 = 200
    await bet(poor.accountId, race.id, owners[1]!.horseId, 50);

    const rich = await bettor(1_000_000);
    await expect(bet(rich.accountId, race.id, owners[0]!.horseId, 1_001)).rejects.toMatchObject({ code: "TOTE_LIMIT" });
    // the daily cap across races
    for (let i = 0; i < 5; i++) {
      const r = await raceWithField(5);
      await bet(rich.accountId, r.race.id, r.owners[0]!.horseId, 1_000);
    }
    const last = await raceWithField(5);
    await expect(bet(rich.accountId, last.race.id, last.owners[0]!.horseId, 10)).rejects.toMatchObject({ code: "TOTE_LIMIT", message: expect.stringMatching(/daily/) });
    // the next UTC day is fresh
    const tomorrow = await raceWithField(5, { postTime: at(DAY + 10 * MIN), entriesCloseAt: at(DAY + 9 * MIN) });
    await expect(bet(rich.accountId, tomorrow.race.id, tomorrow.owners[0]!.horseId, 10, { now: at(DAY + 5 * MIN) })).resolves.toBeDefined();
  });

  it("own limits: lowering is immediate, a raise waits 24 h", async () => {
    const { race, owners } = await raceWithField(5);
    const a = await bettor();
    await setToteLimits(h.db, { accountId: a.accountId, currency: "CR", perRace: 100, perDay: 300, now: T0 });
    await expect(bet(a.accountId, race.id, owners[0]!.horseId, 101)).rejects.toMatchObject({ code: "TOTE_LIMIT" });
    const raised = await setToteLimits(h.db, { accountId: a.accountId, currency: "CR", perRace: 500, perDay: null, now: at(MIN) });
    expect(raised.limits.CR).toEqual({ perRace: 100, perDay: 300 });
    expect(raised.pending?.CR).toEqual({ perRace: 500, perDay: null });
    await expect(bet(a.accountId, race.id, owners[0]!.horseId, 101)).rejects.toMatchObject({ code: "TOTE_LIMIT" });
    const later = await toteSettingsView(h.db, a.accountId, at(MIN + gc.TOTE_LIMIT_RAISE_DELAY_MS));
    expect(later.limits.CR).toEqual({ perRace: 500, perDay: null });
    expect(later.pending).toBeNull();
    await expect(setToteLimits(h.db, { accountId: a.accountId, currency: "CR", perRace: 5, perDay: null, now: T0 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("self-exclusion refuses bets and can't be shortened", async () => {
    const { race, owners } = await raceWithField(5);
    const a = await bettor();
    await selfExcludeTote(h.db, { accountId: a.accountId, choice: "7d", now: T0 });
    await expect(bet(a.accountId, race.id, owners[0]!.horseId, 50)).rejects.toMatchObject({ code: "TOTE_EXCLUDED" });
    const v = await selfExcludeTote(h.db, { accountId: a.accountId, choice: "24h", now: at(MIN) });
    expect(v.excludedUntilMs).toBe(T0.getTime() + 7 * DAY);
    const after = await raceWithField(5, { postTime: at(8 * DAY), entriesCloseAt: at(8 * DAY - MIN) });
    await expect(bet(a.accountId, after.race.id, after.owners[0]!.horseId, 50, { now: at(7 * DAY + MIN) })).resolves.toBeDefined();
    const b = await bettor();
    await selfExcludeTote(h.db, { accountId: b.accountId, choice: "permanent", now: T0 });
    await expect(bet(b.accountId, after.race.id, after.owners[0]!.horseId, 50, { now: at(7 * DAY + MIN) })).rejects.toMatchObject({ code: "TOTE_EXCLUDED" });
    expect((await selfExcludeTote(h.db, { accountId: b.accountId, choice: "24h", now: at(MIN) })).excludedPermanent).toBe(true);
  });
});

describe("T-USDG: practice mode only", () => {
  it("is impossible in live, mock and off modes (and when unset)", async () => {
    const { race, owners } = await raceWithField(5);
    const a = await bettor();
    await grantPracticeUsdg(h.db, { accountId: a.accountId, amount: 20 * gc.TOTE_USDG_UNIT, idempotencyKey: `grant:${a.accountId}`, env: PRACTICE });
    for (const env of [{ USDG_MODE: "live" }, { USDG_MODE: "mock" }, { USDG_MODE: "off" }, {}]) {
      expect(toteUsdgEnabled(env)).toBe(false);
      await expect(bet(a.accountId, race.id, owners[0]!.horseId, gc.TOTE_USDG_UNIT, { currency: "TUSDG", env })).rejects.toMatchObject({ code: "TOTE_UNAVAILABLE" });
      expect((await toteBoard(h.db, race.id, at(5 * MIN), env))!.currencies).toEqual(["CR"]);
      await expect(grantPracticeUsdg(h.db, { accountId: a.accountId, amount: 1, idempotencyKey: `g2:${a.accountId}`, env })).rejects.toMatchObject({ code: "TOTE_UNAVAILABLE" });
    }
    expect(await count(h.db, "tote_bets", `account_id = '${a.accountId}'`)).toBe(0);
  });

  it("in practice mode runs its own pools on the practice ledger, never touching credits", async () => {
    const { race, owners } = await raceWithField(5);
    const [a, b] = [await bettor(), await bettor()];
    for (const p of [a, b]) await grantPracticeUsdg(h.db, { accountId: p.accountId, amount: 20 * gc.TOTE_USDG_UNIT, idempotencyKey: `grant:${p.accountId}`, env: PRACTICE });
    await expect(bet(a.accountId, race.id, owners[0]!.horseId, gc.TOTE_USDG_UNIT / 4, { currency: "TUSDG", env: PRACTICE })).rejects.toMatchObject({ code: "TOTE_LIMIT" });
    await expect(bet(a.accountId, race.id, owners[0]!.horseId, 11 * gc.TOTE_USDG_UNIT, { currency: "TUSDG", env: PRACTICE })).rejects.toMatchObject({ code: "TOTE_LIMIT" });
    await bet(a.accountId, race.id, owners[0]!.horseId, 2 * gc.TOTE_USDG_UNIT, { currency: "TUSDG", env: PRACTICE });
    await bet(b.accountId, race.id, owners[1]!.horseId, 3 * gc.TOTE_USDG_UNIT, { currency: "TUSDG", env: PRACTICE });
    await bet(b.accountId, race.id, owners[0]!.horseId, 100);
    const board = (await toteBoard(h.db, race.id, at(5 * MIN), PRACTICE))!;
    expect(board.currencies).toEqual(["CR", "TUSDG"]);
    expect(board.pools.find((p) => p.currency === "TUSDG")!.win.total).toBe(5 * gc.TOTE_USDG_UNIT);
    expect(await getBalance(h.db, a.accountId)).toBe(50_000);
    await runRace(race.id, Object.fromEntries(owners.map((o, i) => [o.horseId, i + 1])));
    await settleTote(h.db, race.id, at(30 * MIN));
    const net = 5 * gc.TOTE_USDG_UNIT - gc.toteTakeout(5 * gc.TOTE_USDG_UNIT);
    expect(await getBalance(h.db, a.accountId, "TUSDG")).toBe(18 * gc.TOTE_USDG_UNIT + net);
    expect(await getBalance(h.db, a.accountId)).toBe(50_000);
    expect(await house("TUSDG")).toBeGreaterThanOrEqual(gc.toteTakeout(5 * gc.TOTE_USDG_UNIT));
    // economy health counts credits only
    const eh = await economyHealth(h.db, { now: at(30 * MIN), days: 7 });
    expect(eh.tote.volume).toBeGreaterThan(0);
    const stats = await toteAdminStats(h.db, at(30 * MIN));
    expect(stats.byCurrency.find((c) => c.currency === "TUSDG")!.takeWeek).toBeGreaterThan(0);
    expect(stats.biggest.length).toBeGreaterThan(0);
    await ledgerClean();
  });
});
