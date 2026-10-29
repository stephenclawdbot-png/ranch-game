/**
 * Competition screens on the server: the Daily Cup (time trial against one seeded field a
 * day), weekly leagues and the season, and the Hall of Fame. Rules come from game-core
 * (dailyCup, leagues, seasons, social); state from packages/db (dailyCup, leagues, hall).
 *
 * The Daily Cup isn't a Live race: every entrant runs alone against the same fixed field, so
 * a run can be shown at once ("instant" is fine for a time trial). The day's seed stays
 * sealed (withheld from replays) until the Cup closes at UTC midnight; only its commitment
 * is public. Leagues use settled Live results only, so they never reveal a running race.
 */
import * as gc from "@thoroughbred/game-core";
import { HorseSchema, RunningStyleSchema, type Horse, type RaceReplay } from "@thoroughbred/shared";
import { ENGINE_VERSION, simulateRace } from "@thoroughbred/racing-engine";
import {
  DomainError,
  RULES,
  championHorses,
  cupDayEntries,
  cupDaySecret,
  cupEntryById,
  dayNumber,
  famousBloodlines,
  hallEntries,
  horseNamesByIds,
  inductHallOfFame,
  induct,
  isGenome,
  leagueHistory,
  leagueOf,
  listAchievements,
  listStableHorses,
  listStablePlacings,
  recordTimes,
  rivalsOf,
  runCupEntry,
  seasonNumberAt,
  seasonStandings,
  settleLeagueWeeks,
  syncAchievements,
  toHorseState,
  topHorsesOf,
  utcDay,
  utcWeekStart,
  weekBounds,
  type CupBoardRow,
  type Db,
} from "@thoroughbred/db";
import { conditionRating, lossGrade } from "@/lib/aptitude";
import type { CalendarRaceView, CupConditions, CupRow, CupRunView, CupView, HallView, LeagueRowView, LeagueView, SeasonRowView, TrophyRoomView, TrophyTier } from "@/lib/competitionTypes";
import { houseStableFor } from "./house";
import { horseFromRow, parseSilks, stableHorseView } from "./horseView";
import type { Session } from "./session";

// ---------------------------------------------------------------------------
// Daily Cup
// ---------------------------------------------------------------------------

const SEALED_SEED = "0".repeat(64);
const cupCache = new Map<number, gc.DailyCupDay>();

/** The Cup of a UTC day number (seed from the day's stored secret). */
async function cupOf(db: Db, day: number): Promise<gc.DailyCupDay> {
  const hit = cupCache.get(day);
  if (hit) return hit;
  const cup = gc.dailyCupDay(await cupDaySecret(db, day), day);
  cupCache.set(day, cup);
  if (cupCache.size > 8) cupCache.delete(cupCache.keys().next().value!);
  return cup;
}

function cupConditions(cup: gc.DailyCupDay): CupConditions {
  return { name: `Daily Cup · ${cup.distanceM.toLocaleString("en-GB")} m ${cup.surface}`, distanceM: cup.distanceM, surface: cup.surface, going: cup.going, weather: cup.weather };
}

function ranked(rows: CupBoardRow[], viewer: string | null): CupRow[] {
  const standings = gc.rankCup(rows.map((r) => ({ ownerId: r.accountId, horseId: r.id, finishTimeUs: r.finishTimeUs, position: r.finishPosition, enteredAtMs: r.createdAt.getTime() })));
  const by = new Map(rows.map((r) => [r.id, r]));
  return standings.map((s) => {
    const r = by.get(s.horseId)!;
    return { rank: s.rank, entryId: r.id, stableName: r.stableName, silks: parseSilks(r.silks), horseName: r.horseName, timeUs: r.finishTimeUs, position: r.finishPosition, percentile: s.percentile, badge: s.badge, mine: r.accountId === viewer };
  });
}

/** Why a horse can't take a Cup Run (the Cup isn't a start: race locks and daily limits don't apply). */
function cupBlock(row: Awaited<ReturnType<typeof listStableHorses>>[number], nowMs: number): string | null {
  if (row.careerStatus !== "racing") return row.careerStatus === "pasture" ? "Retired" : "At stud: no longer racing";
  if (row.careSessions < RULES.careToRacing) return "Not yet of racing age";
  if (row.injuredUntil && row.injuredUntil.getTime() > nowMs) return "Recovering from injury";
  if (!isGenome(row.genome)) return "Not eligible";
  return null;
}

export async function cupView(db: Db, session: Session | null, now: Date): Promise<CupView> {
  const nowMs = now.getTime();
  const day = gc.dayIndex(nowMs);
  const cup = await cupOf(db, day);
  const board = ranked(await cupDayEntries(db, utcDay(now)), session?.accountId ?? null);
  const mine = board.find((r) => r.mine) ?? null;
  const near = mine ? board.slice(Math.max(0, mine.rank - 4), mine.rank + 3) : [];
  let horses: CupView["horses"] = null;
  if (session && !mine) {
    const silks = parseSilks(session.stable.silks);
    const c = { distanceM: cup.distanceM, surface: cup.surface, going: cup.going };
    horses = (await listStableHorses(db, session.stable.id))
      .filter((r) => r.careerStatus === "racing" && r.careSessions >= RULES.careToRacing)
      .map((row) => {
        const h = stableHorseView(row, silks, nowMs).horse;
        const loss = Math.max(0, conditionRating(h, h.style, { distanceM: h.preferredDistanceM, surface: h.preferredSurface, going: "good" }) - conditionRating(h, h.style, c));
        return { id: row.id, name: h.name, style: h.style, grade: lossGrade(loss), loss, block: cupBlock(row, nowMs) };
      })
      .sort((a, b) => Number(a.block !== null) - Number(b.block !== null) || a.loss - b.loss);
  }
  const yDay = new Date((day - 1) * gc.MS_PER_DAY);
  const yBoard = ranked(await cupDayEntries(db, utcDay(yDay), 2000), session?.accountId ?? null);
  const yCup = await cupOf(db, day - 1);
  const gates = [1, 2, 3, 5, 6, 7, 8];
  return {
    day: utcDay(now),
    opensAtMs: cup.opensAtMs,
    closesAtMs: cup.closesAtMs,
    serverNowMs: nowMs,
    conditions: cupConditions(cup),
    seedCommitment: cup.seedCommitment,
    field: cup.field.map((h, i) => ({ gate: gates[i]!, name: h.name, style: h.style, silks: h.appearance.silks })),
    entrants: board.length,
    participationCredits: gc.CUP_PARTICIPATION_CREDITS,
    board: { top: board.slice(0, 10), near },
    mine,
    horses,
    yesterday: yBoard.length ? { day: utcDay(yDay), winner: yBoard[0] ?? null, mine: yBoard.find((r) => r.mine) ?? null, seed: yCup.seed } : null,
  };
}

export interface CupRunRequest {
  horseId: string;
  tactic?: Horse["style"];
}

/** Today's Cup Run for one horse: simulated now against the fixed field (free, not a start). */
export async function runCup(db: Db, session: Session, req: CupRunRequest, now: Date): Promise<{ entryId: string }> {
  const nowMs = now.getTime();
  const cup = await cupOf(db, gc.dayIndex(nowMs));
  const block = gc.cupEntryBlock(cup, nowMs, false);
  if (block) throw new DomainError("RACE_CLOSED", "the Daily Cup isn't open");
  const silks = parseSilks(session.stable.silks);
  const row = await runCupEntry(db, {
    accountId: session.accountId,
    horseId: req.horseId,
    now,
    credits: gc.CUP_PARTICIPATION_CREDITS,
    run: (horse) => {
      if (!isGenome(horse.genome)) throw new DomainError("NOT_ELIGIBLE", "this horse can't run in the Cup");
      const state = toHorseState(horse);
      const tactic = req.tactic ?? (gc.runningStyle(state.genome) as Horse["style"]);
      const entrant = gc.raceSnapshot(state, {
        nowMs,
        silks,
        race: { going: cup.going, fieldSize: gc.CUP_FIELD_SIZE + 1, bigCrowd: false, surface: cup.surface, distanceM: cup.distanceM },
        plan: { tactic, intensity: "normal" },
      }).horse;
      const run = gc.runDailyCup(cup, entrant, tactic, simulateRace);
      return { finishPosition: run.position, finishTimeUs: run.finishTimeUs, result: { horse: entrant, tactic, engineVersion: ENGINE_VERSION, resultHash: run.replay.result.resultHash } };
    },
  });
  return { entryId: row.id };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const runCache = new Map<string, RaceReplay>();

/** A Cup Run with its replay (re-simulated from the stored entrant; the seed is sealed while the day is open). */
export async function cupRunView(db: Db, entryId: string, session: Session | null, now: Date): Promise<CupRunView | null> {
  if (!UUID_RE.test(entryId)) return null;
  const entry = await cupEntryById(db, entryId);
  if (!entry) return null;
  const stored = (entry.result ?? {}) as { horse?: unknown; tactic?: unknown };
  const horse = HorseSchema.safeParse(stored.horse);
  const tactic = RunningStyleSchema.safeParse(stored.tactic);
  if (!horse.success || !tactic.success) return null;
  const cup = await cupOf(db, dayNumber(entry.day));
  let replay = runCache.get(entryId);
  if (!replay) {
    replay = gc.runDailyCup(cup, horse.data, tactic.data, simulateRace).replay;
    runCache.set(entryId, replay);
    if (runCache.size > 64) runCache.delete(runCache.keys().next().value!);
  }
  const sealed = now.getTime() < cup.closesAtMs;
  const board = ranked(await cupDayEntries(db, entry.day), session?.accountId ?? null);
  const me = board.find((r) => r.entryId === entryId);
  const mine = !!session && entry.accountId === session.accountId;
  return {
    entryId,
    day: entry.day,
    mine,
    horseName: horse.data.name,
    stableName: me?.stableName ?? "A stable",
    conditions: cupConditions(cup),
    timeUs: Number(entry.finishTimeUs ?? 0),
    position: entry.finishPosition ?? 0,
    fieldSize: gc.CUP_FIELD_SIZE + 1,
    rank: me?.rank ?? 0,
    of: board.length,
    percentile: me?.percentile ?? 1000,
    badge: me?.badge ?? "finisher",
    sealed,
    seedCommitment: cup.seedCommitment,
    replay: sealed ? { ...replay, seed: SEALED_SEED } : replay,
    entrantId: gc.CUP_ENTRANT_ID,
  };
}

// ---------------------------------------------------------------------------
// Leagues and season
// ---------------------------------------------------------------------------

const SEASON_CLOCK = { epochMs: RULES.seasonEpochMs };

function calendarView(now: Date): CalendarRaceView[] {
  const nowMs = now.getTime();
  const season = seasonNumberAt(now);
  const cal = [...gc.featureCalendar(SEASON_CLOCK, season), ...gc.featureCalendar(SEASON_CLOCK, season + 1)];
  const nextQualifier = cal.find((r) => r.kind === "feature_qualifier" && r.postTimeMs > nowMs);
  return cal
    .filter((r) => r.postTimeMs > nowMs - 3_600_000 && (r.kind !== "feature_qualifier" || r === nextQualifier))
    .slice(0, 8)
    .map((r) => ({ id: r.id, name: r.name, kind: r.kind as CalendarRaceView["kind"], postTimeMs: Math.floor((r.postTimeMs - RULES.seasonEpochMs) / RULES.slotMs) * RULES.slotMs + RULES.seasonEpochMs, division: r.division, distanceM: r.distanceM, surface: r.surface }));
}

export async function leagueView(db: Db, session: Session | null, now: Date): Promise<LeagueView> {
  // Finished weeks settle lazily (idempotent); the cron-free path.
  await settleLeagueWeeks(db, now).catch((e) => console.error("[league] settle failed", e));
  const viewer = session?.accountId ?? null;
  const table = viewer ? await leagueOf(db, viewer, now) : null;
  const week = weekBounds(utcWeekStart(now));
  let rows: LeagueRowView[] = [];
  if (table) {
    const moves = new Map(
      gc
        .settleLeague({ id: table.leagueId, week: 0, tier: table.tierName as gc.LeagueTier, members: table.rows.map((r) => ({ ownerId: r.accountId, points: r.points, wins: r.wins, bestFinish: r.bestFinish })) })
        .map((m) => [m.ownerId, m.outcome]),
    );
    rows = table.rows.map((r, i) => ({
      rank: i + 1,
      stableName: r.stableName,
      silks: parseSilks(r.silks),
      points: r.points,
      wins: r.wins,
      runs: r.runs,
      bestFinish: r.bestFinish,
      mine: r.accountId === viewer,
      zone: moves.get(r.accountId) === "promoted" ? "promote" : moves.get(r.accountId) === "relegated" ? "relegate" : null,
    }));
  }
  const season = seasonNumberAt(now);
  const st = await seasonStandings(db, { season, now, accountId: viewer, limit: 10 });
  const seasonRow = (r: (typeof st.rows)[number]): SeasonRowView => ({ rank: r.rank, stableName: r.stableName, silks: parseSilks(r.silks), points: r.points, wins: r.wins, runs: r.runs, mine: r.accountId === viewer });
  const history = viewer ? await leagueHistory(db, viewer) : [];
  return {
    serverNowMs: now.getTime(),
    weekStart: table?.weekStart ?? utcDay(week.from),
    weekEndsAtMs: (table ? weekBounds(table.weekStart).to : week.to).getTime(),
    joined: !!table,
    tier: table?.tier ?? 1,
    tierName: table?.tierName ?? gc.LEAGUE_TIERS[0]!,
    tierCount: gc.LEAGUE_TIERS.length,
    group: table?.group ?? 1,
    capacity: table?.capacity ?? gc.LEAGUE_SIZE,
    promote: gc.PROMOTE,
    relegate: gc.RELEGATE,
    rows,
    history: history.map((h) => ({ weekStart: h.weekStart, tierName: gc.LEAGUE_TIERS[Math.max(0, h.tier - 1)] ?? "bronze", points: h.points, finalRank: h.finalRank, movement: h.movement })),
    season: { number: season, startsAtMs: st.startsAt.getTime(), endsAtMs: st.endsAt.getTime(), owners: st.owners, rows: st.rows.map(seasonRow), mine: st.mine ? seasonRow(st.mine) : null },
    calendar: calendarView(now),
    rules: { racePoints: [...gc.RACE_POINTS], startPoint: gc.START_POINT, weeklyCap: gc.WEEKLY_RACE_POINTS_CAP },
  };
}

// ---------------------------------------------------------------------------
// Hall of Fame
// ---------------------------------------------------------------------------

const HALL_TTL_MS = 60_000;
const G = globalThis as typeof globalThis & { __tbHall?: { at: number } };
const hallState = (G.__tbHall ??= { at: 0 });

/** Season champions (most league points in a finished season): inducted once, permanently. */
async function inductSeasonChampions(db: Db, now: Date): Promise<void> {
  const current = seasonNumberAt(now);
  for (let s = Math.max(1, current - 3); s < current; s++) {
    const st = await seasonStandings(db, { season: s, now, limit: 1 });
    const top = st.rows[0];
    if (!top || top.points <= 0) continue;
    await induct(db, { entryKey: `season:${s}:owner`, category: "season_winner", title: `${top.stableName}: Season ${s} champion owner`, accountId: top.accountId, seasonNumber: s, data: { points: top.points, wins: top.wins } });
  }
}

export async function hallView(db: Db, session: Session | null, now: Date): Promise<HallView> {
  // Inductions are idempotent; run them at most once a minute per instance.
  if (now.getTime() - hallState.at > HALL_TTL_MS || now.getTime() < hallState.at) {
    hallState.at = now.getTime();
    await inductHallOfFame(db, now).catch((e) => console.error("[hall] induction failed", e));
    await inductSeasonChampions(db, now).catch((e) => console.error("[hall] season induction failed", e));
  }
  const houseName = (horseId: string, stableName: string | null) => stableName ?? houseStableFor(horseId).name;
  const [entries, records, champions, bloodlines] = [await hallEntries(db), await recordTimes(db), await championHorses(db), await famousBloodlines(db)];
  const winners: HallView["seasonWinners"] = entries
    .filter((e) => e.entry.category === "season_winner" && e.entry.entryKey.endsWith(":owner"))
    .map((e) => ({ season: e.entry.seasonNumber ?? 0, stableName: e.entry.title.split(":")[0] ?? "A stable", silks: parseSilks(null), points: Number((e.entry.data as { points?: number } | null)?.points ?? 0) }));
  let mine: HallView["mine"] = null;
  if (session) {
    await syncAchievements(db, session.accountId).catch((e) => console.error("[hall] achievements failed", e));
    const earned = await listAchievements(db, session.accountId);
    const at = new Map(earned.map((a) => [a.code, a.earnedAt.getTime()]));
    const titles = gc.STORY_CHAPTER_DEFS.filter((c) => at.has(`story-chapter:${c.id}`)).map((c) => `${c.title} champion`);
    mine = {
      stableName: session.stable.name,
      achievements: gc.ACHIEVEMENTS.map((a) => ({ id: a.id, title: a.title, description: a.description, earned: at.has(a.id), earnedAtMs: at.get(a.id) ?? null })),
      titles,
      rivals: (await rivalsOf(db, session.stable.id)).map((r) => ({ stableName: r.stableName, silks: parseSilks(r.silks), closeFinishes: r.closeFinishes, yourWins: r.yourWins, lastAtMs: r.lastAtMs })),
    };
  }
  return {
    inducted: entries.map((e) => ({ key: e.entry.entryKey, category: e.entry.category, title: e.entry.title, horseId: e.entry.horseId, stableName: e.stableName, season: e.entry.seasonNumber, atMs: e.entry.inductedAt.getTime() })),
    records: records.map((r) => ({ surface: r.surface as HallView["records"][number]["surface"], distanceM: r.distanceM, timeUs: r.timeUs, horseId: r.horseId, horseName: r.horseName, stableName: houseName(r.horseId, r.stableName), raceId: r.raceId, atMs: r.postTime.getTime() })),
    champions: champions.map((c) => ({ horseId: c.horseId, name: c.name, stableName: houseName(c.horseId, c.stableName), liveWins: c.liveWins, liveRuns: c.liveRuns, gradedWins: c.gradedWins, earnings: c.earnings, rating: c.rating, retired: c.careerStatus !== "racing" })),
    bloodlines: bloodlines.map((b) => ({ horseId: b.horseId, name: b.name, sex: b.sex, stableName: houseName(b.horseId, b.stableName), offspring: b.offspring, winners: b.winners, wins: b.wins })),
    seasonWinners: winners,
    mine,
  };
}

// ---------------------------------------------------------------------------
// Trophy Room
// ---------------------------------------------------------------------------

/** Cup by race standing for a win; rosettes for Story (solo) wins and for places. */
export function trophyTier(kind: string, raceClass: string, position: number): TrophyTier {
  if (position === 2) return "second";
  if (position === 3) return "third";
  if (kind === "final" || kind === "feature" || raceClass === "graded") return "gold";
  if (kind === "daily_cup" || raceClass === "listed") return "silver";
  if (kind === "scheduled" || kind === "trial") return "bronze";
  return "first";
}

const TIER_ORDER: Record<TrophyTier, number> = { gold: 0, silver: 1, bronze: 2, first: 3, second: 4, third: 5 };

export async function trophyRoomView(db: Db, session: Session, now: Date): Promise<TrophyRoomView> {
  const stableId = session.stable.id;
  const runs = await listStablePlacings(db, stableId, 500);
  const names = await horseNamesByIds(db, runs.map((r) => r.horseId));
  const trophies = runs.map((r) => ({
    raceId: r.raceId,
    raceName: r.raceName,
    horseId: r.horseId,
    horseName: names.get(r.horseId) ?? "A horse",
    position: r.position!,
    atMs: r.postTime.getTime(),
    prize: r.prize ?? 0,
    tier: trophyTier(r.kind, r.raceClass, r.position!),
  }));
  const cups = trophies.filter((t) => t.tier === "gold" || t.tier === "silver" || t.tier === "bronze").sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.atMs - a.atMs);
  const rosettes = trophies.filter((t) => t.tier === "first" || t.tier === "second" || t.tier === "third").sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.atMs - a.atMs);
  await syncAchievements(db, session.accountId).catch((e) => console.error("[trophies] achievements failed", e));
  const earned = await listAchievements(db, session.accountId);
  const at = new Map(earned.map((a) => [a.code, a.earnedAt.getTime()]));
  const honours: TrophyRoomView["honours"] = gc.STORY_CHAPTER_DEFS.filter((c) => at.has(`story-chapter:${c.id}`)).map((c) => ({
    key: `story:${c.id}`,
    title: `${c.title} champion`,
    detail: "Story chapter won",
    atMs: at.get(`story-chapter:${c.id}`) ?? null,
  }));
  for (const e of await hallEntries(db)) {
    if (e.stableName !== session.stable.name) continue;
    honours.push({ key: e.entry.entryKey, title: e.entry.title, detail: "Hall of Fame", atMs: e.entry.inductedAt.getTime() });
  }
  const nowMs = now.getTime();
  const silks = parseSilks(session.stable.silks);
  const stars = (await topHorsesOf(db, stableId, 3))
    .filter((h) => h.wins > 0)
    .map((h) => ({ horseId: h.id, name: h.name, appearance: horseFromRow(h, silks, nowMs).appearance, wins: h.wins, starts: h.starts, earnings: h.earnings, status: (h.careerStatus === "racing" ? "racing" : h.careerStatus === "retired" ? "stud" : "retired") as "racing" | "stud" | "retired" }));
  return {
    stableName: session.stable.name,
    silks,
    totals: {
      wins: trophies.filter((t) => t.position === 1).length,
      places: trophies.filter((t) => t.position > 1).length,
      cups: cups.length,
      earnings: trophies.reduce((a, t) => a + t.prize, 0),
    },
    cups,
    rosettes,
    achievements: gc.ACHIEVEMENTS.map((a) => ({ id: a.id, title: a.title, description: a.description, earned: at.has(a.id), earnedAtMs: at.get(a.id) ?? null })),
    honours,
    stars,
  };
}
