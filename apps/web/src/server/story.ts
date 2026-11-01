/**
 * Story mode screens and chapter races (§4e). Chapters, rival stables and licences are
 * game-core (`story.ts`); progress is in the database (`storyState`); a chapter race is a
 * solo race run through game.ts `runSoloRace` (created, simulated and settled at once, with
 * the capped Story reward and the chapter progress paid at settlement, see storyField.ts).
 */
import * as gc from "@thoroughbred/game-core";
import { DomainError, listStableHorses, listStableRuns, storyChapterEarnings, storyRaceFinishes, storyState, type Db, type HorseRow } from "@thoroughbred/db";
import { conditionRating, lossGrade } from "@/lib/aptitude";
import type { ChapterView, RivalStableView, StoryRaceCreated, StoryRaceView, StoryView } from "@/lib/competitionTypes";
import type { RacePlan } from "@/lib/types";
import { runSoloRace } from "./game";
import { parseSilks, stableHorseView } from "./horseView";
import type { Session } from "./session";
import { storyMetaOf } from "./storyField";

/** Longest Story broadcast (start delay + race + margin): results show on /story after it. */
const RUNNING_MS = 4 * 60_000;

type Conds = { distanceM: number; surface: "turf" | "dirt" | "synthetic"; going: "firm" | "good" | "soft" | "heavy" };

interface Candidate {
  row: HorseRow;
  name: string;
  style: RacePlan["tactic"];
  loss: number;
  ranToday: number;
  tired: boolean;
}

/** The stable's horses that can race now, with their fit for some conditions (best first). */
function candidates(rows: HorseRow[], silks: ReturnType<typeof parseSilks>, nowMs: number, c: Conds): Candidate[] {
  return rows
    .filter((r) => r.careerStatus === "racing" && !r.lockKind)
    .map((row) => ({ row, view: stableHorseView(row, silks, nowMs) }))
    .filter((x) => !x.view.block)
    .map(({ row, view }) => {
      const h = view.horse;
      const ideal = conditionRating(h, h.style, { distanceM: h.preferredDistanceM, surface: h.preferredSurface, going: "good" });
      const here = conditionRating(h, h.style, c);
      return { row, name: h.name, style: h.style, loss: Math.max(0, ideal - here), ranToday: view.ranToday, tired: view.condition === "tired" };
    })
    .sort((a, b) => a.loss + a.ranToday * 15 + (a.tired ? 40 : 0) - (b.loss + b.ranToday * 15 + (b.tired ? 40 : 0)));
}

const score = (c: Candidate) => c.loss + c.ranToday * 15 + (c.tired ? 40 : 0);

/**
 * The chapter race to suggest next (Home, the Story screen, the result page): of the races not
 * yet won, the one a horse that can race now suits best (its fit, rested first), the chapter's
 * order breaking ties. Null when no horse can race.
 */
export function suggestedChapterRace<R extends gc.StoryRaceDef>(rows: HorseRow[], silks: ReturnType<typeof parseSilks>, nowMs: number, races: readonly R[]): R | null {
  let best: { race: R; s: number } | null = null;
  // The chapter's last race (its Championship) is the climax: suggested only once it's the last one left.
  const pool = races.length > 1 ? races.filter((r) => r.order !== gc.chapterDef(r.chapter).races.length) : races;
  for (const race of pool) {
    const c = candidates(rows, silks, nowMs, race)[0];
    if (c && (!best || score(c) < best.s)) best = { race, s: score(c) };
  }
  return best?.race ?? null;
}

/** "Try again at a race that suits" on a chapter race: the race not yet won that suits this horse best (the chapter's order breaks ties). */
export function suitedChapterRace<R extends Pick<gc.StoryRaceDef, "distanceM" | "surface" | "going">>(horse: Parameters<typeof conditionRating>[0], races: readonly R[]): R {
  const ideal = conditionRating(horse, horse.style, { distanceM: horse.preferredDistanceM, surface: horse.preferredSurface, going: "good" });
  let best = races[0]!;
  let bestLoss = Infinity;
  for (const r of races) {
    const loss = Math.max(0, ideal - conditionRating(horse, horse.style, r));
    if (loss < bestLoss) [best, bestLoss] = [r, loss];
  }
  return best;
}

export async function storyView(db: Db, session: Session | null, now: Date): Promise<StoryView> {
  const nowMs = now.getTime();
  const st = session ? await storyState(db, session.accountId) : { licenceLevel: 1, wonKeys: [] };
  const won = new Set(st.wonKeys);
  const progress = gc.storyProgress(st.licenceLevel, won);
  const current = gc.currentChapter(st.licenceLevel, won);
  const earnings = session ? await storyChapterEarnings(db, session.accountId) : {};
  const silks = parseSilks(session?.stable.silks);
  const rows = session ? await listStableHorses(db, session.stable.id) : [];

  const chapters: ChapterView[] = progress.map((p) => {
    const c = p.chapter;
    const races: StoryRaceView[] = c.races.map((r) => {
      const best = session ? candidates(rows, silks, nowMs, r)[0] : undefined;
      return {
        key: r.key,
        order: r.order,
        name: r.name,
        track: r.track,
        distanceM: r.distanceM,
        surface: r.surface,
        going: r.going,
        weather: r.weather,
        raceClass: r.raceClass,
        fieldSize: r.fieldSize,
        rivals: r.rivals,
        intro: r.intro,
        win: r.win,
        loss: r.loss,
        won: won.has(r.key),
        firstWinReward: gc.STORY_FIRST_WIN_REWARD[c.id],
        bestHorse: best ? { id: best.row.id, name: best.name, grade: lossGrade(best.loss), loss: best.loss } : null,
      };
    });
    const earnedLicence = gc.licenceDef(c.licenceEarned);
    return {
      id: c.id,
      number: c.number,
      title: c.title,
      tagline: c.tagline,
      intro: c.intro,
      outro: c.outro,
      winsToComplete: c.winsToComplete,
      wins: p.won.length,
      unlocked: p.unlocked,
      complete: p.complete,
      current: c.id === current,
      licenceRequired: { level: c.licenceRequired, name: gc.licenceDef(c.licenceRequired).name },
      licenceEarned: { level: earnedLicence.level, name: earnedLicence.name, unlocks: earnedLicence.unlocks },
      earned: earnings[c.id] ?? 0,
      cap: gc.STORY_CHAPTER_CAP[c.id],
      races,
    };
  });

  // Rival head-to-heads from the stable's Story races: ahead of every runner of theirs, or not.
  const record = new Map<string, { ahead: number; behind: number }>();
  const met = new Set<string>();
  const recent: StoryView["recent"] = [];
  if (session) {
    const finishes = await storyRaceFinishes(db, session.stable.id);
    const byRace = new Map<string, typeof finishes>();
    for (const f of finishes) byRace.set(f.raceId, [...(byRace.get(f.raceId) ?? []), f]);
    for (const fs of byRace.values()) {
      const meta = storyMetaOf({ kind: "quick", conditions: fs[0]!.conditions as never });
      const mine = fs.filter((f) => f.stableId === session.stable.id);
      if (!meta || !mine.length) continue;
      const myBest = Math.min(...mine.map((f) => f.position));
      const theirs = new Map<string, number>();
      for (const f of fs) {
        if (f.stableId) continue;
        const rival = gc.rivalFor(meta.rivals, f.horseId);
        if (rival) theirs.set(rival.id, Math.min(theirs.get(rival.id) ?? 99, f.position));
      }
      for (const [id, pos] of theirs) {
        met.add(id);
        const r = record.get(id) ?? { ahead: 0, behind: 0 };
        if (myBest < pos) r.ahead++;
        else r.behind++;
        record.set(id, r);
      }
    }
    const names = new Map(rows.map((r) => [r.id, r.name]));
    for (const run of (await listStableRuns(db, session.stable.id, 40)).filter((r) => r.kind === "quick").slice(0, 8)) {
      const meta = storyMetaOf({ kind: "quick", conditions: run.conditions });
      // A watched race still running: its result stays off this page until the broadcast is over.
      const running = run.postTime.getTime() + RUNNING_MS > nowMs;
      recent.push({ raceId: run.raceId, name: run.raceName, raceKey: meta?.raceKey ?? null, position: running ? 0 : (run.position ?? 0), fieldSize: Number(run.fieldSize), postTimeMs: run.postTime.getTime(), horseName: names.get(run.horseId) ?? "Your horse" });
    }
  }
  const unlockedChapters = new Set(progress.filter((p) => p.unlocked).map((p) => p.chapter.id));
  const rivals: RivalStableView[] = gc.RIVAL_STABLES.filter((r) => unlockedChapters.has(r.debut) || met.has(r.id)).map((r) => ({
    id: r.id,
    name: r.name,
    trainer: r.trainer,
    personality: r.personality,
    bio: r.bio,
    greeting: r.greeting,
    silks: r.silks,
    style: r.style,
    debut: r.debut,
    met: met.has(r.id),
    record: record.get(r.id) ?? { ahead: 0, behind: 0 },
  }));
  const licence = gc.licenceDef(st.licenceLevel);
  const open = gc.chapterDef(current).races.filter((r) => !won.has(r.key));
  return {
    licence: { level: licence.level, name: licence.name, unlocks: gc.LICENCES.filter((l) => l.level <= st.licenceLevel).map((l) => l.unlocks) },
    current,
    suggested: (session ? suggestedChapterRace(rows, silks, nowMs, open)?.key : undefined) ?? open[0]?.key ?? null,
    chapters,
    rivals,
    recent,
  };
}

/** The stable's settled chapter-race results in one chapter, newest first (true = won). */
export async function chapterResults(db: Db, stableId: string, chapter: gc.StoryChapter): Promise<boolean[]> {
  const out: boolean[] = [];
  for (const run of await listStableRuns(db, stableId, 60)) {
    if (run.kind !== "quick") continue;
    const meta = storyMetaOf({ kind: "quick", conditions: run.conditions });
    if (!meta?.raceKey || gc.storyRaceByKey(meta.raceKey)?.chapter !== chapter) continue;
    out.push(run.position === 1);
  }
  return out;
}

/**
 * After a chapter race, "Try again" stays in the chapter: the same race while it isn't won yet,
 * else the suggested one; "at a race that suits" (suited, with the horse): the race not yet won that
 * suits that horse best. When the result completed the chapter, the next chapter's suggestion.
 */
export async function followUpChapterRace(db: Db, session: Session, fromKey: string, opts: { horseId?: string; suited?: boolean }, now: Date): Promise<string> {
  const st = await storyState(db, session.accountId);
  const won = new Set(st.wonKeys);
  const chapter = gc.currentChapter(st.licenceLevel, won);
  const open = gc.chapterDef(chapter).races.filter((r) => !won.has(r.key));
  if (!open.length) return fromKey;
  const rows = await listStableHorses(db, session.stable.id);
  const silks = parseSilks(session.stable.silks);
  const row = opts.horseId ? rows.find((r) => r.id === opts.horseId) : undefined;
  if (opts.suited && row) return suitedChapterRace(stableHorseView(row, silks, now.getTime()).horse, open).key;
  if (open.some((r) => r.key === fromKey)) return fromKey;
  return (suggestedChapterRace(rows, silks, now.getTime(), open) ?? open[0]!).key;
}

export interface ChapterRaceRequest {
  raceKey: string;
  /** Omit for Quick Pick: the best-suited fresh horse for this race. */
  horseId?: string;
  plan?: RacePlan;
  instant?: boolean;
}

/** Runs a chapter race (solo, free, settled at once). The chapter must be unlocked. */
export async function createChapterRace(db: Db, session: Session, req: ChapterRaceRequest, now: Date): Promise<StoryRaceCreated> {
  const def = gc.storyRaceByKey(req.raceKey);
  if (!def) throw new DomainError("NOT_FOUND", "no such story race");
  const st = await storyState(db, session.accountId);
  const chapter = gc.chapterDef(def.chapter);
  if (st.licenceLevel < chapter.licenceRequired) throw new DomainError("NOT_ELIGIBLE", `${chapter.title} needs a ${gc.licenceDef(chapter.licenceRequired).name}: win three races of the previous chapter`);
  const nowMs = now.getTime();
  const silks = parseSilks(session.stable.silks);
  const rows = await listStableHorses(db, session.stable.id);
  let row: HorseRow | undefined;
  let pick: StoryRaceCreated["pick"];
  if (req.horseId) {
    row = rows.find((r) => r.id === req.horseId);
    if (!row) throw new DomainError("NOT_OWNER", "that horse isn't in your stable");
  } else {
    const best = candidates(rows, silks, nowMs, def)[0];
    if (!best) throw new DomainError("NOT_ELIGIBLE", "none of your horses can race right now");
    row = best.row;
    pick = { horseId: row.id, horseName: best.name, reason: `${best.name}: ${best.loss <= 25 ? "a good fit" : "your best fit"} for ${def.distanceM.toLocaleString("en-GB")} m on ${def.surface}` };
  }
  const view = stableHorseView(row, silks, nowMs);
  if (view.block) throw new DomainError("NOT_ELIGIBLE", view.block);
  const plan: RacePlan = req.plan ?? { tactic: view.horse.style, intensity: "normal" };
  // The field (we choose the field, never the result): from this runner's own level and the
  // stable's run of results in this chapter, fixed now and stored with the race.
  const level = gc.meanStat(view.horse);
  const field = gc.storyField({ race: def, runnerLevel: level, recent: await chapterResults(db, session.stable.id, def.chapter) });
  const created = await runSoloRace(
    db,
    session,
    row,
    plan,
    {
      name: def.name,
      raceClass: def.raceClass,
      conditions: {
        distanceM: def.distanceM,
        surface: def.surface,
        going: def.going,
        weather: def.weather,
        track: def.track,
        story: { chapter: def.chapter, rivals: def.rivals, raceKey: def.key, strength: field.strength, field: { level, base: field.base, adjust: field.adjust, note: field.note } },
      },
      targetRunners: def.fieldSize,
    },
    !!req.instant,
    now,
  );
  return { ...created, horseId: row.id, raceKey: def.key, pick };
}
