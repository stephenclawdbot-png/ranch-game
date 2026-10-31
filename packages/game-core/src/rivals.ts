/**
 * Rivals and head-to-head records (experience review item 5). Builds on social.ts: a close
 * finish is two runners within RIVAL_MARGIN_MM (a length) of each other at the line.
 *
 *   - a rival stable: one your horses keep meeting in Live races and finishing close to; ranked
 *     by close finishes, then meetings, then the most recent, over RIVAL_WINDOW_DAYS;
 *   - your nemesis: the other stable's horse that has beaten yours in close finishes most often
 *     (at least NEMESIS_MIN_BEATS times);
 *   - head-to-head: per stable pair and per horse pair, meetings, who finished ahead, close
 *     finishes, and the last meeting.
 *
 * Pure: the database supplies settled races whose result is already public; Club runners
 * (no owner) are never anyone's rival.
 */
import { RIVAL_MARGIN_MM, RIVAL_MIN_CLOSE } from "./social";

/** Rivals are ranked over this many days of Live races. */
export const RIVAL_WINDOW_DAYS = 28;
/** A horse needs this many close-finish wins over yours to be your nemesis. */
export const NEMESIS_MIN_BEATS = 2;
/** The Rivals panel lists this many stables. */
export const RIVALS_SHOWN = 3;

export interface MeetingRunner {
  horseId: string;
  horseName: string;
  /** Null for a Club runner. */
  stableId: string | null;
  stableName: string;
  position: number;
  /** Distance behind the horse directly ahead, mm (0 for the winner). */
  marginMm: number;
}

export interface RaceMeeting {
  raceId: string;
  raceName: string;
  atMs: number;
  runners: MeetingRunner[];
}

export interface H2HRecord {
  meetings: number;
  /** Meetings where the first side finished ahead. */
  ahead: number;
  /** Meetings where the second side finished ahead. */
  behind: number;
  /** Meetings where the two finished within a length of each other. */
  close: number;
  /** Close finishes the first side came out on top of. */
  closeAhead: number;
  last: { raceId: string; raceName: string; atMs: number; ahead: boolean } | null;
}

export interface StableH2H extends H2HRecord {
  stableId: string;
  stableName: string;
}

export interface HorseH2H extends H2HRecord {
  mineId: string;
  mineName: string;
  theirId: string;
  theirName: string;
  theirStableId: string;
  theirStableName: string;
}

const empty = (): H2HRecord => ({ meetings: 0, ahead: 0, behind: 0, close: 0, closeAhead: 0, last: null });

/** Distance behind the winner at the line, mm, by horse (margins add up down the order). */
export function distancesBehind(runners: readonly Pick<MeetingRunner, "horseId" | "position" | "marginMm">[]): Map<string, number> {
  const sorted = [...runners].sort((a, b) => a.position - b.position);
  const out = new Map<string, number>();
  let d = 0;
  for (const [i, r] of sorted.entries()) {
    if (i > 0) d += Math.max(0, r.marginMm);
    out.set(r.horseId, d);
  }
  return out;
}

function note(rec: H2HRecord, m: RaceMeeting, ahead: boolean, close: boolean): void {
  rec.meetings++;
  if (ahead) rec.ahead++;
  else rec.behind++;
  if (close) {
    rec.close++;
    if (ahead) rec.closeAhead++;
  }
  if (!rec.last || m.atMs >= rec.last.atMs) rec.last = { raceId: m.raceId, raceName: m.raceName, atMs: m.atMs, ahead };
}

/**
 * Stable-vs-stable records for `mine` against every other owner it met: in each race, its best
 * finisher against theirs. Close = those two within a length.
 */
export function stableHeadToHead(meetings: readonly RaceMeeting[], mine: string): StableH2H[] {
  const by = new Map<string, StableH2H>();
  for (const m of meetings) {
    const dist = distancesBehind(m.runners);
    const best = new Map<string, MeetingRunner>();
    for (const r of m.runners) {
      if (!r.stableId) continue;
      const cur = best.get(r.stableId);
      if (!cur || r.position < cur.position) best.set(r.stableId, r);
    }
    const me = best.get(mine);
    if (!me) continue;
    for (const [sid, them] of best) {
      if (sid === mine) continue;
      const rec = by.get(sid) ?? { stableId: sid, stableName: them.stableName, ...empty() };
      const close = Math.abs((dist.get(me.horseId) ?? 0) - (dist.get(them.horseId) ?? 0)) <= RIVAL_MARGIN_MM;
      note(rec, m, me.position < them.position, close);
      by.set(sid, rec);
    }
  }
  return [...by.values()];
}

/** Horse-vs-horse records: each of `mine`'s horses against each owned horse of another stable it met. */
export function horseHeadToHead(meetings: readonly RaceMeeting[], mine: string): HorseH2H[] {
  const by = new Map<string, HorseH2H>();
  for (const m of meetings) {
    const dist = distancesBehind(m.runners);
    const ours = m.runners.filter((r) => r.stableId === mine);
    const theirs = m.runners.filter((r) => r.stableId && r.stableId !== mine);
    for (const a of ours) {
      for (const b of theirs) {
        const key = `${a.horseId}|${b.horseId}`;
        const rec = by.get(key) ?? { mineId: a.horseId, mineName: a.horseName, theirId: b.horseId, theirName: b.horseName, theirStableId: b.stableId!, theirStableName: b.stableName, ...empty() };
        const close = Math.abs((dist.get(a.horseId) ?? 0) - (dist.get(b.horseId) ?? 0)) <= RIVAL_MARGIN_MM;
        note(rec, m, a.position < b.position, close);
        by.set(key, rec);
      }
    }
  }
  return [...by.values()];
}

/** Rival stables: at least RIVAL_MIN_CLOSE close finishes; most close finishes, then meetings, then the latest first. */
export function rankRivals(records: readonly StableH2H[]): StableH2H[] {
  return records
    .filter((r) => r.close >= RIVAL_MIN_CLOSE)
    .sort((a, b) => b.close - a.close || b.meetings - a.meetings || (b.last?.atMs ?? 0) - (a.last?.atMs ?? 0) || (a.stableId < b.stableId ? -1 : 1));
}

export interface Nemesis {
  horseId: string;
  horseName: string;
  stableId: string;
  stableName: string;
  /** Close finishes it won against your horses. */
  closeBeats: number;
  meetings: number;
}

/** The other stables' horse that has beaten yours in close finishes most often (null below NEMESIS_MIN_BEATS). */
export function findNemesis(pairs: readonly HorseH2H[]): Nemesis | null {
  const by = new Map<string, Nemesis & { lastMs: number }>();
  for (const p of pairs) {
    const cur = by.get(p.theirId) ?? { horseId: p.theirId, horseName: p.theirName, stableId: p.theirStableId, stableName: p.theirStableName, closeBeats: 0, meetings: 0, lastMs: 0 };
    cur.closeBeats += p.close - p.closeAhead;
    cur.meetings += p.meetings;
    cur.lastMs = Math.max(cur.lastMs, p.last?.atMs ?? 0);
    by.set(p.theirId, cur);
  }
  const best = [...by.values()]
    .filter((n) => n.closeBeats >= NEMESIS_MIN_BEATS)
    .sort((a, b) => b.closeBeats - a.closeBeats || b.meetings - a.meetings || b.lastMs - a.lastMs || (a.horseId < b.horseId ? -1 : 1))[0];
  if (!best) return null;
  const { lastMs: _lastMs, ...n } = best;
  return n;
}

/**
 * Post-race lines for `mine` in race `raceId` (shown with the result, never before): a first
 * win over a horse after losing every earlier meeting, a nemesis beaten or winning again, and
 * the record against a rival stable. `history` = every meeting up to and including this race.
 */
export function raceRivalLines(history: readonly RaceMeeting[], raceId: string, mine: string, opts: { rivalIds?: ReadonlySet<string>; nemesisId?: string | null } = {}): string[] {
  const race = history.find((m) => m.raceId === raceId);
  if (!race) return [];
  const before = history.filter((m) => m.raceId !== raceId && m.atMs <= race.atMs);
  const prior = new Map(horseHeadToHead(before, mine).map((p) => [`${p.mineId}|${p.theirId}`, p]));
  const out: string[] = [];
  for (const now of horseHeadToHead([race], mine)) {
    const p = prior.get(`${now.mineId}|${now.theirId}`);
    const won = now.ahead === 1;
    const meetings = (p?.meetings ?? 0) + 1;
    if (won && p && p.ahead === 0 && p.meetings >= 1) {
      out.push(`You beat ${possessive(now.theirStableName)} ${now.theirName} for the first time in ${meetings} meetings.`);
    } else if (opts.nemesisId === now.theirId) {
      out.push(won ? `${now.mineName} got the better of your nemesis ${now.theirName}.` : `Your nemesis ${now.theirName} finished ahead of ${now.mineName} again.`);
    }
  }
  for (const s of stableHeadToHead([race], mine)) {
    if (!opts.rivalIds?.has(s.stableId)) continue;
    const all = stableHeadToHead([...before, race], mine).find((x) => x.stableId === s.stableId)!;
    const score = all.ahead > all.behind ? `You lead ${all.ahead}–${all.behind}.` : all.ahead < all.behind ? `They lead ${all.behind}–${all.ahead}.` : `All square at ${all.ahead}–${all.behind}.`;
    out.push(`Against your rivals ${s.stableName}: ${s.ahead ? "you came out ahead" : "they came out ahead"}${s.close ? " in a close finish" : ""}. ${score}`);
  }
  return [...new Set(out)];
}

/** "Thistle Mead's", "the Brooks'" */
export function possessive(name: string): string {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}
