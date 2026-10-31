/**
 * The form book for the web app: a horse's full form lines and splits, a stable's splits, a
 * sire line's splits and the horse's log. The rows, the mapping and the splits live in
 * packages/db (formBook.ts, horseLog.ts) and game-core (formBook.ts); this module decides who
 * may see what:
 *   - form lines and splits are public (results are), but a horse's plan intensity and its
 *     condition at the off are shown to its keeper or owner only;
 *   - the horse's log (training, care, vet, ownership...) is for its keeper or owner only.
 * Nothing is read for a race that has not settled beyond its declaration: no spoilers.
 */
import * as gc from "@thoroughbred/game-core";
import { DomainError, getHorse, horseFormRows, horseLogPage, settledFormRows, sireLineRunnerCount, splitsOf, formLineOf, type Db, type FormLine, type HorseRow } from "@thoroughbred/db";
import type { FormLineView, HorseFormView, HorseLogView, SplitsView, StableFormBookView } from "@/lib/types";
import type { Session } from "./session";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** How many starts the horse page lists (a career is 40; Story runs come on top). */
export const HORSE_FORM_LIMIT = 200;

export function splitsView(s: gc.FormSplits): SplitsView {
  const b = (x: gc.SplitBucket) => ({ key: x.key, runs: x.runs, wins: x.wins, seconds: x.seconds, thirds: x.thirds, avgBeatenMm: x.avgBeatenMm, small: x.small });
  return {
    total: b(s.total),
    groups: s.groups.filter((g) => g.buckets.length > 0).map((g) => ({ dimension: g.dimension, buckets: g.buckets.map(b) })),
    best: s.best ? { dimension: s.best.dimension, bucket: b(s.best.bucket) } : null,
    worst: s.worst ? { dimension: s.worst.dimension, bucket: b(s.worst.bucket) } : null,
    minRuns: gc.MIN_SPLIT_RUNS,
  };
}

function lineView(l: FormLine): FormLineView {
  return l as FormLineView;
}

/** May this viewer see the horse's private side (keeper: may race it; owner: owns it)? */
export function keeperOrOwner(row: Pick<HorseRow, "ownerStableId" | "lesseeStableId">, session: Session | null): boolean {
  if (!session) return false;
  return session.stable.id === row.ownerStableId || session.stable.id === row.lesseeStableId;
}

/** A horse's form lines (newest first, declared and running races without a result) and splits. */
export async function horseForm(db: Db, row: HorseRow, session: Session | null, now: Date): Promise<HorseFormView> {
  const keeper = keeperOrOwner(row, session);
  const lines = (await horseFormRows(db, row.id, HORSE_FORM_LIMIT)).map((r) => formLineOf(r, { nowMs: now.getTime(), keeper }));
  return { lines: lines.map(lineView), splits: splitsView(splitsOf(lines)) };
}

/** A stallion's offspring splits (null when none of his foals has run). */
export async function sireLineSplits(db: Db, row: HorseRow, now: Date): Promise<{ runners: number; splits: SplitsView } | null> {
  if (row.sex !== "male") return null;
  const runners = await sireLineRunnerCount(db, row.id);
  if (runners === 0) return null;
  const lines = (await settledFormRows(db, { sireId: row.id })).map((r) => formLineOf(r, { nowMs: now.getTime(), keeper: false }));
  return { runners, splits: splitsView(splitsOf(lines)) };
}

/** The signed-in stable's splits: every horse it has run, or one of them. */
export async function stableFormBook(db: Db, session: Session, horseId: string | null, now: Date): Promise<StableFormBookView> {
  const id = horseId && UUID_RE.test(horseId) ? horseId : null;
  const lines = (await settledFormRows(db, { stableId: session.stable.id, horseId: id })).map((r) => formLineOf(r, { nowMs: now.getTime(), keeper: true }));
  return { horseId: id, splits: splitsView(splitsOf(lines)) };
}

/** One page of the horse's log, for its keeper or owner only (NOT_FOUND for anyone else). */
export async function horseLog(db: Db, session: Session, horseId: string, cursor: string | null, now: Date, limit = 30): Promise<HorseLogView> {
  if (!UUID_RE.test(horseId)) throw new DomainError("NOT_FOUND", "horse not found");
  const row = await getHorse(db, horseId);
  if (!row || !keeperOrOwner(row, session)) throw new DomainError("NOT_FOUND", "horse not found");
  const page = await horseLogPage(db, row, { now, cursor, limit, keeper: true });
  return { entries: page.entries.map((e) => ({ ...e, ...(e.line ? { line: lineView(e.line) } : {}) })), nextCursor: page.nextCursor };
}
