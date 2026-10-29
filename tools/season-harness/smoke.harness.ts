/**
 * Smoke test for the season harness (not part of any default suite: ~1 min).
 *   npx vitest run --config tools/season-harness/vitest.config.ts smoke
 *
 * Five stables (a casual, a grinder, a breeder, a farmer main and its alt) play twelve simulated hours twice
 * with the same seed. The metrics must be sane (Live races run and settle, players enter them,
 * the ledger balances and conserves credits, no unexpected exceptions) and the two runs must be
 * identical (determinism).
 */
import { expect, it, vi } from "vitest";
import { STARTER_GRANT } from "@thoroughbred/game-core";
import { defaultStartMs, type HarnessConfig } from "./src/config";
import type { RunResult } from "./src/run";
import { writeOutputs } from "./src/report";
import { sum } from "./src/stats";

const cfg: HarnessConfig = {
  tag: "smoke",
  seed: "smoke-1",
  // 08:00-20:00 UTC on the season's first day: no midnight in between.
  days: 0.5,
  startMs: defaultStartMs() + 8 * 3_600_000,
  stepMs: 0,
  cohorts: { casual: 1, grinder: 1, breeder: 1, farmer: 2 },
  altsPerMain: 1,
  detectedFarmerGroups: 0,
  compareTo: null,
  reportOnly: false,
  verbose: false,
};

/**
 * A run on freshly loaded game modules, as in a new server process: the server keeps
 * per-instance caches in module scope (e.g. the Daily Cup of the day), which a second run in
 * the same process would otherwise inherit.
 */
async function freshRun(cfg: HarnessConfig): Promise<RunResult> {
  vi.resetModules();
  const { runSeason } = await import("./src/run");
  return runSeason(cfg);
}

/** The comparable part of a run (no wall-clock fields). */
const comparable = (r: RunResult) => JSON.stringify({ days: r.days, totals: r.totals, outcomes: r.outcomes, farmers: r.farmers, checks: r.checks, errors: r.errors });

it("a short season runs through the real server path, conserves credits and is deterministic", async () => {
  const { RULES } = await import("@thoroughbred/db");
  const run = { ...cfg, stepMs: RULES.slotMs };
  const a = await freshRun(run);
  await writeOutputs(run, a);

  expect(a.errors).toEqual([]);
  expect(a.checks.ledger.totalPostings).toBe(0);
  expect(a.checks.ledger.unbalancedTransactions).toEqual([]);
  expect(a.checks.ledger.driftedAccounts).toEqual([]);
  expect(a.checks.ledger.negativeAccounts).toEqual([]);
  expect(a.checks.conservation.ok).toBe(true);
  expect(a.checks.ok).toBe(true);

  const day = a.days[0]!;
  // Twelve hours of card at RULES.slotMs spacing, all settled (the first slot opens after the start).
  expect(a.totals.liveRaces).toBeGreaterThanOrEqual(Math.floor((12 * 3_600_000) / RULES.slotMs) - 1);
  expect(day.races.avgField).toBeGreaterThanOrEqual(RULES.minField);
  expect(sum(Object.values(day.startsPerStable))).toBeGreaterThan(0);
  expect(day.races.liveWithPlayers).toBeGreaterThan(0);
  expect(a.totals.created.starter_grant).toBe(a.meta.stables * STARTER_GRANT);
  expect(a.totals.created.purse ?? 0).toBeGreaterThan(0);
  expect(day.credits.playerTotal).toBe(sum(Object.values(a.totals.created)) - sum(Object.values(a.totals.destroyed)));

  const b = await freshRun(run);
  expect(comparable(b)).toBe(comparable(a));
});
