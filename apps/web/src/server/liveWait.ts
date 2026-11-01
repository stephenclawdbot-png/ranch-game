/**
 * The Live wait (first-hour follow-up, 2026-11-01): the time between entering a Live race and its
 * off, made shorter and busier. One read for the wait card (GET /api/races/live-wait):
 *
 *   - race: your entered race, with the other player stables entered so far (while entries are open);
 *   - soonest: not entered yet, the soonest open Live race a horse of yours can run and fits
 *     (game.ts chooseLiveRace, what "Enter your best fit" would enter), not just the next meeting;
 *   - watchNow: another Live race running now or going off within WATCH_SOON_MS: the normal live
 *     broadcast (no spoilers: the race page only ever shows frames up to the live edge);
 *   - actions: up to three things to do meanwhile, from the stable's own state, only when
 *     available (lib/whileYouWait.ts).
 *
 * Nothing here is about a result: post times, names and counts of entries only.
 */
import * as gc from "@thoroughbred/game-core";
import { RULES, careDayOf, lastCareDays, listCardRaces, listStableEntries, listStableHorses, storyState, type Db } from "@thoroughbred/db";
import { whileYouWaitActions, type WaitAction } from "@/lib/whileYouWait";
import { cupView } from "./competition";
import { chooseLiveRace } from "./game";
import { parseSilks, raceConds, stableHorseView } from "./horseView";
import type { Session } from "./session";
import { suggestedChapterRace } from "./story";

/** A Live race going off within this long counts as "about to go off" for "Watch one now". */
export const WATCH_SOON_MS = 10 * 60_000;
/** A Live race counts as running for this long after its post time (the longest broadcast, with the countdown). */
export const RUNNING_FOR_MS = 4 * 60_000;

export interface LiveWaitView {
  serverNowMs: number;
  race: { id: string; name: string; postTimeMs: number; entriesOpen: boolean; otherStables: number } | null;
  soonest: { raceId: string; raceName: string; postTimeMs: number; horseName: string; otherStables: number } | null;
  watchNow: { raceId: string; name: string; track: string; postTimeMs: number; running: boolean } | null;
  actions: WaitAction[];
}

export async function liveWaitView(db: Db, session: Session, raceId: string | null, now: Date): Promise<LiveWaitView> {
  const nowMs = now.getTime();
  const stableId = session.stable.id;
  const near = await listCardRaces(db, { from: new Date(nowMs - RUNNING_FOR_MS), to: new Date(nowMs + RULES.cardHorizonMs), stableId });
  const entered = (await listStableEntries(db, stableId)).filter(({ race }) => race.kind !== "quick" && race.postTime.getTime() > nowMs - RUNNING_FOR_MS);
  const mineId = raceId ?? entered[0]?.race.id ?? null;
  const mine = mineId ? near.find((r) => r.id === mineId) : undefined;
  const race = mine
    ? { id: mine.id, name: mine.name, postTimeMs: mine.postTime.getTime(), entriesOpen: mine.status === "open" && mine.entriesCloseAt.getTime() > nowMs, otherStables: Math.max(0, Number(mine.stables) - (Number(mine.mine) > 0 ? 1 : 0)) }
    : null;

  let soonest: LiveWaitView["soonest"] = null;
  if (!race || Number(mine?.mine ?? 0) === 0) {
    const pick = await chooseLiveRace(db, session, now).catch(() => null);
    if (pick) soonest = { raceId: pick.race.id, raceName: pick.race.name, postTimeMs: pick.race.postTime.getTime(), horseName: pick.horse.name, otherStables: pick.rivals };
  }

  // Another Live race to watch now: running, else the next to go off within WATCH_SOON_MS.
  // (Never your own race, nor the one suggested to enter: that one is the card's first line.)
  const others = near.filter((r) => r.id !== race?.id && r.id !== soonest?.raceId && r.status !== "cancelled" && Number(r.mine) === 0);
  const running = others.filter((r) => r.postTime.getTime() <= nowMs && r.postTime.getTime() + RUNNING_FOR_MS > nowMs && r.status !== "open").sort((a, b) => b.postTime.getTime() - a.postTime.getTime())[0];
  const soon = others.filter((r) => r.postTime.getTime() > nowMs && r.postTime.getTime() - nowMs <= WATCH_SOON_MS).sort((a, b) => a.postTime.getTime() - b.postTime.getTime())[0];
  const w = running ?? soon;
  const watchNow = w ? { raceId: w.id, name: w.name, track: raceConds(w).track ?? "", postTimeMs: w.postTime.getTime(), running: !!running } : null;

  return { serverNowMs: nowMs, race, soonest, watchNow, actions: await waitActions(db, session, now, new Set(entered.map((e) => e.entry.horseId))) };
}

/** The stable's facts for the while-you-wait list (each only when it can be done now). */
async function waitActions(db: Db, session: Session, now: Date, waitingHorses: ReadonlySet<string>): Promise<WaitAction[]> {
  const nowMs = now.getTime();
  const silks = parseSilks(session.stable.silks);
  const rows = (await listStableHorses(db, session.stable.id)).filter((r) => r.careerStatus !== "pasture");
  // Story: the suggested race of the current chapter, with a rested horse that isn't waiting for its Live race.
  const st = await storyState(db, session.accountId);
  const won = new Set(st.wonKeys);
  const chapterId = gc.currentChapter(st.licenceLevel, won);
  const chapter = gc.chapterDef(chapterId);
  const open = chapter.races.filter((r) => !won.has(r.key));
  const free = rows.filter((r) => !waitingHorses.has(r.id));
  const ready = free.filter((r) => {
    if (r.careerStatus !== "racing" || r.lockKind) return false;
    const v = stableHorseView(r, silks, nowMs);
    return !v.block && v.condition !== "tired";
  });
  const next = open.length ? (suggestedChapterRace(ready, silks, nowMs, open) ?? open[0]!) : null;
  const wins = chapter.races.length - open.length;
  const story = next ? { chapterShort: chapter.title.replace(/^The /, ""), wins, winsToComplete: chapter.winsToComplete, raceKey: next.key, horseReady: ready.length > 0 } : null;
  // Care: horses not yet cared for today (the stable's local day).
  const day = await careDayOf(db, session.accountId, now);
  const last = await lastCareDays(db, rows.map((r) => r.id));
  const due = rows.filter((r) => !((last.get(r.id) ?? "") >= day));
  const care = due[0] ? { horseName: due[0].name, href: `/horse/${due[0].id}/care`, due: due.length } : null;
  // The Daily Cup: one run a day, with a horse that can run it.
  const cup = await cupView(db, session, now).catch(() => null);
  const cupRunsLeft = cup && !cup.mine && cup.horses?.some((h) => h.block === null) ? 1 : 0;
  const quickRace = rows.some((r) => r.careerStatus === "racing" && r.careSessions >= RULES.careToRacing);
  return whileYouWaitActions({ story, care, cupRunsLeft, quickRace });
}
