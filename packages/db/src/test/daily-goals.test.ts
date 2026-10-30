/**
 * Daily goals (AUDIT §6, 3 × 45): each goal pays once per player per LOCAL day, resets the
 * next day, and is completed by the real actions (enterRace, careForHorse, runCupEntry).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { runCupEntry } from "../services/dailyCup";
import { completeGoal, goalsForToday } from "../services/dailyGoals";
import { careForHorse } from "../services/horseLife";
import { getBalance } from "../services/ledger";
import { createRace, enterRace } from "../services/races";
import { runTx } from "../services/tx";
import { at, count, DAY, makeHorse, memoryDb, MIN, newPlayer, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const GOAL = gc.DAILY_GOAL_CREDITS;
let raceNo = 0;

/** An open race the player's horse can enter (story quick races are free to enter). */
function openRace(offsetMs = 0) {
  return createRace(h.db, {
    kind: "quick",
    name: `Goal race ${++raceNo}`,
    raceClass: "maiden",
    conditions: { distanceM: 1200, surface: "turf" },
    postTime: at(offsetMs + 10 * MIN),
    entriesCloseAt: at(offsetMs + 9 * MIN),
    targetRunners: 2,
  });
}

async function doneGoals(accountId: string, now: Date): Promise<string[]> {
  return (await goalsForToday(h.db, accountId, now)).filter((g) => g.done).map((g) => g.goal);
}

describe("daily goals", () => {
  it("pays the goal reward once per goal per local day (a double call pays once)", async () => {
    const p = await newPlayer(h.db, { credits: 0 });
    const first = await runTx(h.db, (tx) => completeGoal(tx, { accountId: p.accountId, goal: "race", now: T0 }));
    const again = await runTx(h.db, (tx) => completeGoal(tx, { accountId: p.accountId, goal: "race", now: T0 }));
    expect(first).toBe(true);
    expect(again).toBe(false);
    expect(await getBalance(h.db, p.accountId)).toBe(GOAL);
    expect(await count(h.db, "daily_goals", `account_id = '${p.accountId}'`)).toBe(1);
    expect(await count(h.db, "ledger_transactions", `kind = 'daily_goal'`)).toBe(1);
  });

  it("resets the next local day and keeps the three goals separate", async () => {
    const p = await newPlayer(h.db, { credits: 0 });
    for (const goal of ["race", "care", "cup"] as const) {
      expect(await runTx(h.db, (tx) => completeGoal(tx, { accountId: p.accountId, goal, now: T0 }))).toBe(true);
    }
    expect(await getBalance(h.db, p.accountId)).toBe(3 * GOAL);
    // The next local day: everything is open again.
    const tomorrow = at(DAY);
    expect(await doneGoals(p.accountId, tomorrow)).toEqual([]);
    expect(await runTx(h.db, (tx) => completeGoal(tx, { accountId: p.accountId, goal: "race", now: tomorrow }))).toBe(true);
    expect(await getBalance(h.db, p.accountId)).toBe(4 * GOAL);
  });

  it("balances through the ledger: the faucet is debited what the player is credited", async () => {
    const p = await newPlayer(h.db, { credits: 0 });
    await runTx(h.db, (tx) => completeGoal(tx, { accountId: p.accountId, goal: "care", now: T0 }));
    const res = await h.db.execute(sql`
      select a.kind as account_kind, p.amount::int as amount
        from daily_goals g
        join ledger_postings p on p.transaction_id = g.ledger_tx_id
        join ledger_accounts a on a.id = p.ledger_account_id
       where g.account_id = ${p.accountId} and g.goal = 'care'`);
    const rows = (Array.isArray(res) ? res : (res as unknown as { rows: unknown[] }).rows) as { account_kind: string; amount: number }[];
    const byKind = Object.fromEntries(rows.map((r) => [r.account_kind, r.amount]));
    expect(byKind.mint).toBe(-GOAL);
    expect(byKind.player).toBe(GOAL);
    expect(rows).toHaveLength(2);
  });

  it("never touches other accounts", async () => {
    const p = await newPlayer(h.db, { credits: 0 });
    const q = await newPlayer(h.db, { credits: 0 });
    await runTx(h.db, (tx) => completeGoal(tx, { accountId: p.accountId, goal: "race", now: T0 }));
    expect(await getBalance(h.db, q.accountId)).toBe(0);
    expect((await goalsForToday(h.db, q.accountId, T0)).every((g) => !g.done)).toBe(true);
    expect(await count(h.db, "daily_goals", `account_id = '${q.accountId}'`)).toBe(0);
  });

  it("entering a race completes the race goal (Live and Story go through enterRace)", async () => {
    const p = await newPlayer(h.db, { credits: 0 });
    const horse = await makeHorse(h.db, p.stableId);
    const race = await openRace();
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: horse.id, tactic: "front", now: T0 });
    expect(await doneGoals(p.accountId, T0)).toEqual(["race"]);
    expect(await getBalance(h.db, p.accountId)).toBe(GOAL);
    // A second race the same day pays nothing more.
    const race2 = await openRace();
    const other = await makeHorse(h.db, p.stableId);
    await enterRace(h.db, { accountId: p.accountId, raceId: race2.id, horseId: other.id, tactic: "front", now: at(MIN) });
    expect(await getBalance(h.db, p.accountId)).toBe(GOAL);
  });

  it("a backdated Story entry credits the goal on the wall clock's day (goalNow)", async () => {
    // An instant Story race enters with now = post time - 1s, ~10 min backdated: around
    // local midnight that is yesterday, and the goal must not land there.
    const p = await newPlayer(h.db, { credits: 0 }); // UTC
    const horse = await makeHorse(h.db, p.stableId);
    const wall = new Date(Date.UTC(2026, 10, 3, 0, 0, 30)); // 00:00:30 today
    const enterAt = new Date(wall.getTime() - 10 * MIN - 1_000); // 23:50:29 yesterday
    const postTime = new Date(Math.floor((wall.getTime() - 10 * MIN) / 1000) * 1000);
    const race = await createRace(h.db, {
      kind: "quick",
      name: "Backdated story",
      raceClass: "maiden",
      conditions: { distanceM: 1200, surface: "turf" },
      postTime,
      entriesCloseAt: postTime,
      targetRunners: 2,
    });
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: horse.id, tactic: "front", now: enterAt, goalNow: wall });
    expect(await doneGoals(p.accountId, wall)).toEqual(["race"]);
    expect(await doneGoals(p.accountId, enterAt)).toEqual([]);
    expect(await getBalance(h.db, p.accountId)).toBe(GOAL);
  });

  it("a counted care session completes the care goal (an already-cared horse doesn't)", async () => {
    const p = await newPlayer(h.db, { credits: 0 });
    const horse = await makeHorse(h.db, p.stableId);
    const res = await careForHorse(h.db, { accountId: p.accountId, horseId: horse.id, now: T0 });
    expect(res.counted).toBe(true);
    expect(await doneGoals(p.accountId, T0)).toContain("care");
    expect(await getBalance(h.db, p.accountId)).toBe(GOAL);
    // The same horse again today: no session, no goal, no credits.
    const noop = await careForHorse(h.db, { accountId: p.accountId, horseId: horse.id, now: at(MIN) });
    expect(noop.counted).toBe(false);
    expect(await getBalance(h.db, p.accountId)).toBe(GOAL);
  });

  it("running today's Cup completes the cup goal", async () => {
    const p = await newPlayer(h.db, { credits: 0 });
    const horse = await makeHorse(h.db, p.stableId);
    await runCupEntry(h.db, {
      accountId: p.accountId,
      horseId: horse.id,
      now: T0,
      credits: 0,
      run: () => ({ finishPosition: 1, finishTimeUs: 70_000_000, result: null }),
    });
    expect(await doneGoals(p.accountId, T0)).toContain("cup");
    expect(await getBalance(h.db, p.accountId)).toBe(GOAL);
  });

  it("goalsForToday shows all three with labels, done flags and credits", async () => {
    const p = await newPlayer(h.db, { credits: 0 });
    await runTx(h.db, (tx) => completeGoal(tx, { accountId: p.accountId, goal: "cup", now: T0 }));
    expect(await goalsForToday(h.db, p.accountId, T0)).toEqual([
      { goal: "race", label: "Run a race", done: false, credits: GOAL },
      { goal: "care", label: "Care for a horse", done: false, credits: GOAL },
      { goal: "cup", label: "Run the Daily Cup", done: true, credits: GOAL },
    ]);
  });
});