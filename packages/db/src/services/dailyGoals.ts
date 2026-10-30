/**
 * Daily goals (AUDIT §6, owner decisions 2026-10-26: pay 3 × 60; 2026-10-30: 3 × 45): three small jobs per player
 * per LOCAL day — run a race, care for a horse, run the Daily Cup — each paying its credits
 * automatically when the action completes. No streaks, no missed-day notices: the goals
 * reset quietly each local day (the same boundary as care sessions, `careDayOf`).
 *
 * Completion is the `daily_goals` row (PK: account, local date, goal) and the payment is a
 * `daily_goal` ledger transaction idempotent on `daily-goal:<account>:<day>:<goal>`, so
 * retries, double taps and concurrent requests pay once. Callers pass their own transaction
 * (`enterRace`, `careTx`, `runCupEntry`), so the goal completes with the action or not at all.
 */
import { and, eq } from "drizzle-orm";
import { gc } from "../gameCore";
import { dailyGoalEnum, dailyGoals } from "../schema";
import type { Executor, Tx } from "../types";
import { careDayOf } from "./horseLife";
import { grantCreditsTx } from "./ledger";

export type DailyGoal = (typeof dailyGoalEnum.enumValues)[number];

/** The three goals, in display order. */
export const DAILY_GOALS: readonly { goal: DailyGoal; label: string }[] = [
  { goal: "race", label: "Run a race" },
  { goal: "care", label: "Care for a horse" },
  { goal: "cup", label: "Run the Daily Cup" },
];

export interface CompleteGoalInput {
  accountId: string;
  goal: DailyGoal;
  now: Date;
}

/**
 * Marks the day's goal done and pays it (idempotent): true when this call completed it,
 * false when it was already done today. The ledger post comes first with its deterministic
 * key, so a duplicate pays nothing and only the first completer keeps the row.
 */
export async function completeGoal(tx: Tx, input: CompleteGoalInput): Promise<boolean> {
  const day = await careDayOf(tx, input.accountId, input.now);
  const paid = await grantCreditsTx(tx, {
    accountId: input.accountId,
    amount: gc.DAILY_GOAL_CREDITS,
    idempotencyKey: `daily-goal:${input.accountId}:${day}:${input.goal}`,
    kind: "daily_goal",
    memo: `Daily goal: ${DAILY_GOALS.find((g) => g.goal === input.goal)?.label ?? input.goal}`,
  });
  const inserted = await tx
    .insert(dailyGoals)
    .values({ accountId: input.accountId, localDate: day, goal: input.goal, completedAt: input.now, ledgerTxId: paid.transactionId })
    .onConflictDoNothing({ target: [dailyGoals.accountId, dailyGoals.localDate, dailyGoals.goal] })
    .returning({ accountId: dailyGoals.accountId });
  return inserted.length > 0;
}

export interface DailyGoalView {
  goal: DailyGoal;
  label: string;
  done: boolean;
  credits: number;
}

/** Today's three goals (the player's local day), each with its done flag and credits. */
export async function goalsForToday(ex: Executor, accountId: string, now: Date): Promise<DailyGoalView[]> {
  const day = await careDayOf(ex, accountId, now);
  const rows = await ex
    .select({ goal: dailyGoals.goal })
    .from(dailyGoals)
    .where(and(eq(dailyGoals.accountId, accountId), eq(dailyGoals.localDate, day)));
  const done = new Set(rows.map((r) => r.goal));
  return DAILY_GOALS.map(({ goal, label }) => ({ goal, label, done: done.has(goal), credits: gc.DAILY_GOAL_CREDITS }));
}