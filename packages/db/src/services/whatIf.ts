/**
 * "What if?" re-run cache (the `what_if_runs` table). The web layer (apps/web server/whatIf.ts)
 * re-simulates a settled race with one change to one runner and keeps the outcome here, keyed by
 * (race, horse, change), so asking the same question again costs nothing and the what-if replay
 * re-simulates exactly what was shown.
 *
 * A counterfactual only: this module writes nothing but its own rows. Settlement, ratings, form
 * lines, records, stats and the ledger never read `what_if_runs`.
 */
import { and, eq } from "drizzle-orm";
import { whatIfRuns, type WhatIfRunRow } from "../schema";
import type { Executor } from "../types";

export interface WhatIfKey {
  raceId: string;
  horseId: string;
  changeKey: string;
}

/** The cached re-run for (race, horse, change), or null. */
export async function getWhatIfRun(ex: Executor, key: WhatIfKey): Promise<WhatIfRunRow | null> {
  const [row] = await ex
    .select()
    .from(whatIfRuns)
    .where(and(eq(whatIfRuns.raceId, key.raceId), eq(whatIfRuns.horseId, key.horseId), eq(whatIfRuns.changeKey, key.changeKey)));
  return row ?? null;
}

/**
 * Stores a re-run once. A concurrent or repeated save of the same key keeps the first row (the
 * re-run is deterministic, so both computed the same thing) and returns it.
 */
export async function saveWhatIfRun(
  ex: Executor,
  input: WhatIfKey & { engineVersion: string; resolved: unknown; summary: unknown; stableId: string | null; now: Date },
): Promise<WhatIfRunRow> {
  await ex
    .insert(whatIfRuns)
    .values({
      raceId: input.raceId,
      horseId: input.horseId,
      changeKey: input.changeKey,
      engineVersion: input.engineVersion,
      resolved: input.resolved,
      summary: input.summary,
      stableId: input.stableId,
      createdAt: input.now,
    })
    .onConflictDoNothing({ target: [whatIfRuns.raceId, whatIfRuns.horseId, whatIfRuns.changeKey] });
  const row = await getWhatIfRun(ex, input);
  if (!row) throw new Error("what-if run vanished after insert");
  return row;
}
