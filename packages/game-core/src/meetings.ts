/**
 * Race meetings: when the Live card runs.
 *
 * The card keeps its 15-minute slot grid (SLOT_INTERVAL_MS: slot indices, slot keys, replays
 * and idempotency are unchanged), but only the slots inside a meeting carry ordinary Live
 * races: three meetings a day of eight races, 15 minutes apart. 24 Live races a day instead of
 * 96, so the same player starts fill fields instead of spreading over empty races (season
 * harness goals45: 40% of races had any player runner; docs/reports/2026-10-30 empty races
 * meeting.md).
 *
 * Calendar races (Feature Qualifiers Mon-Fri 19:00 UTC, the Weekend Feature Sat 19:00, the
 * Saturday Plate 30 minutes later, the four Season Finals from 18:00 on the season's last day)
 * keep their times and sit inside the evening meeting: on the season's last day the evening
 * meeting opens at FINALS_DAY_EVENING_START_UTC so all four championships are part of it.
 *
 * Pure and deterministic: times are passed in (ms since the Unix epoch, UTC), nothing reads a
 * clock.
 */
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, SEASON_DAYS, type SeasonClock } from "./time";
import { SLOT_INTERVAL_MS } from "./seasons";

/** Start of each day's meetings, "HH:MM" UTC, in order. Each must sit on the 15-minute slot grid. */
export const MEETING_START_TIMES_UTC = ["07:00", "13:00", "19:00"] as const;
/** Live races in one meeting. */
export const RACES_PER_MEETING = 8;
/** Time between two races of a meeting: one card slot (15 minutes). */
export const MEETING_RACE_SPACING_MS = SLOT_INTERVAL_MS;
/** Meetings a day. */
export const MEETINGS_PER_DAY = MEETING_START_TIMES_UTC.length;
/** Ordinary Live races a day (calendar races take some of these places). */
export const LIVE_RACES_PER_DAY = MEETINGS_PER_DAY * RACES_PER_MEETING;
/**
 * The season's last day: the evening meeting opens an hour early so the four Season Finals
 * (18:00, 18:30, 19:00, 19:30 UTC) all run inside it.
 */
export const FINALS_DAY_EVENING_START_UTC = "18:00";
/**
 * How far ahead the Live card is published (entries open at publication): a day, so a player
 * who visits once a day can enter any meeting before their next visit (a 10:00 visit reaches
 * the 19:00 meeting). Calendar races publish on the same horizon.
 */
export const CARD_HORIZON_MS = 24 * MS_PER_HOUR;

/** "HH:MM" → minutes after midnight. */
function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

const START_MS: readonly number[] = MEETING_START_TIMES_UTC.map((t) => minutesOf(t) * MS_PER_MINUTE);
const FINALS_EVENING_MS = minutesOf(FINALS_DAY_EVENING_START_UTC) * MS_PER_MINUTE;
const MEETING_SPAN_MS = (RACES_PER_MEETING - 1) * MEETING_RACE_SPACING_MS;

const floorDiv = (a: number, b: number) => Math.floor(a / b);
const dayStartOf = (ms: number) => floorDiv(ms, MS_PER_DAY) * MS_PER_DAY;

/** True on the last day of a competition season (the Season Finals' day). */
function isFinalsDay(clock: SeasonClock, dayStartMs: number): boolean {
  const day = floorDiv(dayStartMs - clock.epochMs, MS_PER_DAY);
  return ((day % SEASON_DAYS) + SEASON_DAYS) % SEASON_DAYS === SEASON_DAYS - 1;
}

/** Start offsets (ms after UTC midnight) of a day's meetings. */
export function meetingStartsOn(clock: SeasonClock, dayStartMs: number): number[] {
  const out = [...START_MS];
  if (isFinalsDay(clock, dayStartMs)) out[out.length - 1] = FINALS_EVENING_MS;
  return out;
}

export interface Meeting {
  /** Global meeting number (days since the Unix epoch × MEETINGS_PER_DAY + meeting of the day). */
  number: number;
  /** 0 = first meeting of the UTC day. */
  ofDay: number;
  /** Post time of the first race (ms). */
  startMs: number;
  /** Post time of the last race (ms). */
  lastPostMs: number;
}

export interface MeetingRace extends Meeting {
  /** Race of the meeting, 0..RACES_PER_MEETING-1. */
  race: number;
}

function meetingAt(clock: SeasonClock, dayStartMs: number, ofDay: number): Meeting {
  const startMs = dayStartMs + meetingStartsOn(clock, dayStartMs)[ofDay]!;
  return { number: floorDiv(dayStartMs, MS_PER_DAY) * MEETINGS_PER_DAY + ofDay, ofDay, startMs, lastPostMs: startMs + MEETING_SPAN_MS };
}

/** The meeting race going off at `postTimeMs`, or null when no meeting race runs then. */
export function meetingRaceAt(clock: SeasonClock, postTimeMs: number): MeetingRace | null {
  const dayStartMs = dayStartOf(postTimeMs);
  const starts = meetingStartsOn(clock, dayStartMs);
  for (let ofDay = 0; ofDay < starts.length; ofDay++) {
    const off = postTimeMs - dayStartMs - starts[ofDay]!;
    if (off < 0 || off > MEETING_SPAN_MS || off % MEETING_RACE_SPACING_MS !== 0) continue;
    return { ...meetingAt(clock, dayStartMs, ofDay), race: off / MEETING_RACE_SPACING_MS };
  }
  return null;
}

/** Meetings whose first race goes off in [fromMs, toMs), in order. */
export function meetingsBetween(clock: SeasonClock, fromMs: number, toMs: number): Meeting[] {
  const out: Meeting[] = [];
  for (let day = dayStartOf(fromMs) - MS_PER_DAY; day < toMs; day += MS_PER_DAY) {
    for (let i = 0; i < MEETINGS_PER_DAY; i++) {
      const m = meetingAt(clock, day, i);
      if (m.startMs >= fromMs && m.startMs < toMs) out.push(m);
    }
  }
  return out;
}

/** The meeting a post time belongs to: the one running then, else the next to start. */
export function meetingFor(clock: SeasonClock, postTimeMs: number): Meeting {
  const running = meetingRaceAt(clock, postTimeMs);
  if (running) return running;
  const day = dayStartOf(postTimeMs);
  for (let d = day - MS_PER_DAY; ; d += MS_PER_DAY) {
    for (let i = 0; i < MEETINGS_PER_DAY; i++) {
      const m = meetingAt(clock, d, i);
      if (m.lastPostMs >= postTimeMs) return m;
    }
  }
}

/**
 * When the `n`-th meeting from `nowMs` finishes (post time of its last race). n = 1 is the
 * meeting running now, or the next one. Used by "look at the next meeting" helpers.
 */
export function nthMeetingEndMs(clock: SeasonClock, nowMs: number, n: number): number {
  let m = meetingFor(clock, nowMs);
  for (let i = 1; i < n; i++) m = meetingFor(clock, m.lastPostMs + 1);
  return m.lastPostMs;
}
