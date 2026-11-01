/**
 * Story curve probe (first-hour follow-up, 2026-11-01): brand-new stables play Story the way the
 * game suggests, through the real server code on an in-memory database, and we record how long
 * chapter 1 takes and how it feels (losing streaks, win rate by race, real minutes, forced waits),
 * then the step into chapter 2.
 *
 * Test and harness only (storyCurve.test.ts, tools/season-harness/storyCurve.harness.ts): nothing
 * in the app imports it. The player it models:
 *   - founds a stable and runs its first race from the starters screen (an open Story race, Quick
 *     Pick: the onboarding path);
 *   - then plays chapter races: the race the Story screen and Home suggest (the first race of the
 *     chapter not yet won), with the horse the game suggests for it and its natural riding plan;
 *   - after a loss, takes Wilf's one change (the result page's verdict, computed from the replay as
 *     the page does): a riding plan, a fresh horse, or a race that suits (the unwon chapter race
 *     that suits the horse best);
 *   - respects rest: never runs a horse that is blocked (3 starts a day) and never a tired one when
 *     a rested one can run; when every horse is blocked it waits until one can (the wait is recorded);
 *   - cares for its horses once a day (the first-week list's first job).
 * A horse is tired after most races (fatigue over the line): it still runs when no rested one can,
 * as the game's own pick does, and that is counted (tiredStarts).
 * Real minutes per race: the 10 s to the off, the broadcast (the engine's own race time), and
 * READ_MS to read the result and tap the next race.
 */
import * as gc from "@thoroughbred/game-core";
import { authenticate, getRace, listStableHorses, storyState, type Db } from "@thoroughbred/db";
import { analyseRace } from "@/lib/raceAnalysis";
import { raceStory, type OneChange } from "@/lib/raceStory";
import { tryNext } from "@/lib/tryNext";
import { conditionRating } from "@/lib/aptitude";
import type { RacePlan } from "@/lib/types";
import { foundStable } from "./founding";
import { createStoryRace, raceCard, servedReplay } from "./game";
import { careAction } from "./horseLife";
import { broadcastEndsAtMs } from "./live";
import { parseSilks, stableHorseView } from "./horseView";
import { createChapterRace, suggestedChapterRace, suitedChapterRace } from "./story";

/** Reading the result and tapping the next race (a person, not the robot). */
export const READ_MS = 45_000;
const HOUR = 3_600_000;

export interface ProbeRace {
  /** 0 = the first (open) race from the starters screen; 1.. = chapter races in order run. */
  n: number;
  raceKey: string | null;
  chapter: string;
  won: boolean;
  position: number;
  field: number;
  /** Field strength the race was run at (chapter races). */
  strength: number | null;
  /** Mean stat of the player's horse (its own stats, as the stable shows them), of its runner as it raced, and of the rival runners (the field). */
  level: number;
  myMean: number;
  fieldMean: number;
  /** Minutes since the stable was founded when the result was read. */
  atMin: number;
  change: OneChange["kind"] | null;
  horse: string;
  tactic: string;
}

export interface ProbeStable {
  index: number;
  races: ProbeRace[];
  /** Chapter races run to win chapter 1's three (null: not done within the cap). */
  ch1Races: number | null;
  /** Minutes from founding to chapter 1 complete. */
  ch1Minutes: number | null;
  longestLosingStreak: number;
  /** Before chapter 1 was done: times every horse was tired or blocked, and the minutes waited. */
  waits: number;
  waitMinutes: number;
  /** Minutes spent at the races (to the off, the broadcast, the result) until chapter 1 was done. */
  racingMinutes: number;
  /** Chapter-1 races run on a tired horse (no rested one in the stable). */
  tiredStarts: number;
  /** Chapter 2 races run (after chapter 1) and their results. */
  ch2: ProbeRace[];
}

export interface ProbeOptions {
  startMs: number;
  /** Most chapter-1 races a stable plays before the probe gives up. */
  maxCh1Races?: number;
  /** Chapter 2 races to play after chapter 1. */
  ch2Races?: number;
  /** Which chapter race the player is pointed to: the first not yet won ("order"), or the best fit ("fit", the default). */
  suggest?: "order" | "fit";
  /** "wait" (the default): never run a tired horse, wait for one to rest; "race": run the game's own pick, tired or not, and wait only when every horse is blocked. */
  rest?: "wait" | "race";
}

/** The candidate order the Story screen uses (story.ts `candidates`): fit loss, ran today, tired. */
function ranked(rows: Awaited<ReturnType<typeof listStableHorses>>, silks: ReturnType<typeof parseSilks>, nowMs: number, c: { distanceM: number; surface: "turf" | "dirt" | "synthetic"; going: "firm" | "good" | "soft" | "heavy" }) {
  return rows
    .filter((r) => r.careerStatus === "racing" && !r.lockKind)
    .map((row) => ({ row, view: stableHorseView(row, silks, nowMs) }))
    // The entry also checks the stored injury date (it can lag the healing the stable view shows).
    .filter((x) => !x.view.block && !(x.row.injuredUntil && x.row.injuredUntil.getTime() > nowMs))
    .map(({ row, view }) => {
      const h = view.horse;
      const ideal = conditionRating(h, h.style, { distanceM: h.preferredDistanceM, surface: h.preferredSurface, going: "good" });
      const here = conditionRating(h, h.style, c);
      const loss = Math.max(0, ideal - here);
      const tired = view.condition === "tired";
      return { row, view, loss, tired, score: loss + view.ranToday * 15 + (tired ? 40 : 0) };
    })
    .sort((a, b) => a.score - b.score);
}

interface Pending {
  change: OneChange;
  horseId: string;
  freshId: string | null;
}

export async function probeStable(db: Db, index: number, o: ProbeOptions): Promise<ProbeStable> {
  const maxCh1 = o.maxCh1Races ?? 30;
  const ch2Target = o.ch2Races ?? 3;
  const rested = (o.rest ?? "wait") === "wait";
  const t0 = o.startMs;
  let now = t0;
  const acc = await foundStable(db, { stableName: `Probe Yard ${index}`, silks: { pattern: "hoops", primary: "#112233", secondary: "#c8a040", cap: "#112233" }, inviteCode: null, now: new Date(now) });
  const s = (await authenticate(db, acc.token))!;
  const silks = parseSilks(s.stable.silks);
  const out: ProbeStable = { index, races: [], ch1Races: null, ch1Minutes: null, longestLosingStreak: 0, waits: 0, waitMinutes: 0, racingMinutes: 0, tiredStarts: 0, ch2: [] };
  let caredDay = -1;
  /** Wilf's one change from the last loss, taken on the next chapter race. */
  let pending: Pending | null = null;
  const care = async () => {
    const day = gc.dayIndex(now);
    if (day === caredDay) return;
    caredDay = day;
    for (const r of (await listStableHorses(db, s.stable.id)).filter((x) => x.careerStatus !== "pasture")) {
      await careAction(db, s, r.id, {}, new Date(now)).catch(() => undefined);
    }
  };

  /** Reads a settled race as the result page does: position, the verdict's one change, the clock. */
  const read = async (raceId: string, n: number, horseId: string, tactic: RacePlan["tactic"], level: number): Promise<ProbeRace> => {
    const tap = now;
    const after = new Date(now + 15 * 60_000);
    const replay = await servedReplay(db, raceId, after);
    const card = await raceCard(db, raceId, after, s.stable.id);
    const mine = card.field.find((e) => e.horse.id === horseId)!;
    const rec = replay.result.finishOrder.find((f) => f.horseId === horseId)!;
    const rivals = card.field.filter((e) => e !== mine);
    const c = ((await getRace(db, raceId))!.conditions ?? {}) as { story?: { chapter?: string; raceKey?: string; strength?: number } };
    let change: OneChange["kind"] | null = null;
    if (rec.position !== 1) {
      const analysis = analyseRace(replay, horseId, mine.horse, tactic);
      if (analysis) {
        const tips = tryNext({
          analysis,
          horse: mine.horse,
          race: { distanceM: replay.race.distanceM, surface: replay.race.surface, going: replay.race.going },
          course: gc.courseByName(card.track ?? card.course?.name),
          gate: mine.gate,
          weightLb: null,
          fieldWeightsLb: [],
          atOff: null,
        });
        const rows = await listStableHorses(db, s.stable.id);
        const views = rows.filter((r) => r.careerStatus === "racing" && r.id !== horseId).map((r) => stableHorseView(r, silks, broadcastEndsAtMs(replay)));
        const fresh = views.filter((v) => !v.block && v.ranToday === 0 && v.condition !== "tired").sort((a, b) => b.horse.stats.speed + b.horse.stats.stamina - (a.horse.stats.speed + a.horse.stats.stamina))[0];
        const v = raceStory({ horseId, analysis, horse: mine.horse, replay, tips, yours: true, freshAlternative: fresh?.horse.name ?? null });
        change = v?.change?.kind ?? null;
        pending = v?.change ? { change: v.change, horseId, freshId: fresh?.id ?? null } : null;
      }
    } else pending = null;
    // The clock: to the off, the broadcast, reading the result.
    now = Math.max(now, broadcastEndsAtMs(replay)) + READ_MS;
    if (out.ch1Races === null) out.racingMinutes += (now - tap) / 60_000;
    return {
      n,
      raceKey: c.story?.raceKey ?? null,
      chapter: c.story?.chapter ?? "club",
      won: rec.position === 1,
      position: rec.position,
      field: replay.horses.length,
      strength: c.story?.strength ?? null,
      level,
      myMean: gc.meanStat(mine.horse),
      fieldMean: Math.round(rivals.reduce((a, e) => a + gc.meanStat(e.horse), 0) / Math.max(1, rivals.length)),
      atMin: Math.round((now - t0) / 60_000),
      change,
      horse: mine.horse.name,
      tactic,
    };
  };
  // 1. The first race from the starters screen: Quick Pick, an open Story race.
  await care();
  const levelOf = async (id: string) => gc.meanStat(stableHorseView((await listStableHorses(db, s.stable.id)).find((r) => r.id === id)!, silks, now).horse);
  const first = await createStoryRace(db, s, {}, new Date(now));
  out.races.push(await read(first.raceId, 0, first.horseId, first.pick!.tactic, await levelOf(first.horseId)));
  pending = null; // the first race's verdict points at open races; the player now goes to Story

  // 2. Chapter races.
  let streak = 0;
  let ch1Count = 0;
  let ch2Count = 0;
  for (let guard = 0; guard < maxCh1 + ch2Target + 40; guard++) {
    await care();
    const st = await storyState(db, s.accountId);
    const won = new Set(st.wonKeys);
    const chapterId = gc.currentChapter(st.licenceLevel, won);
    const chapter = gc.chapterDef(chapterId);
    if (chapterId !== "club" && ch2Count >= ch2Target) break;
    if (chapterId === "club" && ch1Count >= maxCh1) break;
    const unwon = chapter.races.filter((r) => !won.has(r.key));
    const rows = await listStableHorses(db, s.stable.id);
    // The suggested race: the first not yet won ("order", the Story screen before 2026-11-01), or
    // the one not yet won that suits a rested horse best ("fit", suggestedChapterRace).
    let race = o.suggest === "order" ? unwon[0]! : (suggestedChapterRace(rows, silks, now, unwon) ?? unwon[0]!);
    let horseId: string | null = null;
    let tactic: RacePlan["tactic"] | null = null;
    // Wilf's change after a loss (set inside read(): a closure TypeScript doesn't follow).
    const pend = pending as Pending | null;
    if (pend) {
      const c = pend.change;
      if (c.kind === "suited") {
        const pr = rows.find((r) => r.id === pend.horseId);
        if (pr) {
          race = suitedChapterRace(stableHorseView(pr, silks, now).horse, unwon);
          horseId = pr.id;
        }
      } else if (c.kind === "tactic") {
        horseId = pend.horseId;
        tactic = c.tactic ?? null;
      } else if (c.kind === "fresh_horse") {
        horseId = pend.freshId;
      } else horseId = pend.horseId;
      // The horse the change names must still be able to run: else the game's own pick.
      const ok = horseId ? ranked(rows, silks, now, race).find((x) => x.row.id === horseId) : undefined;
      if (!ok || (rested && ok.tired)) {
        horseId = null;
        tactic = null;
      }
    }
    if (!horseId) {
      const pick = ranked(rows, silks, now, race)[0];
      if (!pick || (rested && pick.tired)) {
        // Rest: every horse blocked (3 starts today), or ("wait") tired. Wait in 30-minute looks.
        const from = now;
        const ready = async () => {
          const p = ranked(await listStableHorses(db, s.stable.id), silks, now, race)[0];
          return !!p && !(rested && p.tired);
        };
        for (let k = 0; k < 96 && !(await ready()); k++) {
          now += HOUR / 2;
          await care();
        }
        if (out.ch1Races === null) {
          out.waits++;
          out.waitMinutes += Math.round((now - from) / 60_000);
        }
        pending = null;
        continue;
      }
      horseId = pick.row.id;
    }
    // A tired horse runs only when no rested one can (the game's own pick does the same).
    if (out.ch1Races === null && ranked(rows, silks, now, race).find((x) => x.row.id === horseId)?.tired) out.tiredStarts++;
    const row = rows.find((r) => r.id === horseId)!;
    const level = gc.meanStat(stableHorseView(row, silks, now).horse);
    const created = await createChapterRace(db, s, { raceKey: race.key, horseId, ...(tactic ? { plan: { tactic, intensity: "normal" } } : {}) }, new Date(now));
    const plan = tactic ?? stableHorseView(row, silks, now).horse.style;
    const n = chapterId === "club" ? ++ch1Count : ++ch2Count;
    const res = await read(created.raceId, n, horseId, plan, level);
    if (chapterId === "club") {
      out.races.push(res);
      streak = res.won ? 0 : streak + 1;
      out.longestLosingStreak = Math.max(out.longestLosingStreak, streak);
      const after = await storyState(db, s.accountId);
      if (out.ch1Races === null && after.licenceLevel >= 2) {
        out.ch1Races = ch1Count;
        out.ch1Minutes = res.atMin;
        pending = null;
      }
    } else out.ch2.push(res);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export function pct(xs: readonly number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
}

export interface ProbeSummary {
  stables: number;
  finished: number;
  ch1Median: number;
  ch1P90: number;
  streakMedian: number;
  streakP90: number;
  /** Win rate by chapter race number (1-based), with the number of stables that ran it. */
  byRace: { n: number; runs: number; winPct: number }[];
  /** Win rate of each chapter-1 race (key), all attempts. */
  byKey: Record<string, { runs: number; winPct: number }>;
  firstOpenWinPct: number;
  minutesMedian: number;
  minutesP90: number;
  /** Share of stables (%) that had to wait for a rested horse before finishing chapter 1, and the median wait. */
  waitsShare: number;
  waitMinutesMedian: number;
  racingMinutesMedian: number;
  tiredStartsMedian: number;
  ch2FirstWinPct: number;
  ch2WinPct: number;
}

export function summarise(rs: readonly ProbeStable[]): ProbeSummary {
  const done = rs.filter((r) => r.ch1Races !== null);
  // Unfinished stables count as the cap (they needed more than it).
  const need = rs.map((r) => r.ch1Races ?? 99);
  const byRace: ProbeSummary["byRace"] = [];
  for (let n = 1; n <= 20; n++) {
    const runs = rs.flatMap((r) => r.races.filter((x) => x.n === n));
    if (!runs.length) break;
    byRace.push({ n, runs: runs.length, winPct: Math.round((100 * runs.filter((x) => x.won).length) / runs.length) });
  }
  const byKey: ProbeSummary["byKey"] = {};
  for (const r of rs.flatMap((x) => x.races.filter((y) => y.raceKey))) {
    const k = (byKey[r.raceKey!] ??= { runs: 0, winPct: 0 });
    k.winPct = (k.winPct * k.runs + (r.won ? 100 : 0)) / (k.runs + 1);
    k.runs++;
  }
  for (const k of Object.values(byKey)) k.winPct = Math.round(k.winPct);
  const firsts = rs.map((r) => r.races.find((x) => x.n === 0)).filter(Boolean);
  const ch2First = rs.filter((r) => r.ch2.length).map((r) => r.ch2[0]!);
  const ch2All = rs.flatMap((r) => r.ch2);
  return {
    stables: rs.length,
    finished: done.length,
    ch1Median: pct(need, 50),
    ch1P90: pct(need, 90),
    streakMedian: pct(rs.map((r) => r.longestLosingStreak), 50),
    streakP90: pct(rs.map((r) => r.longestLosingStreak), 90),
    byRace,
    byKey,
    firstOpenWinPct: Math.round((100 * firsts.filter((x) => x!.won).length) / Math.max(1, firsts.length)),
    minutesMedian: pct(done.map((r) => r.ch1Minutes!), 50),
    minutesP90: pct(done.map((r) => r.ch1Minutes!), 90),
    waitsShare: Math.round((100 * rs.filter((r) => r.waits > 0).length) / rs.length),
    waitMinutesMedian: pct(rs.map((r) => r.waitMinutes), 50),
    racingMinutesMedian: Math.round(pct(done.map((r) => r.racingMinutes), 50)),
    tiredStartsMedian: pct(rs.map((r) => r.tiredStarts), 50),
    ch2FirstWinPct: Math.round((100 * ch2First.filter((x) => x.won).length) / Math.max(1, ch2First.length)),
    ch2WinPct: Math.round((100 * ch2All.filter((x) => x.won).length) / Math.max(1, ch2All.length)),
  };
}
