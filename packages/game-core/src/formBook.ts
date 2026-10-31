/**
 * The form book: splits (win-place-runs and average beaten distance) of settled runs by the
 * conditions they were run under, and the best and worst condition for a horse, a stable or a
 * sire's offspring. Pure and integer-only: the caller passes settled runs only (never a race
 * still running), so nothing here can spoil a result.
 *
 * Buckets:
 *   - going, surface, course, tactic and jockey: the stored value;
 *   - distance: genome.distanceBand (sprint < 1,300 m, mile < 1,750 m, middle < 2,300 m, staying);
 *   - draw: the gate's third of the field (drawBucket: low, mid, high);
 *   - rest: whole days since the same horse's previous settled run in the list (restBucket).
 * A run missing a value (an old race without a course, a gate never drawn) is left out of that
 * dimension only. Buckets under MIN_SPLIT_RUNS runs are flagged `small`: shown greyed, never
 * picked as best or worst. When every candidate is level on every measure, neither is named.
 */
import { distanceBand } from "./genome";
import { MS_PER_DAY } from "./time";

/** One settled run, as the form book needs it. */
export interface SplitRun {
  horseId: string;
  raceId: string;
  postTimeMs: number;
  /** Finishing position, 1 = won. */
  position: number;
  fieldSize: number;
  /** Distance behind the winner in mm (0 for the winner); null when the result has no margins. */
  beatenMm: number | null;
  going: string | null;
  surface: string | null;
  course: string | null;
  distanceM: number | null;
  tactic: string | null;
  /** The jockey's name once jockeys have names, else the booked tier ("apprentice", "top" ...). */
  jockey: string | null;
  gate: number | null;
}

export type SplitDimension = "going" | "distance" | "surface" | "course" | "tactic" | "jockey" | "draw" | "rest";
export const SPLIT_DIMENSIONS: readonly SplitDimension[] = ["going", "distance", "surface", "course", "tactic", "jockey", "draw", "rest"];

/** Fewer runs than this in a bucket: a small sample (greyed, never best or worst). */
export const MIN_SPLIT_RUNS = 3;

export interface SplitBucket {
  key: string;
  runs: number;
  wins: number;
  seconds: number;
  thirds: number;
  /** Sum of beaten distances over the runs that have one, and how many do. */
  beatenSumMm: number;
  beatenRuns: number;
  /** Average beaten distance, mm, floored (null when no run in the bucket has margins). */
  avgBeatenMm: number | null;
  /** Under MIN_SPLIT_RUNS runs. */
  small: boolean;
}

export interface SplitGroup {
  dimension: SplitDimension;
  buckets: SplitBucket[];
}

export interface SplitPick {
  dimension: SplitDimension;
  bucket: SplitBucket;
}

export interface FormSplits {
  total: SplitBucket;
  groups: SplitGroup[];
  /** Best and worst condition among buckets with enough runs, in dimensions with at least two of them. */
  best: SplitPick | null;
  worst: SplitPick | null;
}

/** Display order of known keys per dimension (unknown keys follow, alphabetically). */
const ORDER: Record<SplitDimension, readonly string[]> = {
  going: ["firm", "good", "soft", "heavy"],
  distance: ["sprint", "mile", "middle", "staying"],
  surface: ["turf", "dirt", "synthetic"],
  course: [],
  tactic: ["front", "stalker", "closer"],
  jockey: ["apprentice", "journeyman", "top"],
  draw: ["low", "mid", "high"],
  rest: ["first", "same_day", "1_2_days", "3_6_days", "7_plus_days"],
};

/** The gate's third of the field: low (inside), mid, high (outside). Null without a gate. */
export function drawBucket(gate: number | null, fieldSize: number): "low" | "mid" | "high" | null {
  if (gate === null || gate < 1 || fieldSize < 1) return null;
  const third = Math.floor(((Math.min(gate, fieldSize) - 1) * 3) / fieldSize);
  return third <= 0 ? "low" : third === 1 ? "mid" : "high";
}

/** Rest before a run: null previous = the first run in the list. */
export function restBucket(prevPostTimeMs: number | null, postTimeMs: number): string {
  if (prevPostTimeMs === null) return "first";
  const days = Math.floor(Math.max(0, postTimeMs - prevPostTimeMs) / MS_PER_DAY);
  if (days < 1) return "same_day";
  if (days <= 2) return "1_2_days";
  if (days <= 6) return "3_6_days";
  return "7_plus_days";
}

/** Distance behind the winner (mm) of the runner finishing `position`, from each finisher's margin to the one ahead. */
export function beatenMmOf(finishOrder: readonly { position: number; marginMm: number }[], position: number): number | null {
  if (position < 1 || !finishOrder.length) return null;
  if (position === 1) return 0;
  let sum = 0;
  let seen = 0;
  for (const f of finishOrder) {
    if (f.position > 1 && f.position <= position) {
      sum += Math.max(0, Math.floor(f.marginMm));
      seen++;
    }
  }
  return seen > 0 ? sum : null;
}

function emptyBucket(key: string): SplitBucket {
  return { key, runs: 0, wins: 0, seconds: 0, thirds: 0, beatenSumMm: 0, beatenRuns: 0, avgBeatenMm: null, small: true };
}

function add(b: SplitBucket, r: SplitRun): void {
  b.runs++;
  if (r.position === 1) b.wins++;
  else if (r.position === 2) b.seconds++;
  else if (r.position === 3) b.thirds++;
  if (r.beatenMm !== null) {
    b.beatenSumMm += r.beatenMm;
    b.beatenRuns++;
  }
}

function finish(b: SplitBucket): SplitBucket {
  return { ...b, avgBeatenMm: b.beatenRuns > 0 ? Math.floor(b.beatenSumMm / b.beatenRuns) : null, small: b.runs < MIN_SPLIT_RUNS };
}

function keyOf(dim: SplitDimension, r: SplitRun, rest: string): string | null {
  switch (dim) {
    case "going":
      return r.going;
    case "surface":
      return r.surface;
    case "course":
      return r.course;
    case "tactic":
      return r.tactic;
    case "jockey":
      return r.jockey;
    case "distance":
      return r.distanceM !== null && r.distanceM > 0 ? distanceBand(r.distanceM) : null;
    case "draw":
      return drawBucket(r.gate, r.fieldSize);
    case "rest":
      return rest;
  }
}

function orderIndex(dim: SplitDimension, key: string): number {
  const i = ORDER[dim].indexOf(key);
  return i < 0 ? ORDER[dim].length : i;
}

/**
 * Better first: smaller average beaten distance (compared exactly, as fractions), then a higher
 * win rate, a higher top-three rate, more runs. Buckets without margins rank after those with.
 */
export function compareBuckets(a: SplitBucket, b: SplitBucket): number {
  if ((a.beatenRuns > 0) !== (b.beatenRuns > 0)) return a.beatenRuns > 0 ? -1 : 1;
  if (a.beatenRuns > 0) {
    const d = a.beatenSumMm * b.beatenRuns - b.beatenSumMm * a.beatenRuns;
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  const w = b.wins * a.runs - a.wins * b.runs;
  if (w !== 0) return w < 0 ? -1 : 1;
  const top = (x: SplitBucket) => x.wins + x.seconds + x.thirds;
  const p = top(b) * a.runs - top(a) * b.runs;
  if (p !== 0) return p < 0 ? -1 : 1;
  return b.runs - a.runs;
}

/** Splits of settled runs. Runs may come in any order and from several horses (a stable, a sire line). */
export function formSplits(runs: readonly SplitRun[]): FormSplits {
  // Rest: each horse's runs in time order (ties by race id, so the result never depends on input order).
  const sorted = [...runs].sort((a, b) => a.postTimeMs - b.postTimeMs || (a.raceId < b.raceId ? -1 : a.raceId > b.raceId ? 1 : 0) || (a.horseId < b.horseId ? -1 : a.horseId > b.horseId ? 1 : 0));
  const prev = new Map<string, number>();
  const rest = new Map<SplitRun, string>();
  for (const r of sorted) {
    rest.set(r, restBucket(prev.get(r.horseId) ?? null, r.postTimeMs));
    prev.set(r.horseId, r.postTimeMs);
  }

  const total = emptyBucket("all");
  const maps = new Map<SplitDimension, Map<string, SplitBucket>>(SPLIT_DIMENSIONS.map((d) => [d, new Map()]));
  for (const r of sorted) {
    add(total, r);
    for (const dim of SPLIT_DIMENSIONS) {
      const key = keyOf(dim, r, rest.get(r)!);
      if (key === null || key === "") continue;
      const m = maps.get(dim)!;
      let b = m.get(key);
      if (!b) m.set(key, (b = emptyBucket(key)));
      add(b, r);
    }
  }

  const groups: SplitGroup[] = SPLIT_DIMENSIONS.map((dimension) => ({
    dimension,
    buckets: [...maps.get(dimension)!.values()]
      .map(finish)
      .sort((a, b) => orderIndex(dimension, a.key) - orderIndex(dimension, b.key) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  }));

  // Candidates: enough runs, in a dimension where at least two buckets have enough runs.
  const candidates: { pick: SplitPick; dimIndex: number; bucketIndex: number }[] = [];
  groups.forEach((g, dimIndex) => {
    const ok = g.buckets.filter((b) => !b.small);
    if (ok.length < 2) return;
    for (const b of ok) candidates.push({ pick: { dimension: g.dimension, bucket: b }, dimIndex, bucketIndex: g.buckets.indexOf(b) });
  });
  const tie = (a: (typeof candidates)[number], b: (typeof candidates)[number]) => a.dimIndex - b.dimIndex || a.bucketIndex - b.bucketIndex;
  const bestFirst = [...candidates].sort((a, b) => compareBuckets(a.pick.bucket, b.pick.bucket) || tie(a, b));
  const worstFirst = [...candidates].sort((a, b) => compareBuckets(b.pick.bucket, a.pick.bucket) || tie(a, b));
  const best = bestFirst[0]?.pick ?? null;
  const worst = worstFirst.find((c) => c.pick !== best)?.pick ?? null;
  // Every candidate level on every measure: nothing stands out, so name neither.
  if (!best || !worst || compareBuckets(best.bucket, worst.bucket) === 0) return { total: finish(total), groups, best: null, worst: null };
  return { total: finish(total), groups, best, worst };
}

/** "2-1-0 from 3": wins, seconds, thirds from runs. */
export function splitRecord(b: Pick<SplitBucket, "wins" | "seconds" | "thirds" | "runs">): string {
  return `${b.wins}-${b.seconds}-${b.thirds} from ${b.runs}`;
}
