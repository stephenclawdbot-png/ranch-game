/**
 * Honest Club ratings (2026-10-30; the rules are game-core clubFill.ts).
 *
 * Until now a Club ("house") horse minted to fill a Live race was an untrained racing-age novice
 * stamped with its band's midpoint as its rating: a horse rated 62 ran like a 29. Production holds
 * many of them. `recalibrateClubRatings` sets every such racing Club horse's stored rating (and
 * peak) to its real ability mark, once per horse: it marks the horse (dynamics.clubMark) and never
 * touches a marked one again, so from then on the rating moves with results like any horse's.
 * Newly minted Club runners are born marked (gameCore.ts clubRunnerSpec).
 *
 * It runs from runMaintenance (idempotent; it only finds horses that came back from a Club sale
 * lot or were missed while locked), and once at the first field lock after deploy
 * (`ensureClubCalibrated`, guarded by an economy_config marker row), so pool selection is honest
 * from the first race. No migration: the marker is a config row, the per-horse mark a dynamics key.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { CLUB_MARK_KEY, gc, isGenome, toHorseState } from "../gameCore";
import { horses, type HorseRow } from "../schema";
import type { Db, Executor } from "../types";
import { getConfig, setConfig } from "./competition";
import { runTx } from "./tx";

/** economy_config key set once the first full recalibration has run. */
export const CLUB_CALIBRATION_MARKER = "club_ratings_calibrated_v1";

/** Rows per UPDATE statement. */
const BATCH = 200;

/** A horse's real ability mark (its stored rating when the row has no game-core genome). */
export function trueMarkOf(row: HorseRow): number {
  return isGenome(row.genome) ? gc.abilityMark(toHorseState(row)) : row.rating;
}

/**
 * Sets every unmarked racing Club horse's rating and peak to its real ability mark and marks it.
 * Horses locked in a race or on a Club sale lot are left for a later run (their rating is part of
 * an entry or a listing); rows another transaction holds are skipped (SKIP LOCKED). Idempotent.
 */
export async function recalibrateClubRatings(ex: Executor, now: Date): Promise<{ recalibrated: number; lowered: number }> {
  const rows = await ex
    .select()
    .from(horses)
    .where(
      and(
        isNull(horses.ownerStableId),
        eq(horses.origin, "house"),
        eq(horses.careerStatus, "racing"),
        isNull(horses.lockKind),
        sql`(${horses.dynamics}->>${CLUB_MARK_KEY}) is null`,
      ),
    )
    .orderBy(horses.id)
    .for("update", { skipLocked: true });
  let lowered = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH).map((r) => {
      const mark = gc.clampInt(trueMarkOf(r), 0, 140);
      if (mark < r.rating) lowered++;
      return { id: r.id, mark };
    });
    const values = sql.join(
      chunk.map((c) => sql`(${c.id}::uuid, ${c.mark}::int)`),
      sql`, `,
    );
    await ex.execute(sql`
      update horses h
         set rating = v.mark,
             dynamics = h.dynamics || jsonb_build_object('peakOr', v.mark, ${CLUB_MARK_KEY}::text, v.mark),
             updated_at = ${now.toISOString()}::timestamptz
        from (values ${values}) as v(id, mark)
       where h.id = v.id`);
  }
  return { recalibrated: rows.length, lowered };
}

/**
 * The one-off recalibration at the first field lock after deploy: runs it unless the marker row
 * says it has run (cheap: one primary-key read per lock afterwards). Inside the caller's transaction.
 */
export async function ensureClubCalibrated(ex: Executor, now: Date): Promise<void> {
  if (await getConfig<unknown>(ex, CLUB_CALIBRATION_MARKER, null)) return;
  await markCalibrated(ex, now, await recalibrateClubRatings(ex, now));
}

async function markCalibrated(ex: Executor, now: Date, r: { recalibrated: number; lowered: number }): Promise<void> {
  await setConfig(ex, CLUB_CALIBRATION_MARKER, { at: now.toISOString(), ...r }, "Club horses' ratings set to their real ability marks (services/clubFill.ts)");
}

/** The maintenance step: recalibrates any unmarked Club horse and sets the marker if it isn't set. Returns how many it recalibrated. */
export async function sweepClubRatings(db: Db, now: Date): Promise<number> {
  return runTx(db, async (tx) => {
    const r = await recalibrateClubRatings(tx, now);
    if (!(await getConfig<unknown>(tx, CLUB_CALIBRATION_MARKER, null))) await markCalibrated(tx, now, r);
    return r.recalibrated;
  });
}
