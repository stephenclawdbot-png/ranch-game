/**
 * Quick races (the fast layer): instant, unofficial races run on the server, in the spirit of a
 * "What if?" re-run (whatIf.ts) but with a fresh crypto-random seed (or, for the daily challenge,
 * the day's one seed) and a field the player picks.
 *
 *   Match race       one of your racing horses against 1-3 other stables' racing horses, each
 *                    raced "as it is now" (current stored state, natural style, a typical
 *                    C-grade freelancer), on a course, trip and going you choose.
 *   Ghost race       your horse against the first three home in a settled Live race (from the
 *                    start of yesterday, UTC), the ghosts exactly as they locked in that field
 *                    (stats, tactic, rider), on that race's course, trip and going.
 *   Daily challenge  game-core dailyChallengeSpec: the same Club horse, field and conditions for
 *                    everyone, published at 00:00 UTC. You choose the tactic, intensity and a
 *                    rider grade (a better rider costs weight). One attempt per stable per day,
 *                    all against the day's one seed: its commitment is shown with the puzzle and
 *                    the seed itself only once the day is over, so nobody can try plans offline.
 *
 * Unofficial by construction: this module reads horses and races and writes only its own rows
 * (db services/quickRaces.ts), a rate-limit counter, the daily seed and a batched inbox line to an
 * owner whose horse beat a challenger. No rating, fatigue, injury roll, credits, ledger, form,
 * records, leagues, jockey rides or XP, tote, picks or growth: the flow test checks every table.
 */
import * as gc from "@thoroughbred/game-core";
import {
  DomainError,
  commitSeed,
  dailyAttemptOf,
  dailyBoard,
  dailyChallengeSeed,
  dailyHistory,
  dailyStandingsOf,
  getQuickRace,
  getRace,
  ghostSources,
  isGenome,
  keptHorses,
  listMatchNotes,
  listQuickRaces,
  listStableHorses,
  matchRecordOf,
  newSeed,
  saveQuickRace,
  searchMatchOpponents,
  storedDailyChallengeSeed,
  toHorseState,
  type Db,
  type HorseRow,
  type MatchRunnerInsert,
  type QuickRaceRow,
} from "@thoroughbred/db";
import { simulateRace } from "@thoroughbred/racing-engine";
import type { RaceInput, RaceReplay, RunningStyle, Silks, Surface } from "@thoroughbred/shared";
import {
  QUICK_BADGE,
  QUICK_MODE_LABEL,
  ghostLine,
  type DailyBoardLine,
  type DailyRequest,
  type DailyView,
  type GhostRequest,
  type GhostSourceView,
  type JockeyGrade,
  type MatchOpponent,
  type MatchRequest,
  type QuickHorse,
  type QuickHubView,
  type QuickListItem,
  type QuickMode,
  type QuickRaceView,
  type QuickRunnerRow,
} from "@/lib/quickRaces";
import { ordinal } from "@/lib/format";
import { lockedRaceInput } from "./game";
import { parseSilks, raceConds } from "./horseView";
import { sharedLimiter } from "./rateLimit";
import type { Session } from "./session";

const DAY_MS = gc.MS_PER_DAY;
const HIDDEN_SEED = "0".repeat(64);
const LIVE_SLOT = /^live[^:]*:/;

const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/** Match races per stable per rolling day (env MATCH_RACES_PER_DAY, default game-core's). */
export const matchRacesPerDay = () => envInt("MATCH_RACES_PER_DAY", gc.MATCH_RACES_PER_DAY);
/** Ghost races per stable per rolling day (env GHOST_RACES_PER_DAY). */
export const ghostRacesPerDay = () => envInt("GHOST_RACES_PER_DAY", gc.GHOST_RACES_PER_DAY);

const limiters = new Map<string, ReturnType<typeof sharedLimiter>>();
/** The shared (database-backed) limiter of a mode, per stable. */
export function quickLimiter(mode: "match" | "ghost") {
  const limit = mode === "match" ? matchRacesPerDay() : ghostRacesPerDay();
  const key = `${mode}:${limit}`;
  let l = limiters.get(key);
  if (!l) limiters.set(key, (l = sharedLimiter({ name: `quick-${mode}`, limit, windowMs: gc.QUICK_LIMIT_WINDOW_MS })));
  return l;
}

async function remaining(db: Db, mode: "match" | "ghost", stableId: string, nowMs: number): Promise<number> {
  const limit = mode === "match" ? matchRacesPerDay() : ghostRacesPerDay();
  return Math.max(0, limit - Math.ceil(await quickLimiter(mode).count(db, stableId, nowMs)));
}

const bad = (why: string) => new DomainError("INVALID_INPUT", why);
const utcDate = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const dayOf = (nowMs: number) => Math.floor(nowMs / DAY_MS);

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------

const BLOCK_WORDS: Record<string, string> = {
  not_racing_age: "isn't of racing age yet",
  retired: "no longer races",
  injured: "is recovering from an injury",
  in_foal: "is in foal",
};

/** Why a horse can't run a quick race (null when it can). */
export function quickHorseReason(row: HorseRow, nowMs: number): string | null {
  if (row.careerStatus !== "racing") return `${row.name} no longer races`;
  if (!isGenome(row.genome)) return `${row.name} can't run a quick race`;
  const b = gc.quickRaceBlock(toHorseState(row), nowMs);
  return b ? `${row.name} ${BLOCK_WORDS[b] ?? "can't race"}` : null;
}

/** The engine runner for a horse as it is now: current state, the race's conditions, a normal ride. */
export function quickRunner(row: HorseRow, silks: Silks, c: { going: gc.QuickGoing; surface: Surface; distanceM: number }, fieldSize: number, nowMs: number, tactic?: RunningStyle): gc.QuickRunner {
  const state = toHorseState(row);
  const t = tactic ?? (gc.runningStyle(state.genome) as RunningStyle);
  const horse = gc.raceSnapshot(state, { nowMs, silks, race: { going: c.going, fieldSize, bigCrowd: false, surface: c.surface, distanceM: c.distanceM }, plan: { tactic: t, intensity: "normal" } }).horse;
  return { horse, tactic: t, kit: gc.quickRiderKit(gc.QUICK_DEFAULT_GRADE) };
}

function quickHorseView(k: { horse: HorseRow; stableId: string; stableName: string; silks: unknown }, nowMs: number): QuickHorse {
  const silks = parseSilks(k.silks);
  const state = toHorseState(k.horse);
  const shared = gc.toSharedHorse(state, nowMs, silks);
  return {
    id: k.horse.id,
    name: k.horse.name,
    appearance: shared.appearance,
    style: gc.runningStyle(state.genome) as RunningStyle,
    stableId: k.stableId,
    stableName: k.stableName,
    silks,
    rating: k.horse.rating > 0 ? k.horse.rating : null,
    bestTripM: gc.preferredDistanceM(state.genome),
    surface: gc.preferredSurface(state.genome),
  };
}

async function ownRunner(db: Db, session: Session, horseId: string, nowMs: number): Promise<HorseRow> {
  const row = (await listStableHorses(db, session.stable.id)).find((r) => r.id === horseId);
  if (!row) throw new DomainError("NOT_OWNER", "pick one of your own racing horses");
  const why = quickHorseReason(row, nowMs);
  if (why) throw bad(why);
  return row;
}

// ---------------------------------------------------------------------------
// The result summary (stored with the row; the page adds the viewer's bits)
// ---------------------------------------------------------------------------

interface Summary {
  title: string;
  raceName: string;
  track: string;
  distanceM: number;
  surface: Surface;
  going: gc.QuickGoing;
  horseId: string;
  horseName: string;
  stableName: string;
  position: number;
  fieldSize: number;
  rows: Omit<QuickRunnerRow, "mine">[];
  headline: string;
  ghost?: { sourceRaceId: string; sourceName: string; line: string };
  daily?: { day: number; plan: DailyRequest; points: number; seedCommitment: string };
}

const MARGIN_WORDS: Record<string, string> = { nose: "a nose", "short head": "a short head", head: "a head", neck: "a neck", dist: "a distance", dh: "a dead heat" };
function marginWords(label: string): string {
  if (MARGIN_WORDS[label]) return MARGIN_WORDS[label]!;
  const pretty = label.replace(" 1/4", "¼").replace(" 1/2", "½").replace(" 3/4", "¾").replace(/^1\/2$/, "½").replace(/^3\/4$/, "¾");
  return `${pretty} ${pretty === "1" ? "length" : "lengths"}`;
}

function behindMm(replay: RaceReplay, position: number): number {
  return replay.result.finishOrder.filter((f) => f.position > 1 && f.position <= position).reduce((a, f) => a + f.marginMm, 0);
}

function summaryRows(replay: RaceReplay, stableNames: Map<string, string | null>, official?: Map<string, number>): Summary["rows"] {
  const names = new Map(replay.horses.map((h) => [h.horseId, h.name]));
  return [...replay.result.finishOrder]
    .sort((a, b) => a.position - b.position)
    .map((f) => ({
      position: f.position,
      horseId: f.horseId,
      name: names.get(f.horseId) ?? "Runner",
      stableName: stableNames.get(f.horseId) ?? null,
      behindMm: behindMm(replay, f.position),
      timeUs: f.finishTimeUs,
      ...(official?.has(f.horseId) ? { officialPosition: official.get(f.horseId)! } : {}),
    }));
}

/** "Paper Moon beat Copper Comet by a neck" / "Copper Comet won by 2 lengths; Paper Moon 3rd". */
export function headlineOf(replay: RaceReplay, horseId: string): string {
  const order = [...replay.result.finishOrder].sort((a, b) => a.position - b.position);
  const names = new Map(replay.horses.map((h) => [h.horseId, h.name]));
  const [w, second] = order;
  if (!w) return "";
  const mine = order.find((f) => f.horseId === horseId);
  const by = second ? ` by ${marginWords(second.marginLabel)}` : "";
  if (order.length === 2 && second) return second.position === w.position ? `${names.get(w.horseId)} and ${names.get(second.horseId)} dead-heated` : `${names.get(w.horseId)} beat ${names.get(second.horseId)}${by}`;
  if (!mine || mine.horseId === w.horseId) return `${names.get(w.horseId)} won${by}`;
  return `${names.get(w.horseId)} won${by}; ${names.get(horseId)} ${ordinal(mine.position)}`;
}

function positionOf(replay: RaceReplay, horseId: string): { position: number; timeUs: number } {
  const f = replay.result.finishOrder.find((x) => x.horseId === horseId);
  if (!f) throw new Error("quick race runner missing from the result");
  return { position: f.position, timeUs: f.finishTimeUs };
}

/** Recently watched quick replays by row id (a re-run is deterministic: only a speed-up). */
const replays = new Map<string, RaceReplay>();
function remember(id: string, r: RaceReplay): void {
  replays.delete(id);
  replays.set(id, r);
  if (replays.size > 32) replays.delete(replays.keys().next().value!);
}

// ---------------------------------------------------------------------------
// Match races
// ---------------------------------------------------------------------------

/** Other stables' racing horses for the challenge search (by horse or stable name), or by id. */
export async function matchOpponents(db: Db, session: Session, q: { text?: string; ids?: string[] }, now: Date): Promise<MatchOpponent[]> {
  const rows = q.ids?.length ? await keptHorses(db, q.ids.slice(0, 6)) : await searchMatchOpponents(db, { q: q.text ?? "", excludeStableId: session.stable.id, limit: 12 });
  return rows
    .filter((k) => k.stableId !== session.stable.id && quickHorseReason(k.horse, now.getTime()) === null)
    .map((k) => {
      const v = quickHorseView(k, now.getTime());
      return { id: v.id, name: v.name, stableName: v.stableName, silks: v.silks, appearance: v.appearance, rating: v.rating, style: v.style };
    });
}

/**
 * Runs a match race now: your horse against the chosen opponents, conditions of your choosing, a
 * fresh random seed. Counts against MATCH_RACES_PER_DAY; writes only its own rows (and tells an
 * owner whose horse beat yours, once a day).
 */
export async function runMatchRace(db: Db, session: Session, req: MatchRequest, now: Date): Promise<{ id: string }> {
  const nowMs = now.getTime();
  const conditions: gc.QuickConditions = { courseId: req.courseId as gc.CourseId, distanceM: req.distanceM, surface: req.surface, going: req.going };
  const cond = gc.quickConditionsError(conditions);
  if (cond) throw bad(cond);
  const ids = [...new Set(req.opponentIds)].filter((id) => id !== req.horseId);
  if (ids.length === 0) throw bad("pick a horse to challenge");
  if (ids.length > gc.MATCH_FIELD_MAX - 1) throw bad(`a match race is up to ${gc.MATCH_FIELD_MAX} runners, yours included`);
  const mine = await ownRunner(db, session, req.horseId, nowMs);
  const opponents = await keptHorses(db, ids);
  for (const id of ids) {
    const k = opponents.find((o) => o.horse.id === id);
    if (!k) throw new DomainError("NOT_FOUND", "that horse isn't racing any more");
    if (k.stableId === session.stable.id) throw bad("challenge another stable's horse: yours can race each other in a Story race");
    const why = quickHorseReason(k.horse, nowMs);
    if (why) throw bad(why);
  }
  const ordered = ids.map((id) => opponents.find((o) => o.horse.id === id)!);
  const limit = matchRacesPerDay();
  if (await quickLimiter("match").hit(db, session.stable.id, nowMs)) throw new DomainError("RATE_LIMITED", `that's ${limit} match races today: more tomorrow`);

  const field = 1 + ordered.length;
  const runners = [quickRunner(mine, parseSilks(session.stable.silks), conditions, field, nowMs, req.tactic), ...ordered.map((k) => quickRunner(k.horse, parseSilks(k.silks), conditions, field, nowMs))];
  const course = gc.courseById(conditions.courseId);
  const seed = newSeed();
  const raceName = ordered.length === 1 ? `Match race: ${mine.name} v ${ordered[0]!.horse.name}` : `Match race: ${mine.name} and ${ordered.length} more`;
  const input = gc.quickRaceInput({ id: `match-${seed.slice(0, 16)}`, name: raceName.slice(0, 80), conditions, runners, seed, postTimeMs: nowMs });
  const replay = simulateRace(input);
  const stableNames = new Map<string, string | null>([[mine.id, session.stable.name], ...ordered.map((k) => [k.horse.id, k.stableName] as [string, string])]);
  const me = positionOf(replay, mine.id);
  const summary: Summary = {
    title: QUICK_MODE_LABEL.match,
    raceName: input.race.name,
    track: course.name,
    distanceM: conditions.distanceM,
    surface: conditions.surface,
    going: conditions.going,
    horseId: mine.id,
    horseName: mine.name,
    stableName: session.stable.name,
    position: me.position,
    fieldSize: field,
    rows: summaryRows(replay, stableNames),
    headline: headlineOf(replay, mine.id),
  };
  const matchRunners: MatchRunnerInsert[] = [
    { horseId: mine.id, horseName: mine.name, stableId: session.stable.id, challenger: true, position: me.position },
    ...ordered.map((k) => ({ horseId: k.horse.id, horseName: k.horse.name, stableId: k.stableId, challenger: false, position: positionOf(replay, k.horse.id).position })),
  ];
  const row = await saveQuickRace(
    db,
    { mode: "match", accountId: session.accountId, stableId: session.stable.id, horseId: mine.id, engineVersion: replay.engineVersion, input, summary, position: me.position, finishTimeUs: me.timeUs, now },
    matchRunners,
  );
  remember(row.id, replay);
  return { id: row.id };
}

// ---------------------------------------------------------------------------
// Ghost races
// ---------------------------------------------------------------------------

/** Ghost races are offered from the start of yesterday (UTC) up to now. */
const ghostFromMs = (nowMs: number) => (dayOf(nowMs) - (gc.GHOST_SOURCE_DAYS - 1)) * DAY_MS;

async function ghostSourceList(db: Db, now: Date): Promise<GhostSourceView[]> {
  const rows = await ghostSources(db, { from: new Date(ghostFromMs(now.getTime())), to: now, top: gc.GHOST_TOP, limit: 60 });
  return rows
    .filter((r) => r.runners >= 2 && gc.courseByName(raceConds(r.race).track))
    .map((r) => {
      const c = raceConds(r.race);
      return { raceId: r.race.id, name: r.race.name, track: c.track, distanceM: c.distanceM, surface: c.surface, going: c.going, postTimeMs: r.race.postTime.getTime(), runners: r.runners, top: r.top.map((t) => ({ horseId: t.horseId, name: t.name, position: t.position })) };
    });
}

/**
 * Runs a ghost race: your horse (as it is now) against the first GHOST_TOP home in a settled Live
 * race, as they locked in that field, on its course, trip and going, with a fresh seed. If your
 * horse ran in it, the ghosts are the first three others.
 */
export async function runGhostRace(db: Db, session: Session, req: GhostRequest, now: Date): Promise<{ id: string }> {
  const nowMs = now.getTime();
  const race = await getRace(db, req.raceId);
  if (!race || race.status !== "settled" || !LIVE_SLOT.test(race.slotKey ?? "")) throw new DomainError("NOT_FOUND", "pick a settled Live race");
  if (race.postTime.getTime() < ghostFromMs(nowMs)) throw bad("ghost races are for Live races from yesterday and today");
  const c = raceConds(race);
  const course = gc.courseByName(c.track);
  if (!course) throw bad("that race can't be run again");
  const mine = await ownRunner(db, session, req.horseId, nowMs);
  const { input: locked, replay: official } = await lockedRaceInput(db, race, now);
  const order = [...official.result.finishOrder].sort((a, b) => a.position - b.position).filter((f) => f.horseId !== mine.id);
  const ghosts = order.slice(0, gc.GHOST_TOP).map((f) => {
    const e = locked.entries.find((x) => x.horse.id === f.horseId);
    if (!e) throw new Error("ghost missing from the locked field");
    return { runner: { horse: e.horse, tactic: e.tactic, ...(e.kit ? { kit: e.kit } : {}) } as gc.QuickRunner, official: f.position };
  });
  if (ghosts.length === 0) throw bad("that race has no one to race against");
  const limit = ghostRacesPerDay();
  if (await quickLimiter("ghost").hit(db, session.stable.id, nowMs)) throw new DomainError("RATE_LIMITED", `that's ${limit} ghost races today: more tomorrow`);

  const conditions: gc.QuickConditions = { courseId: course.id, distanceM: c.distanceM, surface: c.surface, going: c.going };
  const field = 1 + ghosts.length;
  const seed = newSeed();
  const input = gc.quickRaceInput({
    id: `ghost-${seed.slice(0, 16)}`,
    name: `Ghost race: ${race.name}`.slice(0, 80),
    conditions,
    runners: [quickRunner(mine, parseSilks(session.stable.silks), conditions, field, nowMs, req.tactic), ...ghosts.map((g) => g.runner)],
    seed,
    postTimeMs: nowMs,
  });
  const replay = simulateRace(input);
  const me = positionOf(replay, mine.id);
  const officialPos = new Map(ghosts.map((g) => [g.runner.horse.id, g.official]));
  const summary: Summary = {
    title: QUICK_MODE_LABEL.ghost,
    raceName: input.race.name,
    track: course.name,
    distanceM: c.distanceM,
    surface: c.surface,
    going: c.going,
    horseId: mine.id,
    horseName: mine.name,
    stableName: session.stable.name,
    position: me.position,
    fieldSize: field,
    rows: summaryRows(replay, new Map([[mine.id, session.stable.name]]), officialPos),
    headline: headlineOf(replay, mine.id),
    ghost: { sourceRaceId: race.id, sourceName: race.name, line: ghostLine(me.position, ghosts.length) },
  };
  const row = await saveQuickRace(db, { mode: "ghost", accountId: session.accountId, stableId: session.stable.id, horseId: mine.id, sourceRaceId: race.id, engineVersion: replay.engineVersion, input, summary, position: me.position, finishTimeUs: me.timeUs, now });
  remember(row.id, replay);
  return { id: row.id };
}

// ---------------------------------------------------------------------------
// The daily challenge
// ---------------------------------------------------------------------------

const GRADES: readonly JockeyGrade[] = ["A", "B", "C", "D", "E"];

/** Takes today's one attempt: the day's puzzle, your three choices, the day's seed. */
export async function runDailyChallenge(db: Db, session: Session, choice: DailyRequest, now: Date): Promise<{ id: string }> {
  const day = dayOf(now.getTime());
  const date = utcDate(day);
  if (await dailyAttemptOf(db, session.stable.id, date)) throw new DomainError("RACE_LIMIT", "you've had today's attempt: the next challenge is published at 00:00 UTC");
  const spec = gc.dailyChallengeSpec(day);
  const seed = await dailyChallengeSeed(db, day);
  const input = gc.dailyChallengeInput(spec, choice, seed);
  const replay = simulateRace(input);
  const horseId = gc.dailyHorseId(day);
  const me = positionOf(replay, horseId);
  const points = gc.dailyPoints(me.position);
  const course = gc.courseById(spec.conditions.courseId);
  const names = new Map<string, string | null>([[horseId, session.stable.name]]);
  const summary: Summary = {
    title: QUICK_MODE_LABEL.daily,
    raceName: `${spec.name} · ${date}`,
    track: course.name,
    distanceM: spec.conditions.distanceM,
    surface: spec.conditions.surface,
    going: spec.conditions.going,
    horseId,
    horseName: spec.horse.name,
    stableName: session.stable.name,
    position: me.position,
    fieldSize: input.entries.length,
    rows: summaryRows(replay, names),
    headline: headlineOf(replay, horseId),
    daily: { day, plan: { tactic: choice.tactic, intensity: choice.intensity, grade: choice.grade }, points, seedCommitment: commitSeed(seed) },
  };
  const row = await saveQuickRace(db, { mode: "daily", accountId: session.accountId, stableId: session.stable.id, challengeDay: date, engineVersion: replay.engineVersion, input, summary, position: me.position, finishTimeUs: me.timeUs, points, now });
  remember(row.id, replay);
  return { id: row.id };
}

/** The day's leaderboard, ranked (game-core rankDaily). */
async function rankedBoard(db: Db, date: string) {
  const rows = await dailyBoard(db, date);
  const ranked = gc.rankDaily(rows.map((r) => ({ key: r.id, position: r.position, finishTimeUs: r.finishTimeUs, atMs: r.createdAt.getTime() })));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ranked.map((s) => ({ ...s, row: byId.get(s.key)! }));
}

/** The daily challenge card: the puzzle, your attempt, the board, your streak and badges, yesterday's reveal. */
export async function dailyView(db: Db, session: Session | null, now: Date): Promise<DailyView> {
  const nowMs = now.getTime();
  const day = dayOf(nowMs);
  const date = utcDate(day);
  const spec = gc.dailyChallengeSpec(day);
  const seed = await dailyChallengeSeed(db, day);
  const course = gc.courseById(spec.conditions.courseId);
  const silks = gc.DAILY_CHALLENGE_SILKS;
  const shared = gc.toSharedHorse(spec.horse, spec.opensAtMs, silks);
  const board = await rankedBoard(db, date);
  const mineRow = session ? board.find((b) => b.row.stableId === session.stable.id) : undefined;
  const lines: DailyBoardLine[] = board.slice(0, 10).map((b) => boardLine(b, session, false));
  if (mineRow && mineRow.rank > 10) lines.push(boardLine(mineRow, session, false));

  let streak = { current: 0, best: 0 };
  let points = 0;
  let badges = 0;
  if (session) {
    const hist = await dailyHistory(db, session.stable.id);
    streak = gc.dailyStreak(hist.map((h) => Math.floor(Date.parse(`${h.day}T00:00:00Z`) / DAY_MS)), day);
    points = hist.reduce((a, h) => a + h.points, 0);
    badges = (await dailyStandingsOf(db, session.stable.id)).filter((s) => s.day < date && s.rank <= gc.dailyTopCut(s.entrants)).length;
  }

  // Yesterday: the seed revealed (it can be checked against the commitment shown all day).
  let yesterday: DailyView["yesterday"] = null;
  const ySeed = await storedDailyChallengeSeed(db, day - 1);
  if (ySeed) {
    const yDate = utcDate(day - 1);
    const yBoard = await rankedBoard(db, yDate);
    const yMine = session ? yBoard.find((b) => b.row.stableId === session.stable.id) : undefined;
    yesterday = { date: yDate, seed: ySeed, seedCommitment: commitSeed(ySeed), entrants: yBoard.length, mine: yMine ? { rank: yMine.rank, position: yMine.position, top: yMine.top, quickRaceId: yMine.row.id } : null };
  }

  const mineSummary = mineRow ? (mineRow.row.summary as Summary) : null;
  return {
    day,
    date,
    name: spec.name,
    opensAtMs: spec.opensAtMs,
    closesAtMs: spec.closesAtMs,
    course: { id: course.id, name: course.name, character: course.character },
    distanceM: spec.conditions.distanceM,
    surface: spec.conditions.surface,
    going: spec.conditions.going,
    weather: spec.conditions.weather,
    horse: { id: spec.horse.id, name: spec.horse.name, appearance: shared.appearance, style: gc.runningStyle(spec.horse.genome) as RunningStyle, bestTripM: gc.preferredDistanceM(spec.horse.genome), surface: gc.preferredSurface(spec.horse.genome), stats: { ...shared.stats } },
    gate: spec.gate,
    rivals: spec.rivals.map((r) => ({ gate: r.gate, name: r.horse.name, tactic: r.tactic, appearance: r.horse.appearance })).sort((a, b) => a.gate - b.gate),
    seedCommitment: commitSeed(seed),
    weights: Object.fromEntries(GRADES.map((g) => [g, gc.dailyWeightLb(g)])) as Record<JockeyGrade, number>,
    mine: mineRow && mineSummary?.daily ? { quickRaceId: mineRow.row.id, position: mineRow.position, rank: mineRow.rank, points: mineRow.points, top: mineRow.top, plan: mineSummary.daily.plan } : null,
    entrants: board.length,
    board: lines,
    streak,
    points,
    badges,
    yesterday,
  };
}

function boardLine(b: Awaited<ReturnType<typeof rankedBoard>>[number], session: Session | null, dayOver: boolean): DailyBoardLine {
  const mine = !!session && b.row.stableId === session.stable.id;
  const s = b.row.summary as Summary;
  return {
    rank: b.rank,
    stableName: b.row.stableName,
    silks: parseSilks(b.row.silks),
    position: b.position,
    timeUs: b.finishTimeUs,
    points: b.points,
    top: b.top,
    mine,
    // Before the day is over a plan (and the replay) would give the puzzle away: yours only.
    plan: dayOver || mine ? (s.daily?.plan ?? null) : null,
    quickRaceId: dayOver || mine ? b.row.id : null,
  };
}

// ---------------------------------------------------------------------------
// The hub, a result and its replay
// ---------------------------------------------------------------------------

function listItem(r: QuickRaceRow): QuickListItem {
  const s = r.summary as Summary;
  const line = r.mode === "ghost" && s.ghost ? s.ghost.line : r.mode === "daily" ? `${ordinal(r.position)} of ${s.fieldSize} · ${r.points} pts` : `${ordinal(r.position)} of ${s.fieldSize}`;
  return { id: r.id, mode: r.mode as QuickMode, title: r.mode === "daily" ? s.raceName : s.raceName.replace(/^(Match|Ghost) race: /, ""), line, position: r.position, createdAtMs: r.createdAt.getTime() };
}

export async function quickHub(db: Db, session: Session | null, now: Date): Promise<QuickHubView> {
  const nowMs = now.getTime();
  const horses: QuickHorse[] = [];
  if (session) {
    for (const row of await listStableHorses(db, session.stable.id)) {
      if (quickHorseReason(row, nowMs) !== null) continue;
      horses.push(quickHorseView({ horse: row, stableId: session.stable.id, stableName: session.stable.name, silks: session.stable.silks }, nowMs));
    }
  }
  const today = utcDate(dayOf(nowMs));
  const notes = session
    ? (await listMatchNotes(db, session.accountId, 3))
        .filter((n) => n.createdAt.toISOString().slice(0, 10) === today)
        .map((n) => ({ title: n.title, atMs: n.createdAt.getTime(), lines: (((n.data ?? {}) as { lines?: { winner: string; challenger: string; quickRaceId: string }[] }).lines ?? []).slice(0, 5).map((l) => ({ winner: l.winner, challenger: l.challenger, quickRaceId: l.quickRaceId })) }))
    : [];
  return {
    serverNowMs: nowMs,
    signedIn: !!session,
    horses,
    courses: gc.COURSES.map((c) => ({ id: c.id, name: c.name, surfaces: [...c.surfaces], character: c.character })),
    trips: [...gc.QUICK_TRIPS],
    goings: [...gc.QUICK_GOINGS],
    match: { remaining: session ? await remaining(db, "match", session.stable.id, nowMs) : 0, perDay: matchRacesPerDay(), fieldMax: gc.MATCH_FIELD_MAX },
    ghost: { remaining: session ? await remaining(db, "ghost", session.stable.id, nowMs) : 0, perDay: ghostRacesPerDay(), top: gc.GHOST_TOP, sources: await ghostSourceList(db, now) },
    daily: await dailyView(db, session, now),
    recent: session ? (await listQuickRaces(db, session.stable.id, 8)).map(listItem) : [],
    notes,
  };
}

/** A quick race row a viewer may see: anyone for a match or ghost race; someone else's daily attempt only once its day is over. */
async function visibleRow(db: Db, session: Session | null, id: string, nowMs: number): Promise<{ row: QuickRaceRow; dayOver: boolean }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new DomainError("NOT_FOUND", "quick race not found");
  const row = await getQuickRace(db, id);
  if (!row) throw new DomainError("NOT_FOUND", "quick race not found");
  const dayOver = row.mode !== "daily" || !row.challengeDay || nowMs >= Date.parse(`${row.challengeDay}T00:00:00Z`) + DAY_MS;
  if (!dayOver && row.stableId !== session?.stable.id) throw new DomainError("TOO_EARLY", "other stables' attempts open once the day's challenge is over (00:00 UTC)");
  return { row, dayOver };
}

/** A quick race's result for its page. */
export async function quickRaceView(db: Db, session: Session | null, id: string, now: Date): Promise<QuickRaceView> {
  const { row, dayOver } = await visibleRow(db, session, id, now.getTime());
  const s = row.summary as Summary;
  const mode = row.mode as QuickMode;
  const yours = row.stableId === session?.stable.id;
  const view: QuickRaceView = {
    id: row.id,
    mode,
    badge: QUICK_BADGE[mode],
    title: s.title,
    raceName: s.raceName,
    track: s.track,
    distanceM: s.distanceM,
    surface: s.surface,
    going: s.going,
    createdAtMs: row.createdAt.getTime(),
    yours,
    horseId: s.horseId,
    horseName: s.horseName,
    stableName: s.stableName,
    position: s.position,
    fieldSize: s.fieldSize,
    rows: s.rows.map((r) => ({ ...r, mine: r.horseId === s.horseId })),
    headline: s.headline,
    note:
      mode === "daily"
        ? "The daily challenge: points and badges only. Nothing else in the game moves."
        : `Unofficial: no rating, fatigue, injury, credits or form. ${mode === "ghost" ? "The real race's result stands." : "The official records are unchanged."}`,
  };
  if (mode === "match") {
    const opp = new Set(s.rows.map((r) => r.horseId).filter((h) => h !== s.horseId));
    view.match = { records: (await matchRecordOf(db, s.horseId)).filter((r) => opp.has(r.opponentId)).map((r) => ({ opponentId: r.opponentId, opponentName: r.opponentName, won: r.won, lost: r.lost, meetings: r.meetings })) };
  }
  if (mode === "ghost" && s.ghost) view.ghost = s.ghost;
  if (mode === "daily" && s.daily && row.challengeDay) {
    const board = await rankedBoard(db, row.challengeDay);
    const me = board.find((b) => b.key === row.id);
    const seed = dayOver ? await storedDailyChallengeSeed(db, s.daily.day) : null;
    view.daily = {
      day: s.daily.day,
      date: row.challengeDay,
      plan: s.daily.plan,
      points: s.daily.points,
      rank: me?.rank ?? 0,
      entrants: board.length,
      top: me?.top ?? false,
      seedCommitment: s.daily.seedCommitment,
      seed,
      closesAtMs: (s.daily.day + 1) * DAY_MS,
    };
  }
  return view;
}

/**
 * The replay for the viewer, re-simulated from the stored input (deterministic). A daily attempt's
 * seed is masked until its day is over (its luck is everyone's that day).
 */
export async function quickRaceReplay(db: Db, session: Session | null, id: string, now: Date): Promise<RaceReplay> {
  const { row, dayOver } = await visibleRow(db, session, id, now.getTime());
  let replay = replays.get(row.id);
  if (!replay) {
    replay = simulateRace(row.input as RaceInput);
    if (replay.engineVersion !== row.engineVersion) throw new DomainError("INVALID_INPUT", "this quick race can no longer be replayed exactly");
    remember(row.id, replay);
  }
  return dayOver ? replay : { ...replay, seed: HIDDEN_SEED };
}

/** The Home "Today" line for the daily challenge. */
export async function dailyTile(db: Db, session: Session, now: Date): Promise<{ name: string; course: string; distanceM: number; closesAtMs: number; mine: { rank: number; entrants: number; quickRaceId: string; points: number } | null }> {
  const day = dayOf(now.getTime());
  const spec = gc.dailyChallengeSpec(day);
  const date = utcDate(day);
  const mineRow = await dailyAttemptOf(db, session.stable.id, date);
  let mine = null;
  if (mineRow) {
    const board = await rankedBoard(db, date);
    const me = board.find((b) => b.key === mineRow.id);
    mine = { rank: me?.rank ?? 0, entrants: board.length, quickRaceId: mineRow.id, points: mineRow.points };
  }
  return { name: spec.name, course: gc.courseById(spec.conditions.courseId).name, distanceM: spec.conditions.distanceM, closesAtMs: spec.closesAtMs, mine };
}
