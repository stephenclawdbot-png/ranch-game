/**
 * "What if?" re-runs (docs/reports/2026-10-31 experience review.md, item 3).
 *
 * A settled race (seed revealed) is simulated again with ONE change to one runner that the
 * viewer's stable ran (or owns): its tactic, the riding intensity, the race-day extras that act
 * on the track (soft-ground shoes, a physio session), or its jockey (another of the stable's
 * jockeys, or a typical Club freelancer of a grade, through the jockeys kit mapping). Everything
 * else stays exactly as the field locked: the other runners, gates, weights, course, going, race
 * model and seed. The engine draws each horse's luck from the seed per gate and purpose, so only
 * the changed input can move the result; a re-run with no change reproduces the official
 * result byte for byte through the very path verifyReplay uses (simulateRace on the locked input).
 *
 * Rules:
 *   - settled races only (the seed is revealed then): no spoilers, no peeking at future luck;
 *   - a counterfactual: unrated, no credits, no XP, no ledger postings, no records, form lines
 *     or stats; this module writes nothing but its own cache row (db services/whatIf.ts);
 *   - the race re-runs on the engine version it locked with (a change that would move it to
 *     another version, e.g. kit on a pre-kit race, is refused);
 *   - free, cached per (race, horse, change); WHAT_IF_PER_HOUR fresh re-runs per account per
 *     hour through the shared rate limiter.
 */
import * as gc from "@thoroughbred/game-core";
import {
  DomainError,
  getHorse,
  getRace,
  getRaceResult,
  getWhatIfRun,
  listRaceEntries,
  saveWhatIfRun,
  stableJockeys,
  storedRaceDay,
  type Db,
  type FieldRunner,
  type LockedField,
  type PublicRace,
  type RaceEntryRow,
  type WhatIfRunRow,
} from "@thoroughbred/db";
import { engineVersionFor, simulateRace } from "@thoroughbred/racing-engine";
import { type Horse, type RaceEntry, type RaceInput, type RaceKit, type RaceReplay, type RunningStyle } from "@thoroughbred/shared";
import { crossTimeS } from "@/lib/raceAnalysis";
import {
  WHAT_IF_EXTRAS,
  WHAT_IF_GRADES,
  WHAT_IF_PER_HOUR,
  WHAT_IF_WINDOW_MS,
  changeKey,
  changeLabel,
  parseChangeKey,
  type WhatIfChange,
  type WhatIfExtra,
  type WhatIfGrade,
  type WhatIfOptionsView,
  type WhatIfRow,
  type WhatIfRunnerLine,
  type WhatIfView,
} from "@/lib/whatIf";
import { lockedRaceInput } from "./game";
import { engineHorseFromSnapshot, parsePlan, raceConds } from "./horseView";
import { sharedLimiter } from "./rateLimit";
import type { Session } from "./session";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STYLES: readonly RunningStyle[] = ["front", "stalker", "closer"];
const INTENSITIES = ["conservative", "normal", "all_out"] as const;
type Intensity = (typeof INTENSITIES)[number];
type Stats = Horse["stats"];

export const whatIfLimiter = sharedLimiter({ name: "what-if", limit: WHAT_IF_PER_HOUR, windowMs: WHAT_IF_WINDOW_MS });

/**
 * A typical Club freelancer of each grade: every skill at the middle of the grade's band (game-core
 * JOCKEY_GRADE_FLOORS), so "an A-grade rider" means the same thing in every what-if.
 */
export const GRADE_RIDER_SKILLS: Record<WhatIfGrade, gc.JockeySkills> = {
  A: { gate: 850, pace: 850, finish: 850, handling: 850 },
  B: { gate: 675, pace: 675, finish: 675, handling: 675 },
  C: { gate: 525, pace: 525, finish: 525, handling: 525 },
  D: { gate: 375, pace: 375, finish: 375, handling: 375 },
  E: { gate: 200, pace: 200, finish: 200, handling: 200 },
};

// ---------------------------------------------------------------------------
// Pure: one changed runner in a locked input
// ---------------------------------------------------------------------------

/** The changed runner exactly as it re-runs (stored with the cache row, so its replay re-simulates identically). */
export interface ResolvedRunner {
  gate: number;
  tactic: RunningStyle;
  /** The runner's engine kit after the change; null = none. */
  kit: RaceKit | null;
  stats: Stats;
}

/** The runner at `gate` as it locked, in the resolved shape. */
export function lockedRunner(input: RaceInput, gate: number): ResolvedRunner {
  const e = input.entries.find((x) => x.gate === gate);
  if (!e) throw new DomainError("NOT_FOUND", "that runner isn't in this race");
  return { gate, tactic: e.tactic, kit: e.kit ?? null, stats: { ...e.horse.stats } };
}

/**
 * The locked input with one runner replaced. Nothing else is touched: the same entries in the same
 * order, the same race, course, model and seed. A resolved runner equal to the locked one gives an
 * input that simulates to the official replay byte for byte (the what-if tests check it).
 */
export function whatIfInput(base: RaceInput, r: ResolvedRunner): RaceInput {
  if (!base.entries.some((e) => e.gate === r.gate)) throw new DomainError("NOT_FOUND", "that runner isn't in this race");
  const entries: RaceEntry[] = base.entries.map((e) => {
    if (e.gate !== r.gate) return e;
    const { kit: _old, ...rest } = e;
    return { ...rest, tactic: r.tactic, horse: { ...e.horse, stats: { ...r.stats } }, ...(r.kit ? { kit: { ...r.kit } } : {}) };
  });
  const out: RaceInput = { ...base, entries };
  // The re-run must run on the race's own engine version: a change that would move it (kit
  // on a race run before kit existed) is not a like-for-like re-run.
  const was = engineVersionFor(base.entries, base.course ?? null, base.model ?? null);
  const now = engineVersionFor(entries, base.course ?? null, base.model ?? null);
  if (was !== now) throw new DomainError("INVALID_INPUT", "that change didn't exist when this race was run, so it can't be re-run with it");
  return out;
}

/** simulateRace on the what-if input: the same call verifyReplay makes on the locked one. */
export function rerun(base: RaceInput, r: ResolvedRunner): RaceReplay {
  return simulateRace(whatIfInput(base, r));
}

/** Kit with soft-ground shoes on or off (they only act on soft or heavy going). */
export function kitWithShoes(kit: RaceKit | null, on: boolean, going: string): RaceKit | null {
  const { goingPenaltyPermille: _g, ...rest } = kit ?? {};
  const next: RaceKit = on && (going === "soft" || going === "heavy") ? { ...rest, goingPenaltyPermille: gc.SHOES_KEEP_PERMILLE } : rest;
  return Object.keys(next).length ? next : null;
}

/** Kit with another rider's skills (game-core jockeyKit: all five rider fields, shoes kept). */
export function kitWithRider(kit: RaceKit | null, skills: gc.JockeySkills): RaceKit {
  return gc.withJockeyKit(kit ?? undefined, skills);
}

/** Stats moved by `delta` (each 0..1000, integers). */
export function statsWithDelta(stats: Stats, delta: Partial<Stats>): Stats {
  const out = { ...stats };
  for (const k of Object.keys(out) as (keyof Stats)[]) {
    const d = delta[k] ?? 0;
    if (d) out[k] = Math.max(0, Math.min(1000, Math.round(out[k] + d)));
  }
  return out;
}

function statsDelta(from: Stats, to: Stats): Partial<Stats> {
  const d: Partial<Stats> = {};
  for (const k of Object.keys(from) as (keyof Stats)[]) if (to[k] !== from[k]) d[k] = to[k] - from[k];
  return d;
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

/** Distance behind the winner, mm. */
function behindMm(replay: RaceReplay, position: number): number {
  return replay.result.finishOrder.filter((f) => f.position > 1 && f.position <= position).reduce((a, f) => a + f.marginMm, 0);
}

export function runnerLine(replay: RaceReplay, horseId: string): WhatIfRunnerLine {
  const rec = replay.result.finishOrder.find((f) => f.horseId === horseId);
  const h = replay.horses.findIndex((x) => x.horseId === horseId);
  if (!rec || h < 0) throw new DomainError("NOT_FOUND", "runner not in the replay");
  const L = replay.trackLengthMm;
  const t1 = crossTimeS(replay, h, L / 3);
  const t2 = crossTimeS(replay, h, (2 * L) / 3);
  const t3 = rec.finishTimeUs / 1e6;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return { position: rec.position, behindMm: behindMm(replay, rec.position), timeUs: rec.finishTimeUs, sectionals: [r2(t1), r2(t2 - t1), r2(t3 - t2)] };
}

/** The first five home, plus your runner when it was further back. */
export function topRows(replay: RaceReplay, horseId: string): WhatIfRow[] {
  const names = new Map(replay.horses.map((x) => [x.horseId, x.name]));
  return replay.result.finishOrder
    .filter((f) => f.position <= 5 || f.horseId === horseId)
    .map((f) => ({ position: f.position, horseId: f.horseId, name: names.get(f.horseId) ?? "Runner", mine: f.horseId === horseId, behindMm: behindMm(replay, f.position), timeUs: f.finishTimeUs }));
}

// ---------------------------------------------------------------------------
// Loading a race for a what-if (the rules live here)
// ---------------------------------------------------------------------------

interface Context {
  race: PublicRace;
  entry: RaceEntryRow;
  runner: FieldRunner;
  field: LockedField;
  input: RaceInput;
  official: RaceReplay;
  horseName: string;
  /** Null when this race can't be re-run (and why otherwise). */
  unavailable: string | null;
}

async function loadContext(db: Db, session: Session, raceId: string, horseId: string, now: Date): Promise<Context> {
  if (!UUID_RE.test(raceId) || !UUID_RE.test(horseId)) throw new DomainError("NOT_FOUND", "race not found");
  const race = await getRace(db, raceId);
  if (!race || race.status === "cancelled") throw new DomainError("NOT_FOUND", "race not found");
  // Settled = run, result official and seed revealed. Before that a re-run would be a peek.
  const result = race.status === "settled" ? await getRaceResult(db, raceId) : null;
  if (!result) throw new DomainError("TOO_EARLY", "What if? opens once the race has been run and the result is official");
  const entry = (await listRaceEntries(db, raceId)).find((e) => e.horseId === horseId && !e.isHouse);
  const row = await getHorse(db, horseId);
  // Your runner: the stable that ran it (owner or lessee), or the horse's owner.
  const mine = !!entry && (entry.stableId === session.stable.id || row?.ownerStableId === session.stable.id);
  if (!entry || !mine) throw new DomainError("NOT_OWNER", "you can only re-run a horse your stable ran or owns");
  const { input, field, replay } = await lockedRaceInput(db, race, now);
  const runner = field.runners.find((r) => r.horseId === horseId);
  if (!runner) throw new DomainError("NOT_FOUND", "that runner isn't in this race");
  // Only a race that still re-runs to its official result can be re-run with a change.
  const exact = replay.result.resultHash === result.resultHash && replay.engineVersion === (result.engineVersion ?? replay.engineVersion);
  return {
    race,
    entry,
    runner,
    field,
    input,
    official: replay,
    horseName: row?.name ?? replay.horses.find((x) => x.horseId === horseId)?.name ?? "Your horse",
    unavailable: exact ? null : "This race can no longer be re-run exactly, so What if? isn't available for it.",
  };
}

/** The snapshot's horse state parses: intensity and physio can be re-applied to it. */
function canRebuild(entry: RaceEntryRow): boolean {
  return gc.HorseStateSchema.safeParse((entry.snapshot as { state?: unknown } | null)?.state).success;
}

function currentIntensity(entry: RaceEntryRow): Intensity | null {
  const p = (entry.snapshot as { plan?: unknown } | null)?.plan;
  return p ? parsePlan(p).intensity : null;
}

function currentExtras(entry: RaceEntryRow): WhatIfExtra[] {
  const rd = storedRaceDay(entry.snapshot);
  return rd ? WHAT_IF_EXTRAS.filter((x) => rd.extras.includes(x)) : [];
}

/**
 * The engine stats a different plan or extras would have given this entry: the snapshot rebuilt
 * both ways at post time (game-core raceSnapshot, as the lock did), and the difference applied to
 * the stats that actually ran. Only that difference moves; nothing else of the horse does.
 */
function rebuiltStats(ctx: Context, locked: Stats, edit: { intensity?: Intensity; extras?: WhatIfExtra[] }): Stats {
  const snap = (ctx.entry.snapshot ?? {}) as Record<string, unknown>;
  const lb = ctx.runner.extraWeightLb ?? 0;
  const before = engineHorseFromSnapshot(snap, ctx.race, false, lb).stats;
  const next: Record<string, unknown> = { ...snap };
  if (edit.intensity) next.plan = { ...parsePlan(snap.plan, ctx.runner.tactic as RunningStyle), intensity: edit.intensity };
  if (edit.extras) {
    const rd = (snap.raceDay ?? { jockey: "apprentice" }) as Record<string, unknown>;
    const kept = (Array.isArray(rd.extras) ? (rd.extras as string[]) : []).filter((x) => !(WHAT_IF_EXTRAS as readonly string[]).includes(x));
    next.raceDay = { ...rd, extras: [...kept, ...edit.extras] };
  }
  const after = engineHorseFromSnapshot(next, ctx.race, false, lb).stats;
  return statsWithDelta(locked, statsDelta(before, after));
}

/** Turns a requested change into the runner as it re-runs, or refuses it (INVALID_INPUT, with why). */
async function resolve(db: Db, session: Session, ctx: Context, change: WhatIfChange): Promise<{ runner: ResolvedRunner; jockeyName: string | null }> {
  const locked = lockedRunner(ctx.input, ctx.runner.gate);
  const going = raceConds(ctx.race).going;
  const live = ctx.race.kind !== "quick";
  const bad = (why: string) => new DomainError("INVALID_INPUT", why);
  switch (change.kind) {
    case "tactic":
      if (change.tactic === locked.tactic) throw bad("that's the tactic it ran with");
      return { runner: { ...locked, tactic: change.tactic }, jockeyName: null };
    case "intensity": {
      if (!canRebuild(ctx.entry)) throw bad("this run's riding plan can't be changed");
      const was = currentIntensity(ctx.entry) ?? "normal";
      if (change.intensity === was) throw bad("that's how it was ridden");
      return { runner: { ...locked, stats: rebuiltStats(ctx, locked.stats, { intensity: change.intensity }) }, jockeyName: null };
    }
    case "extras": {
      if (!live) throw bad("race-day extras are for Live races");
      const offered = offeredExtras(ctx, going);
      for (const x of change.extras) if (!offered.includes(x)) throw bad(x === "soft_shoes" ? "soft-ground shoes only help on soft or heavy going" : "that extra isn't on offer for this run");
      const was = currentExtras(ctx.entry);
      if (sameSet(was, change.extras)) throw bad("those are the extras it ran with");
      let r: ResolvedRunner = { ...locked };
      if (was.includes("soft_shoes") !== change.extras.includes("soft_shoes")) r = { ...r, kit: kitWithShoes(r.kit, change.extras.includes("soft_shoes"), going) };
      if (was.includes("physio") !== change.extras.includes("physio")) r = { ...r, stats: rebuiltStats(ctx, locked.stats, { extras: change.extras }) };
      return { runner: r, jockeyName: null };
    }
    case "jockey": {
      if (!ctx.runner.jockey) throw bad("jockey changes are for races run since named jockeys");
      if (change.jockeyId === ctx.runner.jockey.id) throw bad("that's who rode it");
      const j = (await stableJockeys(db, session.stable.id)).find((x) => x.id === change.jockeyId && !x.retired);
      if (!j) throw bad("that jockey isn't one of yours");
      return { runner: { ...locked, kit: kitWithRider(locked.kit, j.skills) }, jockeyName: j.name };
    }
    case "jockey_grade":
      if (!ctx.runner.jockey) throw bad("jockey changes are for races run since named jockeys");
      return { runner: { ...locked, kit: kitWithRider(locked.kit, GRADE_RIDER_SKILLS[change.grade]) }, jockeyName: null };
  }
}

function offeredExtras(ctx: Context, going: string): WhatIfExtra[] {
  if (ctx.race.kind === "quick") return [];
  return WHAT_IF_EXTRAS.filter((x) => (x === "soft_shoes" ? going === "soft" || going === "heavy" : canRebuild(ctx.entry)));
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

// ---------------------------------------------------------------------------
// Services (the API routes call these)
// ---------------------------------------------------------------------------

async function remainingFor(db: Db, session: Session, now: Date): Promise<number> {
  return Math.max(0, WHAT_IF_PER_HOUR - (await whatIfLimiter.count(db, session.accountId, now.getTime())));
}

/** What the sheet may offer for this runner (refused before the race has settled, or for someone else's horse). */
export async function whatIfOptions(db: Db, session: Session, raceId: string, horseId: string, now: Date): Promise<WhatIfOptionsView> {
  const ctx = await loadContext(db, session, raceId, horseId, now);
  const going = raceConds(ctx.race).going;
  const tactic = ctx.runner.tactic as RunningStyle;
  const rebuild = canRebuild(ctx.entry);
  const intensity = rebuild ? (currentIntensity(ctx.entry) ?? "normal") : null;
  const extras = offeredExtras(ctx, going);
  const rider = ctx.runner.jockey ?? null;
  const jockeys = rider ? (await stableJockeys(db, session.stable.id)).filter((j) => !j.retired && j.id !== rider.id).map((j) => ({ id: j.id, name: j.name, grade: j.grade })) : [];
  const notes: string[] = [];
  if (ctx.race.kind === "quick") notes.push("Story races have no race-day extras or jockeys, so only the tactic and the ride can change.");
  else if (!rider) notes.push("Jockey changes are for races run since named jockeys.");
  if (ctx.runner.weightLb !== undefined) notes.push("Weights stay as carried: a different rider's claim isn't re-applied.");
  const done = await doneFor(db, ctx);
  return {
    raceId,
    horseId,
    horseName: ctx.horseName,
    raceName: ctx.race.name,
    unavailable: ctx.unavailable,
    engineVersion: ctx.official.engineVersion,
    current: { tactic, intensity, extras: currentExtras(ctx.entry), jockeyName: rider?.name ?? null, jockeyId: rider?.id ?? null },
    tactics: STYLES.filter((s) => s !== tactic),
    intensities: intensity ? INTENSITIES.filter((i) => i !== intensity) : [],
    extras,
    jockeys,
    grades: rider ? [...WHAT_IF_GRADES] : [],
    notes,
    remaining: await remainingFor(db, session, now),
    done,
  };
}

/** Earlier re-runs of this runner the stable can look at again for free. */
async function doneFor(db: Db, ctx: Context): Promise<WhatIfOptionsView["done"]> {
  const keys: string[] = [
    ...STYLES.map((t) => changeKey({ kind: "tactic", tactic: t })),
    ...INTENSITIES.map((i) => changeKey({ kind: "intensity", intensity: i })),
    ...WHAT_IF_GRADES.map((g) => changeKey({ kind: "jockey_grade", grade: g })),
  ];
  const out: WhatIfOptionsView["done"] = [];
  for (const k of keys) {
    const row = await getWhatIfRun(db, { raceId: ctx.race.id, horseId: ctx.entry.horseId, changeKey: k });
    if (row) out.push({ changeKey: k, label: (row.summary as WhatIfView).label, position: (row.summary as WhatIfView).whatIf.position });
  }
  return out;
}

/**
 * Re-runs the race with one change (or answers from the cache). Counts against the hourly limit
 * only when it computes; writes nothing but the cache row.
 */
export async function runWhatIf(db: Db, session: Session, raceId: string, horseId: string, change: WhatIfChange, now: Date): Promise<WhatIfView> {
  const ctx = await loadContext(db, session, raceId, horseId, now);
  if (ctx.unavailable) throw new DomainError("INVALID_INPUT", ctx.unavailable);
  const key = changeKey(change);
  const cached = await getWhatIfRun(db, { raceId, horseId, changeKey: key });
  if (cached) return { ...(cached.summary as WhatIfView), cached: true, remaining: await remainingFor(db, session, now) };
  const { runner, jockeyName } = await resolve(db, session, ctx, change);
  // Validate (and check the engine version) before spending a re-run.
  whatIfInput(ctx.input, runner);
  if (await whatIfLimiter.hit(db, session.accountId, now.getTime())) {
    throw new DomainError("RATE_LIMITED", `that's ${WHAT_IF_PER_HOUR} what-ifs this hour: try again later (ones you've already run are free to look at)`);
  }
  const replay = rerun(ctx.input, runner);
  const summary: WhatIfView = {
    raceId,
    horseId,
    horseName: ctx.horseName,
    raceName: ctx.race.name,
    track: raceConds(ctx.race).track,
    postTimeMs: ctx.race.postTime.getTime(),
    engineVersion: replay.engineVersion,
    fieldSize: replay.result.finishOrder.length,
    changeKey: key,
    label: changeLabel(change, jockeyName),
    official: runnerLine(ctx.official, horseId),
    whatIf: runnerLine(replay, horseId),
    officialTop: topRows(ctx.official, horseId),
    whatIfTop: topRows(replay, horseId),
    cached: false,
    remaining: 0,
  };
  const row = await saveWhatIfRun(db, { raceId, horseId, changeKey: key, engineVersion: replay.engineVersion, resolved: runner, summary, stableId: session.stable.id, now });
  remember(row.id, replay);
  return { ...(row.summary as WhatIfView), cached: false, remaining: await remainingFor(db, session, now) };
}

/** Recently watched what-if replays by cache row (a re-run is deterministic, so this is only a speed-up). */
const replays = new Map<string, RaceReplay>();
const REPLAYS_MAX = 32;

function remember(id: string, r: RaceReplay): void {
  replays.delete(id);
  replays.set(id, r);
  if (replays.size > REPLAYS_MAX) replays.delete(replays.keys().next().value!);
}

/** The cached re-run's comparison (the what-if page shows it under the replay). */
export async function whatIfSummary(db: Db, session: Session, raceId: string, horseId: string, key: string, now: Date): Promise<WhatIfView> {
  const { row } = await cachedRow(db, session, raceId, horseId, key, now);
  return { ...(row.summary as WhatIfView), cached: true, remaining: await remainingFor(db, session, now) };
}

async function cachedRow(db: Db, session: Session, raceId: string, horseId: string, key: string, now: Date): Promise<{ ctx: Context; row: WhatIfRunRow }> {
  if (!parseChangeKey(key)) throw new DomainError("NOT_FOUND", "what-if not found");
  const ctx = await loadContext(db, session, raceId, horseId, now);
  const row = await getWhatIfRun(db, { raceId, horseId, changeKey: key });
  if (!row) throw new DomainError("NOT_FOUND", "run this what-if first");
  return { ctx, row };
}

/**
 * The what-if replay for the viewer: only of a re-run already computed (so watching never
 * spends one), re-simulated from the stored runner on the race's own engine version.
 */
export async function whatIfReplay(db: Db, session: Session, raceId: string, horseId: string, key: string, now: Date): Promise<RaceReplay> {
  const { ctx, row } = await cachedRow(db, session, raceId, horseId, key, now);
  const hit = replays.get(row.id);
  if (hit) return hit;
  const replay = rerun(ctx.input, row.resolved as ResolvedRunner);
  if (replay.engineVersion !== row.engineVersion) throw new DomainError("INVALID_INPUT", "this what-if can no longer be replayed exactly");
  remember(row.id, replay);
  return replay;
}
