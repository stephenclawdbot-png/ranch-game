/**
 * The form book (read-only): full form lines for a horse's or a stable's runs and the rows the
 * splits are computed from (game-core formBook.ts).
 *
 * Everything comes from what was stored at the time: the entry snapshot (plan, race-day extras,
 * jockey, the horse's condition at entry), the locked field (gate, field size, handicap weight)
 * and the settled result (position, margins, times, rating after, purse). Only small pieces of
 * the jsonb are selected in SQL (never a whole snapshot, field or result).
 *
 * No spoilers: result columns are read only for settled races (the result join and the mapping
 * both check), and a Live race settles only once its broadcast is over. A race still to run or
 * running shows as "declared" or "running", with no position, margin, time or rating after.
 */
import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { horses, raceEntries, raceResults, races } from "../schema";
import { gc } from "../gameCore";
import type { Executor } from "../types";

/** Columns of one run for the form line (shared with /me/races paging in player.ts). */
export const formColumns = {
  raceId: races.id,
  raceName: races.name,
  kind: races.kind,
  raceClass: races.raceClass,
  conditions: races.conditions,
  postTime: races.postTime,
  raceStatus: races.status,
  purse: races.purse,
  horseId: raceEntries.horseId,
  stableId: raceEntries.stableId,
  tactic: raceEntries.tactic,
  gate: raceEntries.gate,
  position: raceEntries.finishPosition,
  finishTimeUs: raceEntries.finishTimeUs,
  prize: raceEntries.prize,
  ratingBefore: raceEntries.ratingBefore,
  ratingAfter: raceEntries.ratingAfter,
  plan: sql<unknown>`${raceEntries.snapshot}->'plan'`,
  raceDay: sql<unknown>`${raceEntries.snapshot}->'raceDay'`,
  /** A named jockey, once the entry snapshot carries one (string or { name }). */
  jockey: sql<unknown>`${raceEntries.snapshot}->'jockey'`,
  /** The horse's game-core condition at entry: fatigue at the off is recovered from it. */
  condition: sql<unknown>`${raceEntries.snapshot}->'state'->'condition'`,
  fieldSize: sql<number>`coalesce(jsonb_array_length(${races.field}->'runners'), (select count(*)::int from race_entries x where x.race_id = ${races.id} and x.status = 'entered'))`,
  weight: sql<unknown>`(select jsonb_build_object('lb', r->'weightLb', 'extra', r->'extraWeightLb') from jsonb_array_elements(coalesce(${races.field}->'runners', '[]'::jsonb)) r where r->>'horseId' = ${raceEntries.horseId}::text limit 1)`,
  winningTimeUs: sql<unknown>`${raceResults.result}->'winningTimeUs'`,
  beatenMm: sql<unknown>`(select sum((f->>'marginMm')::bigint) from jsonb_array_elements(coalesce(${raceResults.result}->'finishOrder', '[]'::jsonb)) f where (f->>'position')::int between 2 and ${raceEntries.finishPosition})`,
  marginLabel: sql<unknown>`(select f->>'marginLabel' from jsonb_array_elements(coalesce(${raceResults.result}->'finishOrder', '[]'::jsonb)) f where f->>'horseId' = ${raceEntries.horseId}::text limit 1)`,
  /** The second's margin: what a winner won by. */
  wonByLabel: sql<unknown>`(select f->>'marginLabel' from jsonb_array_elements(coalesce(${raceResults.result}->'finishOrder', '[]'::jsonb)) f where (f->>'position')::int = 2 limit 1)`,
};

/** Joins the result only for a settled race (belt and braces with the mapping). */
export const resultJoin = and(eq(raceResults.raceId, races.id), eq(races.status, "settled"));

/** One selected run (formColumns, plus the horse's name where joined). */
export interface FormRow {
  raceId: string;
  raceName: string;
  kind: string;
  raceClass: string;
  conditions: unknown;
  postTime: Date;
  raceStatus: string;
  purse: number;
  horseId: string;
  stableId: string | null;
  tactic: string;
  gate: number | null;
  position: number | null;
  finishTimeUs: number | null;
  prize: number;
  ratingBefore: number;
  ratingAfter: number | null;
  plan: unknown;
  raceDay: unknown;
  jockey: unknown;
  condition: unknown;
  fieldSize: number;
  weight: unknown;
  winningTimeUs: unknown;
  beatenMm: unknown;
  marginLabel: unknown;
  wonByLabel: unknown;
  horseName?: string | null;
}

export interface FormLine {
  raceId: string;
  horseId: string;
  horseName?: string;
  /** settled: the result is in · running: past post time, not settled · declared: still to run. */
  status: "settled" | "running" | "declared";
  postTimeMs: number;
  raceName: string;
  raceClass: string;
  kind: "live" | "story";
  course: string | null;
  distanceM: number;
  surface: "turf" | "dirt" | "synthetic";
  going: "firm" | "good" | "soft" | "heavy";
  fieldSize: number;
  gate: number | null;
  tactic: string;
  intensity: string | null;
  /** Race-day extras bought with the entry (game-core RACE_EXTRA_KEYS). */
  extras: string[];
  jockey: { tier: string | null; name: string | null };
  /** Weight carried (Live handicaps since engine 1.4.0); null at level weights. */
  weightLb: number | null;
  extraWeightLb: number | null;
  /** Condition at the off, permille (keeper only; null for others and old entries). */
  fatigue: number | null;
  freshness: number | null;
  purse: number;
  ratingBefore: number;
  result: {
    position: number;
    beatenMm: number | null;
    /** Margin to the horse ahead ("neck", "1 1/4"); for a winner, what it won by. */
    marginLabel: string | null;
    winningTimeUs: number | null;
    timeUs: number | null;
    ratingAfter: number | null;
    prize: number;
  } | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

function condsOf(conditions: unknown) {
  const c = (conditions ?? {}) as Record<string, unknown>;
  const surface = c.surface === "dirt" || c.surface === "synthetic" ? c.surface : "turf";
  const going = c.going === "firm" || c.going === "soft" || c.going === "heavy" ? c.going : "good";
  return { distanceM: num(c.distanceM) ?? 1600, surface, going, course: str(c.track) } as const;
}

function jockeyName(v: unknown): string | null {
  if (typeof v === "string") return str(v);
  if (v && typeof v === "object") return str((v as { name?: unknown }).name);
  return null;
}

/** Fatigue and freshness at the off, from the condition stored at entry (physio applied). */
function atTheOff(condition: unknown, raceDay: gc.RaceDayChoice | null, postMs: number): { fatigue: number; freshness: number } | null {
  const c = condition as { fatigue?: unknown; fatigueAtMs?: unknown; lastHardWorkMs?: unknown; fitness?: unknown } | null;
  const fatigue = num(c?.fatigue);
  const fatigueAtMs = num(c?.fatigueAtMs);
  if (fatigue === null || fatigueAtMs === null) return null;
  const lastHard = c?.lastHardWorkMs === null ? null : num(c?.lastHardWorkMs);
  const state = { condition: { ...(c as object), fatigue, fatigueAtMs, lastHardWorkMs: lastHard } } as Pick<gc.HorseState, "condition">;
  const s = gc.withPhysio(state, raceDay, postMs);
  return { fatigue: gc.fatigueAt(s, postMs), freshness: gc.freshnessBar(s, postMs) };
}

/**
 * One stored run as a form line. `keeper`: the viewer keeps (or owns) the horse, so the plan's
 * intensity and its condition at the off are shown. A race that has not settled never carries
 * a result, whatever the entry row holds.
 */
export function formLineOf(row: FormRow, opts: { nowMs: number; keeper: boolean }): FormLine {
  const c = condsOf(row.conditions);
  const postMs = row.postTime.getTime();
  const settled = row.raceStatus === "settled" && row.position !== null && row.position !== undefined;
  const plan = (row.plan ?? null) as { tactic?: unknown; intensity?: unknown } | null;
  const rdRaw = row.raceDay as { jockey?: unknown } | null | undefined;
  const raceDay = rdRaw ? gc.parseRaceDay(rdRaw) : null;
  const w = (row.weight ?? null) as { lb?: unknown; extra?: unknown } | null;
  const off = opts.keeper ? atTheOff(row.condition, raceDay, postMs) : null;
  const position = settled ? Number(row.position) : 0;
  return {
    raceId: row.raceId,
    horseId: row.horseId,
    ...(row.horseName ? { horseName: row.horseName } : {}),
    status: settled ? "settled" : opts.nowMs >= postMs ? "running" : "declared",
    postTimeMs: postMs,
    raceName: row.raceName,
    raceClass: row.raceClass,
    kind: row.kind === "quick" ? "story" : "live",
    course: c.course,
    distanceM: c.distanceM,
    surface: c.surface,
    going: c.going,
    fieldSize: Number(row.fieldSize ?? 0),
    gate: num(row.gate),
    tactic: str(plan?.tactic) ?? row.tactic,
    intensity: opts.keeper ? str(plan?.intensity) : null,
    extras: raceDay ? [...raceDay.extras] : [],
    // Entries made before race-day jockeys rode with the stable apprentice.
    jockey: { tier: raceDay ? raceDay.jockey : row.kind === "quick" ? null : "apprentice", name: jockeyName(row.jockey) },
    weightLb: num(w?.lb),
    extraWeightLb: num(w?.extra),
    fatigue: off?.fatigue ?? null,
    freshness: off?.freshness ?? null,
    purse: Number(row.purse ?? 0),
    ratingBefore: Number(row.ratingBefore ?? 0),
    result: settled
      ? {
          position,
          beatenMm: position === 1 ? 0 : num(row.beatenMm),
          marginLabel: position === 1 ? str(row.wonByLabel) : str(row.marginLabel),
          winningTimeUs: num(row.winningTimeUs),
          timeUs: num(row.finishTimeUs),
          ratingAfter: num(row.ratingAfter),
          prize: Number(row.prize ?? 0),
        }
      : null,
  };
}

/** The game-core splits input of a settled form line (null for one without a result). */
export function splitRunOf(l: FormLine): gc.SplitRun | null {
  if (!l.result) return null;
  return {
    horseId: l.horseId,
    raceId: l.raceId,
    postTimeMs: l.postTimeMs,
    position: l.result.position,
    fieldSize: l.fieldSize,
    beatenMm: l.result.beatenMm,
    going: l.going,
    surface: l.surface,
    course: l.course,
    distanceM: l.distanceM,
    tactic: l.tactic,
    jockey: l.jockey.name ?? l.jockey.tier,
    gate: l.gate,
  };
}

/** A horse's runs (settled, running and declared; abandoned and scratched left out), newest first. */
export async function horseFormRows(ex: Executor, horseId: string, limit = 200): Promise<FormRow[]> {
  const rows = await ex
    .select(formColumns)
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .leftJoin(raceResults, resultJoin)
    .where(
      and(
        eq(raceEntries.horseId, horseId),
        eq(raceEntries.status, "entered"),
        or(and(eq(races.status, "settled"), isNotNull(raceEntries.finishPosition)), inArray(races.status, ["open", "locked"])),
      ),
    )
    .orderBy(desc(races.postTime), desc(races.id))
    .limit(limit);
  return rows as FormRow[];
}

/** Settled runs for splits: a stable's (optionally one horse's) or a sire's offspring, newest first. */
export async function settledFormRows(ex: Executor, q: { stableId?: string; horseId?: string | null; sireId?: string }, limit = 2000): Promise<FormRow[]> {
  const where = [eq(raceEntries.status, "entered"), eq(races.status, "settled"), isNotNull(raceEntries.finishPosition)];
  if (q.stableId) where.push(eq(raceEntries.stableId, q.stableId));
  if (q.horseId) where.push(eq(raceEntries.horseId, q.horseId));
  if (q.sireId) where.push(eq(horses.sireId, q.sireId));
  const rows = await ex
    .select({ ...formColumns, horseName: horses.name })
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .innerJoin(horses, eq(horses.id, raceEntries.horseId))
    .leftJoin(raceResults, resultJoin)
    .where(and(...where))
    .orderBy(desc(races.postTime), desc(races.id))
    .limit(limit);
  return rows as FormRow[];
}

/** Splits of form lines (only settled ones count). */
export function splitsOf(lines: readonly FormLine[]): gc.FormSplits {
  return gc.formSplits(lines.map(splitRunOf).filter((r): r is gc.SplitRun => r !== null));
}

/** Offspring of a sire that have run (for the sire-line view): how many horses the splits cover. */
export async function sireLineRunnerCount(ex: Executor, sireId: string): Promise<number> {
  const [row] = await ex
    .select({ n: sql<number>`count(distinct ${horses.id})::int` })
    .from(horses)
    .innerJoin(raceEntries, eq(raceEntries.horseId, horses.id))
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .where(and(eq(horses.sireId, sireId), eq(races.status, "settled"), isNotNull(raceEntries.finishPosition)));
  return Number(row?.n ?? 0);
}
