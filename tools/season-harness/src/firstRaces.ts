/**
 * First races probe (2026-11-20): what a brand-new stable's first Story races look like, through
 * the real server code on an in-memory database. Week-one data said 92% of testers ran a first
 * race and 24% came back; the first results read "Rating 40 -> 37, down 3". This measures, over
 * thousands of seeded stables:
 *   - where the stable finishes in its 1st, 2nd, 3rd ... Story race (win, top 3, last);
 *   - the chance of at least one win in the first five;
 *   - what the rating does over a horse's first three starts.
 *
 * Two players, both tapping what the game offers:
 *   - "open":    "Race now" every time (createStoryRace Quick Pick: the strongest fresh horse at
 *                its own conditions), five races on the founding day and four the next day, so
 *                each of the three starters has three starts;
 *   - "chapter": the first race from the starters screen, then Story chapter races the way the
 *                Story screen suggests (apps/web/src/server/storyProbe.ts, the game's own pick
 *                when tired).
 *
 * Every run is read back from the game's own tables (race_entries: finishing position, rating
 * before and after, the whole field's marks at entry), so the numbers are what the result page
 * showed. The field's marks are kept, so a different debut rating can be replayed through
 * game-core `updateRatings` without simulating again (a Story race's field and result never
 * depend on the stored rating while the stable is in chapter 1).
 */
import * as gc from "@thoroughbred/game-core";
import { authenticate, createDb, DomainError, listStableHorses, type Db } from "@thoroughbred/db";
import { careAction } from "@/server/horseLife";
import { foundStable } from "@/server/founding";
import { createStoryRace } from "@/server/game";
import { probeStable } from "@/server/storyProbe";
import { q } from "./metrics";

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** The off (10 s), the broadcast (60-90 s) and reading the result: one Story race in a session. */
const RACE_MS = 150_000;

export type FirstRacesPolicy = "open" | "chapter";

export interface FirstRacesOptions {
  stables: number;
  policy: FirstRacesPolicy;
  /** Story races per stable ("open": the day break comes after `perDay`). */
  races: number;
  perDay: number;
  startMs: number;
  /** A fresh in-memory database every this many stables (keeps the run flat in memory and time). */
  batch: number;
  log?: (line: string) => void;
}

/** One runner of a field as the rating rule saw it. */
export interface FieldRunner {
  horseId: string;
  house: boolean;
  or: number;
  ratedRuns: number;
  position: number;
  /** Its real ability mark at entry (a Club runner's: as it raced, race-day condition aside). */
  mark: number;
  /** Mean of its six current stats at entry (the engine's inputs before race-day condition). */
  meanStat: number;
}

/** One Story race of a probed stable, read back from the database. */
export interface FirstRace {
  stable: number;
  /** 1-based order within the stable. */
  n: number;
  horseId: string;
  /** This horse's start number (1 = its debut). */
  start: number;
  /** Chapter race key, or null for an open Story race. */
  raceKey: string | null;
  position: number;
  field: number;
  ratingBefore: number;
  ratingAfter: number;
  /** The horse's real ability mark at entry (game-core abilityMark of the entry snapshot). */
  mark: number;
  /** Story credits the race paid. */
  reward: number;
  runners: FieldRunner[];
}

const SILKS = { pattern: "hoops", primary: "#112233", secondary: "#c8a040", cap: "#112233" } as const;

async function openStable(db: Db, name: string, startMs: number, o: FirstRacesOptions): Promise<void> {
  const acc = await foundStable(db, { stableName: name, silks: SILKS, inviteCode: null, now: new Date(startMs) });
  const s = (await authenticate(db, acc.token))!;
  let now = startMs;
  const care = async () => {
    for (const r of await listStableHorses(db, s.stable.id)) await careAction(db, s, r.id, {}, new Date(now)).catch(() => undefined);
  };
  for (let k = 0; k < o.races; k++) {
    // The next day's session: the same hour, care first (the list's first job).
    if (k > 0 && k % o.perDay === 0) {
      now = startMs + Math.floor(k / o.perDay) * DAY;
      await care();
    }
    try {
      await createStoryRace(db, s, {}, new Date(now));
    } catch (e) {
      if (e instanceof DomainError) break; // nothing can run (three starts a day, an injury)
      throw e;
    }
    now += RACE_MS;
    // Care comes after the first race (the first race is run from the starters screen).
    if (k === 0) await care();
  }
}

/** Reads every player run of the database's Story races, oldest first, with its field. */
async function readRuns(db: Db, stableIndex: (name: string) => number): Promise<FirstRace[]> {
  const rows = await q<{ race_id: string; horse_id: string; stable: string | null; is_house: boolean; pos: number; rb: number; ra: number | null; state: gc.HorseState | null; post: string; story: { raceKey?: string } | null }>(
    db,
    `select e.race_id, e.horse_id, s.name as stable, e.is_house, e.finish_position as pos, e.rating_before as rb, e.rating_after as ra,
            e.snapshot->'state' as state, r.post_time as post, r.conditions->'story' as story
       from race_entries e join races r on r.id = e.race_id left join stables s on s.id = e.stable_id
      where r.kind = 'quick' and r.status = 'settled' and e.finish_position is not null
      order by r.post_time, r.id`,
  );
  const rewards = new Map(
    (await q<{ race_id: string; amount: number }>(db, `select meta->>'raceId' as race_id, sum((meta->>'amount')::int) as amount from ledger_transactions where kind = 'story_reward' group by 1`).catch(() => [])).map((r) => [r.race_id, Number(r.amount)]),
  );
  const byRace = new Map<string, typeof rows>();
  for (const r of rows) byRace.set(r.race_id, [...(byRace.get(r.race_id) ?? []), r]);
  const out: FirstRace[] = [];
  const nOf = new Map<number, number>();
  const startOf = new Map<string, number>();
  for (const field of byRace.values()) {
    const mine = field.find((r) => !r.is_house && r.stable);
    if (!mine) continue;
    const stable = stableIndex(mine.stable!);
    const n = (nOf.get(stable) ?? 0) + 1;
    nOf.set(stable, n);
    const start = (startOf.get(mine.horse_id) ?? 0) + 1;
    startOf.set(mine.horse_id, start);
    out.push({
      stable,
      n,
      horseId: mine.horse_id,
      start,
      raceKey: mine.story?.raceKey ?? null,
      position: Number(mine.pos),
      field: field.length,
      ratingBefore: Number(mine.rb),
      ratingAfter: Number(mine.ra ?? mine.rb),
      mark: mine.state ? gc.abilityMark(mine.state) : Number(mine.rb),
      reward: rewards.get(mine.race_id) ?? 0,
      runners: field.map((r) => {
        const stats = r.state ? gc.currentStats(r.state) : null;
        return {
          horseId: r.horse_id,
          house: r.is_house,
          or: Number(r.rb),
          ratedRuns: r.state?.rating.ratedRuns ?? 10,
          position: Number(r.pos),
          mark: r.state ? gc.abilityMark(r.state) : Number(r.rb),
          meanStat: stats ? Math.round(gc.STAT_KEYS.reduce((a, k) => a + stats[k], 0) / gc.STAT_KEYS.length) : 0,
        };
      }),
    });
  }
  return out;
}

/** Runs the probe: `stables` new stables, each on its own day and hour, in batches of fresh databases. */
export async function probeFirstRaces(o: FirstRacesOptions): Promise<FirstRace[]> {
  const out: FirstRace[] = [];
  for (let from = 0; from < o.stables; from += o.batch) {
    const h = await createDb({ url: null, pglite: "memory" });
    const t0 = Date.now();
    try {
      const to = Math.min(o.stables, from + o.batch);
      for (let i = from; i < to; i++) {
        // New players arrive through the day (07:00-22:00 UTC), a day apart so no two share a clock.
        const start = o.startMs + (i - from) * 3 * DAY + (7 + ((i * 7) % 16)) * HOUR;
        if (o.policy === "open") await openStable(h.db, `First Yard ${i}`, start, o);
        else await probeStable(h.db, i, { startMs: start, maxCh1Races: o.races - 1, ch2Races: 0, rest: "race" });
      }
      out.push(...(await readRuns(h.db, (name) => Number(name.split(" ").pop()))));
    } finally {
      await h.close();
    }
    o.log?.(`stables ${from}-${Math.min(o.stables, from + o.batch) - 1}: ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const pct1 = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : 0);
const mean2 = (xs: readonly number[]) => (xs.length ? Math.round((100 * xs.reduce((a, b) => a + b, 0)) / xs.length) / 100 : 0);

export interface RaceNSummary {
  n: number;
  runs: number;
  winPct: number;
  top3Pct: number;
  lastPct: number;
  /** Bottom third of the field (position > 2/3 of the runners). */
  backPct: number;
  meanField: number;
  /** Mean finishing position as a share of the field (0 = won, 100 = last). */
  meanPlacePct: number;
  meanRatingDelta: number;
  /** Share of runs whose rating went down. */
  ratingDownPct: number;
}

export interface FirstRacesSummary {
  policy: FirstRacesPolicy;
  stables: number;
  byRace: RaceNSummary[];
  /** At least one win in the first 3 / 5 Story races (stables that ran that many). */
  winWithin3Pct: number;
  winWithin5Pct: number;
  /** No top-3 finish in the first 3 races. */
  noTop3In3Pct: number;
  /** Story credits earned over the first 5 races: mean and median. */
  rewardFirst5Mean: number;
  rewardFirst5Median: number;
  /** A horse's rating after its 1st, 2nd and 3rd start less its rating before its debut: mean, and share below zero. */
  ratingAfterStart: { start: number; horses: number; meanDelta: number; downPct: number; medianDelta: number }[];
  /** Debut: mean stored rating before, mean real ability mark. */
  debutRating: number;
  debutMark: number;
}

export function summariseFirstRaces(policy: FirstRacesPolicy, races: readonly FirstRace[], upTo = 9): FirstRacesSummary {
  const stables = new Set(races.map((r) => r.stable));
  const byStable = new Map<number, FirstRace[]>();
  for (const r of races) byStable.set(r.stable, [...(byStable.get(r.stable) ?? []), r]);
  const byRace: RaceNSummary[] = [];
  for (let n = 1; n <= upTo; n++) {
    const rs = races.filter((r) => r.n === n);
    if (!rs.length) break;
    byRace.push({
      n,
      runs: rs.length,
      winPct: pct1(rs.filter((r) => r.position === 1).length, rs.length),
      top3Pct: pct1(rs.filter((r) => r.position <= 3).length, rs.length),
      lastPct: pct1(rs.filter((r) => r.position === r.field).length, rs.length),
      backPct: pct1(rs.filter((r) => r.position * 3 > r.field * 2).length, rs.length),
      meanField: mean2(rs.map((r) => r.field)),
      meanPlacePct: mean2(rs.map((r) => (100 * (r.position - 1)) / Math.max(1, r.field - 1))),
      meanRatingDelta: mean2(rs.map((r) => r.ratingAfter - r.ratingBefore)),
      ratingDownPct: pct1(rs.filter((r) => r.ratingAfter < r.ratingBefore).length, rs.length),
    });
  }
  const ran = (k: number) => [...byStable.values()].filter((rs) => rs.length >= k);
  const within = (k: number) => pct1(ran(k).filter((rs) => rs.slice(0, k).some((r) => r.position === 1)).length, ran(k).length);
  const first5 = ran(5).map((rs) => rs.slice(0, 5).reduce((a, r) => a + r.reward, 0)).sort((a, b) => a - b);
  // Per horse: rating after start k less the rating before its debut.
  const byHorse = new Map<string, FirstRace[]>();
  for (const r of races) byHorse.set(r.horseId, [...(byHorse.get(r.horseId) ?? []), r]);
  const ratingAfterStart = [1, 2, 3].map((k) => {
    const ds = [...byHorse.values()].filter((rs) => rs.length >= k && rs[0]!.start === 1).map((rs) => rs[k - 1]!.ratingAfter - rs[0]!.ratingBefore).sort((a, b) => a - b);
    return { start: k, horses: ds.length, meanDelta: mean2(ds), downPct: pct1(ds.filter((d) => d < 0).length, ds.length), medianDelta: ds.length ? ds[ds.length >> 1]! : 0 };
  });
  const debuts = races.filter((r) => r.start === 1);
  return {
    policy,
    stables: stables.size,
    byRace,
    winWithin3Pct: within(3),
    winWithin5Pct: within(5),
    noTop3In3Pct: pct1(ran(3).filter((rs) => !rs.slice(0, 3).some((r) => r.position <= 3)).length, ran(3).length),
    rewardFirst5Mean: mean2(first5),
    rewardFirst5Median: first5.length ? first5[first5.length >> 1]! : 0,
    ratingAfterStart,
    debutRating: mean2(debuts.map((r) => r.ratingBefore)),
    debutMark: mean2(debuts.map((r) => r.mark)),
  };
}

/**
 * What the ratings would have done had every player horse started from `seat(mark)` instead of its
 * stored rating: each horse's runs are replayed in order through game-core `updateRatings` against
 * the same fields and results. Returns the same per-start series as the summary.
 */
export function replayRatings(races: readonly FirstRace[], seat: (mark: number) => number): FirstRacesSummary["ratingAfterStart"] {
  const byHorse = new Map<string, FirstRace[]>();
  for (const r of races) byHorse.set(r.horseId, [...(byHorse.get(r.horseId) ?? []), r]);
  const series: number[][] = [[], [], []];
  for (const rs of byHorse.values()) {
    if (rs[0]!.start !== 1) continue;
    const from = seat(rs[0]!.mark);
    let or = from;
    rs.slice(0, 3).forEach((r, k) => {
      const field = r.runners.map((x) => (x.horseId === r.horseId ? { horseId: x.horseId, or, ratedRuns: k, position: x.position } : { horseId: x.horseId, or: x.or, ratedRuns: x.ratedRuns, position: x.position }));
      or = gc.updateRatings(field).find((c) => c.horseId === r.horseId)!.after;
      series[k]!.push(or - from);
    });
  }
  return series.map((ds, k) => {
    const s = [...ds].sort((a, b) => a - b);
    return { start: k + 1, horses: s.length, meanDelta: mean2(s), downPct: pct1(s.filter((d) => d < 0).length, s.length), medianDelta: s.length ? s[s.length >> 1]! : 0 };
  });
}

// ---------------------------------------------------------------------------
// Tallies: a chunk's counts, small enough to keep in the repository and exact to add up
// ---------------------------------------------------------------------------

/** Counts of one group of runs (a race number or a horse's start number). */
interface RunCounts {
  runs: number;
  wins: number;
  top3: number;
  last: number;
  /** Sums: field size, rating after less rating before. */
  field: number;
  delta: number;
  down: number;
}

/** A horse's rating after its k-th start less its rating before its debut. */
interface StartCounts {
  horses: number;
  delta: number;
  down: number;
}

/**
 * The sufficient counts of a chunk of the probe: several chunks (seeds) add up exactly, so a
 * 2,000-stable measurement can be run a few hundred stables at a time and kept as one line each.
 */
export interface FirstRacesTally {
  stables: number;
  /** By the stable's race number (index 0 = its first race). */
  byRace: RunCounts[];
  /** Stables that ran at least 3 / 5 races, and of those: a win within them, no top-3 in the first 3, Story credits over the first 5 (sum). */
  ran3: number;
  win3: number;
  noTop3In3: number;
  ran5: number;
  win5: number;
  reward5: number;
  /** As raced, from the ability mark and from the flat 40 (the last two replayed; index 0 = after the first start). */
  rating: StartCounts[];
  ratingFromMark: StartCounts[];
  ratingFrom40: StartCounts[];
  /** Debuts: count, sum of the stored rating before, sum of the real ability mark. */
  debuts: number;
  debutRating: number;
  debutMark: number;
}

const startCounts = (ds: readonly number[]): StartCounts => ({ horses: ds.length, delta: ds.reduce((a, b) => a + b, 0), down: ds.filter((d) => d < 0).length });

/** The per-horse rating series (after start k less before the debut) under a debut rating, replayed through updateRatings. */
function replaySeries(races: readonly FirstRace[], seat: ((mark: number) => number) | null): StartCounts[] {
  const byHorse = new Map<string, FirstRace[]>();
  for (const r of races) byHorse.set(r.horseId, [...(byHorse.get(r.horseId) ?? []), r]);
  const series: number[][] = [[], [], []];
  for (const rs of byHorse.values()) {
    if (rs[0]!.start !== 1) continue;
    const from = seat ? seat(rs[0]!.mark) : rs[0]!.ratingBefore;
    let or = from;
    rs.slice(0, 3).forEach((r, k) => {
      if (seat) {
        const field = r.runners.map((x) => (x.horseId === r.horseId ? { horseId: x.horseId, or, ratedRuns: k, position: x.position } : { horseId: x.horseId, or: x.or, ratedRuns: x.ratedRuns, position: x.position }));
        or = gc.updateRatings(field).find((c) => c.horseId === r.horseId)!.after;
      } else or = r.ratingAfter;
      series[k]!.push(or - from);
    });
  }
  return series.map(startCounts);
}

export function tallyFirstRaces(races: readonly FirstRace[]): FirstRacesTally {
  const byStable = new Map<number, FirstRace[]>();
  for (const r of races) byStable.set(r.stable, [...(byStable.get(r.stable) ?? []), r]);
  const byRace: RunCounts[] = [];
  for (const r of races) {
    const c = (byRace[r.n - 1] ??= { runs: 0, wins: 0, top3: 0, last: 0, field: 0, delta: 0, down: 0 });
    c.runs++;
    if (r.position === 1) c.wins++;
    if (r.position <= 3) c.top3++;
    if (r.position === r.field) c.last++;
    c.field += r.field;
    c.delta += r.ratingAfter - r.ratingBefore;
    if (r.ratingAfter < r.ratingBefore) c.down++;
  }
  const ran = (k: number) => [...byStable.values()].filter((rs) => rs.length >= k);
  const debuts = races.filter((r) => r.start === 1);
  const withRunners = races.every((r) => r.runners.length > 0);
  return {
    stables: byStable.size,
    byRace: Array.from(byRace, (c) => c ?? { runs: 0, wins: 0, top3: 0, last: 0, field: 0, delta: 0, down: 0 }),
    ran3: ran(3).length,
    win3: ran(3).filter((rs) => rs.slice(0, 3).some((r) => r.position === 1)).length,
    noTop3In3: ran(3).filter((rs) => !rs.slice(0, 3).some((r) => r.position <= 3)).length,
    ran5: ran(5).length,
    win5: ran(5).filter((rs) => rs.slice(0, 5).some((r) => r.position === 1)).length,
    reward5: ran(5).reduce((n, rs) => n + rs.slice(0, 5).reduce((a, r) => a + r.reward, 0), 0),
    rating: replaySeries(races, null),
    ratingFromMark: withRunners ? replaySeries(races, (m) => m) : [],
    ratingFrom40: withRunners ? replaySeries(races, () => gc.INITIAL_OR) : [],
    debuts: debuts.length,
    debutRating: debuts.reduce((a, r) => a + r.ratingBefore, 0),
    debutMark: debuts.reduce((a, r) => a + r.mark, 0),
  };
}

const addCounts = <T extends object>(a: T | undefined, b: T): T => {
  const out = { ...(a ?? {}) } as Record<string, number>;
  for (const [k, v] of Object.entries(b as Record<string, number>)) out[k] = (out[k] ?? 0) + v;
  return out as T;
};
const addLists = <T extends object>(a: readonly T[], b: readonly T[]): T[] => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (b[i] ? addCounts(a[i], b[i]!) : a[i]!));

export function mergeTallies(ts: readonly FirstRacesTally[]): FirstRacesTally {
  let out: FirstRacesTally | null = null;
  for (const t of ts) {
    if (!out) {
      out = JSON.parse(JSON.stringify(t)) as FirstRacesTally;
      continue;
    }
    const o: FirstRacesTally = out;
    out = {
      stables: o.stables + t.stables,
      byRace: addLists(o.byRace, t.byRace),
      ran3: o.ran3 + t.ran3,
      win3: o.win3 + t.win3,
      noTop3In3: o.noTop3In3 + t.noTop3In3,
      ran5: o.ran5 + t.ran5,
      win5: o.win5 + t.win5,
      reward5: o.reward5 + t.reward5,
      rating: addLists(o.rating, t.rating),
      ratingFromMark: addLists(o.ratingFromMark, t.ratingFromMark),
      ratingFrom40: addLists(o.ratingFrom40, t.ratingFrom40),
      debuts: o.debuts + t.debuts,
      debutRating: o.debutRating + t.debutRating,
      debutMark: o.debutMark + t.debutMark,
    };
  }
  if (!out) throw new Error("no tallies to merge");
  return out;
}

/** A plain-text table of a (merged) tally. */
export function tallyReport(label: string, t: FirstRacesTally): string {
  const p = (n: number, d: number) => (d ? `${(Math.round((1000 * n) / d) / 10).toFixed(1)}%` : "-");
  const m = (n: number, d: number) => (d ? (Math.round((100 * n) / d) / 100).toFixed(2) : "-");
  const lines = [`${label}: ${t.stables} stables`, "| Story race | Runs | Win | Top 3 | Last | Field | Mean rating change | Rating down |", "|---:|---:|---:|---:|---:|---:|---:|---:|"];
  t.byRace.forEach((c, i) => lines.push(`| ${i + 1} | ${c.runs} | ${p(c.wins, c.runs)} | ${p(c.top3, c.runs)} | ${p(c.last, c.runs)} | ${m(c.field, c.runs)} | ${m(c.delta, c.runs)} | ${p(c.down, c.runs)} |`));
  lines.push(`A win within the first 3: ${p(t.win3, t.ran3)} of ${t.ran3}; within the first 5: ${p(t.win5, t.ran5)} of ${t.ran5}. No top-3 finish in the first 3: ${p(t.noTop3In3, t.ran3)}. Story credits over the first 5: mean ${m(t.reward5, t.ran5)}.`);
  const series = (name: string, s: readonly StartCounts[]) => (s.length ? `${name}: ${s.map((c, k) => `after start ${k + 1} ${m(c.delta, c.horses)} (${c.horses} horses, ${p(c.down, c.horses)} lower)`).join("; ")}` : "");
  lines.push(series("Rating against the rating before the debut, as raced", t.rating));
  if (t.ratingFromMark.length) lines.push(series("Replayed from the ability mark", t.ratingFromMark), series(`Replayed from ${gc.INITIAL_OR}`, t.ratingFrom40));
  lines.push(`Debut: mean stored rating ${m(t.debutRating, t.debuts)}, mean real ability mark ${m(t.debutMark, t.debuts)}.`);
  return lines.filter(Boolean).join("\n");
}
