/**
 * Race meetings: when the Live card runs.
 *
 * The card keeps its 15-minute slot grid (SLOT_INTERVAL_MS: slot indices, slot keys, replays
 * and idempotency are unchanged), but only the slots inside a meeting carry ordinary Live
 * races. Two knobs set the schedule: MEETING_START_TIMES_UTC (in order through the UTC day) and
 * RACES_PER_MEETING (15 minutes apart). Everything else (races a day, the wait between meetings,
 * the calendar meeting, the Finals meeting, the card's class pattern, the claiming race, the
 * copy) is derived from them. Since 2026-11-01 (owner): eight meetings a day, one every three
 * hours, of four races: 32 Live races a day, and a new player's wait for the next meeting is at
 * most about two and a quarter hours at any hour, in any time zone. Before: three meetings of
 * eight races (24 a day, waits up to 10 h overnight), and before that 96 races a day, most of
 * them empty (season harness goals45, docs/reports/2026-10-30 empty races meeting.md). The tests
 * run the invariants over other schedules too, so the knobs can move again; the admin metric
 * "Real players per Live race" says which way.
 *
 * Calendar races keep their times and sit inside the 19:00 UTC meeting (the calendar meeting):
 * the Feature Qualifiers (Mon-Fri 19:00) and the Weekend Feature (Sat 19:00) are its first race,
 * the Saturday Plate (30 minutes later) its third. On the season's last day that meeting is the
 * Finals meeting: it opens an hour early, at FINALS_MEETING_START_UTC (18:00), and runs the four
 * Season Finals 30 minutes apart (18:00, 18:30, 19:00, 19:30) with the meeting's own races in
 * between and after them (18:15, 18:45, 19:15, 19:45 with four races a meeting), so the card
 * keeps every race of its class pattern (no Maiden or Novice trip drops out that day), 15 minutes
 * apart as always, clear of the meetings before and after it.
 *
 * Pure and deterministic: times are passed in (ms since the Unix epoch, UTC), nothing reads a
 * clock.
 */
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, SEASON_DAYS, type SeasonClock } from "./time";
import { SLOT_INTERVAL_MS } from "./seasons";

export interface MeetingSchedule {
  /** Start of each day's meetings, "HH:MM" UTC, in order through the UTC day, on the slot grid. */
  startTimesUtc: readonly string[];
  /** Live races in one meeting, one card slot (15 minutes) apart. */
  racesPerMeeting: number;
}

/** Start of each day's meetings, "HH:MM" UTC, in order: one every three hours. Knob 1 of 2. */
export const MEETING_START_TIMES_UTC: readonly string[] = ["01:00", "04:00", "07:00", "10:00", "13:00", "16:00", "19:00", "22:00"];
/** Live races in one meeting. Knob 2 of 2. */
export const RACES_PER_MEETING: number = 4;

/** Time between two races of a meeting: one card slot (15 minutes). */
export const MEETING_RACE_SPACING_MS = SLOT_INTERVAL_MS;
/** Start of the meeting that carries the calendar races (Qualifiers, the Weekend Feature, the Plate). */
export const CALENDAR_MEETING_START_UTC = "19:00";
/**
 * The season's last day: the calendar meeting becomes the Finals meeting, opening at 18:00 with
 * the four Season Finals (18:00, 18:30, 19:00, 19:30 UTC), its own races in between and after.
 */
export const FINALS_MEETING_START_UTC = "18:00";
/** Season Finals in the Finals meeting (one per division). */
export const FINALS_MEETING_RACES = 4;
/** Time between two Season Finals: two card slots (30 minutes); the meeting's own races go in between. */
export const FINALS_MEETING_SPACING_MS = 2 * SLOT_INTERVAL_MS;
/** The Saturday Plate runs this many slots after the Weekend Feature (30 minutes): the calendar meeting's third race. */
export const PLATE_AFTER_SLOTS = 2;
/**
 * Length of the card's class pattern (packages/db card.ts MEETING_CLASSES): the k-th meeting race
 * of all time takes place k mod 8 of the pattern, so a day of 24 races runs the pattern three
 * times whatever the meetings look like, and the calendar meeting's first race is always the
 * pattern's first place (its top race).
 */
export const CARD_PATTERN_RACES = 8;
/**
 * How far ahead the Live card is published (entries open at publication): a day, so a player
 * who visits once a day can enter any meeting before their next visit. Calendar races publish on
 * the same horizon.
 */
export const CARD_HORIZON_MS = 24 * MS_PER_HOUR;

export interface Meeting {
  /** Global meeting number (days since the Unix epoch × meetings a day + meeting of the day). */
  number: number;
  /** 0 = first meeting of the UTC day. */
  ofDay: number;
  /** Post time of the first race (ms). */
  startMs: number;
  /** Post time of the last race (ms). */
  lastPostMs: number;
  /** Races in the meeting (RACES_PER_MEETING; plus the FINALS_MEETING_RACES Season Finals in the Finals meeting). */
  races: number;
  /** Time between its races (one card slot). */
  spacingMs: number;
  /** The season's Finals meeting. */
  finals: boolean;
}

export interface MeetingRace extends Meeting {
  /** Race of the meeting, 0..races-1. */
  race: number;
}

/** "HH:MM" → minutes after midnight. */
function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

const floorDiv = (a: number, b: number) => Math.floor(a / b);
const dayStartOf = (ms: number) => floorDiv(ms, MS_PER_DAY) * MS_PER_DAY;
const mod = (a: number, b: number) => ((a % b) + b) % b;

/** True on the last day of a competition season (the Season Finals' day). */
export function isFinalsDay(clock: SeasonClock, dayStartMs: number): boolean {
  return mod(floorDiv(dayStartMs - clock.epochMs, MS_PER_DAY), SEASON_DAYS) === SEASON_DAYS - 1;
}

/**
 * Every derived constant and function of one schedule. The module exports the live schedule's
 * (MEETING_START_TIMES_UTC, RACES_PER_MEETING); tests build the others. Throws for a schedule
 * the card can't run: off the slot grid, out of order, overlapping meetings,
 * no 19:00 meeting, a calendar meeting too short for the Plate, a Finals meeting that would
 * clash, or a day that doesn't run the class pattern a whole number of times.
 */
export function meetingSchedule(schedule: MeetingSchedule) {
  const startTimes = [...schedule.startTimesUtc];
  const racesPerMeeting = schedule.racesPerMeeting;
  const perDay = startTimes.length;
  const startMs = startTimes.map((t) => minutesOf(t) * MS_PER_MINUTE);
  // gap from each meeting's start to the next one's (the last wraps to tomorrow's first)
  const gapsMs = startMs.map((t, i) => (startMs[i + 1] ?? startMs[0]! + MS_PER_DAY) - t);
  const intervalMs = Math.max(...gapsMs);
  const evenlySpaced = gapsMs.every((g) => g === gapsMs[0]);
  const calendarOfDay = startTimes.indexOf(CALENDAR_MEETING_START_UTC);
  const finalsStartMs = minutesOf(FINALS_MEETING_START_UTC) * MS_PER_MINUTE;
  const spanMs = (racesPerMeeting - 1) * MEETING_RACE_SPACING_MS;
  const finalsEndMs = finalsStartMs + (racesPerMeeting + FINALS_MEETING_RACES - 1) * MEETING_RACE_SPACING_MS;
  const racesPerDay = perDay * racesPerMeeting;

  const problem = (() => {
    if (!perDay || racesPerMeeting < 1) return "no meetings";
    for (let i = 0; i < perDay; i++) {
      if (startMs[i]! % SLOT_INTERVAL_MS !== 0) return `${startTimes[i]} is off the slot grid`;
      if (gapsMs[i]! <= spanMs) return `the ${startTimes[i]} meeting runs into the next (or the times are out of order)`;
    }
    if (calendarOfDay < 0) return `no ${CALENDAR_MEETING_START_UTC} meeting for the calendar races`;
    if (racesPerMeeting <= PLATE_AFTER_SLOTS) return "the calendar meeting is too short for the Saturday Plate";
    const prevEnd = startMs[calendarOfDay - 1] ?? startMs[perDay - 1]! - MS_PER_DAY;
    const nextStart = startMs[calendarOfDay + 1] ?? startMs[0]! + MS_PER_DAY;
    if (prevEnd + spanMs >= finalsStartMs || finalsEndMs >= nextStart) return "the Finals meeting would clash with its neighbours";
    if (FINALS_MEETING_SPACING_MS !== 2 * MEETING_RACE_SPACING_MS) return "the Finals interleave needs them two slots apart";
    if (racesPerDay % CARD_PATTERN_RACES !== 0) return `a day must run the class pattern a whole number of times (${racesPerDay} races)`;
    return null;
  })();
  if (problem) throw new Error(`meeting schedule ${startTimes.join(",")} x ${racesPerMeeting}: ${problem}`);

  // The calendar meeting's first race takes the pattern's first place (the meeting's top race).
  const patternOffset = mod(-calendarOfDay * racesPerMeeting, CARD_PATTERN_RACES);

  function meetingAt(clock: SeasonClock, dayStartMs: number, ofDay: number): Meeting {
    const finals = ofDay === calendarOfDay && isFinalsDay(clock, dayStartMs);
    const races = finals ? racesPerMeeting + FINALS_MEETING_RACES : racesPerMeeting;
    const spacingMs = MEETING_RACE_SPACING_MS;
    const start = dayStartMs + (finals ? finalsStartMs : startMs[ofDay]!);
    return { number: floorDiv(dayStartMs, MS_PER_DAY) * perDay + ofDay, ofDay, startMs: start, lastPostMs: start + (races - 1) * spacingMs, races, spacingMs, finals };
  }

  /** The meetings of the UTC day that holds `dayMs`, in order. */
  function meetingsOn(clock: SeasonClock, dayMs: number): Meeting[] {
    const day = dayStartOf(dayMs);
    return Array.from({ length: perDay }, (_, i) => meetingAt(clock, day, i));
  }

  /** Start offsets (ms after UTC midnight) of a day's meetings. */
  function meetingStartsOn(clock: SeasonClock, dayMs: number): number[] {
    const day = dayStartOf(dayMs);
    return meetingsOn(clock, day).map((m) => m.startMs - day);
  }

  /** The meeting race going off at `postTimeMs`, or null when no meeting race runs then. */
  function meetingRaceAt(clock: SeasonClock, postTimeMs: number): MeetingRace | null {
    for (const m of meetingsOn(clock, postTimeMs)) {
      const off = postTimeMs - m.startMs;
      if (off < 0 || postTimeMs > m.lastPostMs || off % m.spacingMs !== 0) continue;
      return { ...m, race: off / m.spacingMs };
    }
    return null;
  }

  /** Meetings whose first race goes off in [fromMs, toMs), in order. */
  function meetingsBetween(clock: SeasonClock, fromMs: number, toMs: number): Meeting[] {
    const out: Meeting[] = [];
    for (let day = dayStartOf(fromMs) - MS_PER_DAY; day < toMs; day += MS_PER_DAY) {
      for (const m of meetingsOn(clock, day)) if (m.startMs >= fromMs && m.startMs < toMs) out.push(m);
    }
    return out;
  }

  /** The meeting a post time belongs to: the one running then, else the next to start. */
  function meetingFor(clock: SeasonClock, postTimeMs: number): Meeting {
    const running = meetingRaceAt(clock, postTimeMs);
    if (running) return running;
    for (let d = dayStartOf(postTimeMs) - MS_PER_DAY; ; d += MS_PER_DAY) {
      for (const m of meetingsOn(clock, d)) if (m.lastPostMs >= postTimeMs) return m;
    }
  }

  /**
   * The meeting a race is listed under on the card: the one running at its post time, else the
   * last one that started before it. A race published under an older schedule (e.g. the meetings
   * of eight races from 07:00, 13:00 and 19:00 UTC) can run after the new meeting before it has
   * finished, so it stays listed with that meeting instead of jumping to the next one.
   */
  function meetingOf(clock: SeasonClock, postTimeMs: number): Meeting {
    const running = meetingRaceAt(clock, postTimeMs);
    if (running) return running;
    for (let d = dayStartOf(postTimeMs); ; d -= MS_PER_DAY) {
      const before = meetingsOn(clock, d).filter((m) => m.startMs <= postTimeMs);
      if (before.length) return before[before.length - 1]!;
    }
  }

  /**
   * When the `n`-th meeting from `nowMs` finishes (post time of its last race). n = 1 is the
   * meeting running now, or the next one. Used by "look at the next meeting" helpers.
   */
  function nthMeetingEndMs(clock: SeasonClock, nowMs: number, n: number): number {
    let m = meetingFor(clock, nowMs);
    for (let i = 1; i < n; i++) m = meetingFor(clock, m.lastPostMs + 1);
    return m.lastPostMs;
  }

  /**
   * A meeting race's place in the card's class pattern (CARD_PATTERN_RACES places): `place` is
   * 0..7, `block` counts whole runs of the pattern since the epoch (the old "meeting number" the
   * pattern alternates Features and maidens by). In the Finals meeting the meeting's own races
   * keep their places; a Season Final's (isSeasonFinalRace) is meaningless.
   */
  function cardPatternPlace(m: Pick<MeetingRace, "number" | "race"> & { finals?: boolean }): { block: number; place: number } {
    // in the Finals meeting the meeting's own races sit between and after the Finals
    const own = m.finals ? (m.race < 2 * FINALS_MEETING_RACES ? (m.race - 1) / 2 : m.race - FINALS_MEETING_RACES) : m.race;
    const k = m.number * racesPerMeeting + Math.floor(own) + patternOffset;
    return { block: floorDiv(k, CARD_PATTERN_RACES), place: mod(k, CARD_PATTERN_RACES) };
  }

  /** In the Finals meeting, the races that are Season Finals (18:00, 18:30, 19:00, 19:30). */
  function isSeasonFinalRace(m: Pick<MeetingRace, "finals" | "race">): boolean {
    return m.finals && m.race < 2 * FINALS_MEETING_RACES && m.race % 2 === 0;
  }

  return {
    startTimesUtc: startTimes as readonly string[],
    racesPerMeeting,
    meetingsPerDay: perDay,
    /** Longest gap between two meetings' starts (the interval, when they are evenly spaced). */
    meetingIntervalMs: intervalMs,
    evenlySpaced,
    /** Longest wait from any moment to the next meeting race. */
    longestWaitMs: intervalMs - spanMs,
    liveRacesPerDay: racesPerDay,
    calendarMeetingOfDay: calendarOfDay,
    meetingsOn,
    meetingStartsOn,
    meetingRaceAt,
    meetingsBetween,
    meetingFor,
    meetingOf,
    nthMeetingEndMs,
    cardPatternPlace,
    isSeasonFinalRace,
  };
}

export type MeetingScheduleFns = ReturnType<typeof meetingSchedule>;

const LIVE = meetingSchedule({ startTimesUtc: MEETING_START_TIMES_UTC, racesPerMeeting: RACES_PER_MEETING });

/** Meetings a day. */
export const MEETINGS_PER_DAY = LIVE.meetingsPerDay;
/** Time from one meeting's start to the next (the longest such gap when they aren't evenly spaced). */
export const MEETING_INTERVAL_MS = LIVE.meetingIntervalMs;
/** The meetings are evenly spaced ("one every MEETING_INTERVAL_MS"). */
export const MEETINGS_EVENLY_SPACED = LIVE.evenlySpaced;
/** Ordinary Live races a day, derived (calendar races take some of these places; the Finals day differs a little). */
export const LIVE_RACES_PER_DAY = LIVE.liveRacesPerDay;
/** The calendar meeting's place in the day (0-based). */
export const CALENDAR_MEETING_OF_DAY = LIVE.calendarMeetingOfDay;
/** Longest wait from any moment to the next meeting race: the gap between two meetings. */
export const LONGEST_MEETING_WAIT_MS = LIVE.longestWaitMs;

export const meetingsOn = LIVE.meetingsOn;
export const meetingStartsOn = LIVE.meetingStartsOn;
export const meetingRaceAt = LIVE.meetingRaceAt;
export const meetingsBetween = LIVE.meetingsBetween;
export const meetingFor = LIVE.meetingFor;
export const meetingOf = LIVE.meetingOf;
export const nthMeetingEndMs = LIVE.nthMeetingEndMs;
export const cardPatternPlace = LIVE.cardPatternPlace;
export const isSeasonFinalRace = LIVE.isSeasonFinalRace;
