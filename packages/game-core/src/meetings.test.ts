import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  CALENDAR_MEETING_OF_DAY,
  CALENDAR_MEETING_START_UTC,
  CARD_HORIZON_MS,
  CARD_PATTERN_RACES,
  FINALS_MEETING_RACES,
  FINALS_MEETING_START_UTC,
  LIVE_RACES_PER_DAY,
  LONGEST_MEETING_WAIT_MS,
  MEETING_INTERVAL_MS,
  MEETING_RACE_SPACING_MS,
  MEETING_START_TIMES_UTC,
  MEETINGS_PER_DAY,
  PLATE_AFTER_SLOTS,
  RACES_PER_MEETING,
  meetingOf,
  meetingSchedule,
  type MeetingSchedule,
} from "./meetings";
import { featureCalendar, SLOT_INTERVAL_MS, SLOTS_PER_DAY } from "./seasons";
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, seasonStartMs } from "./time";

const EPOCH = Date.UTC(2026, 0, 5); // season 1 starts on a Monday (packages/db RULES.seasonEpochMs)
const clock = { epochMs: EPOCH };
const DAY0 = EPOCH + 10 * MS_PER_DAY;
const slotOf = (ms: number) => Math.floor((ms - EPOCH) / SLOT_INTERVAL_MS) * SLOT_INTERVAL_MS + EPOCH;
const hhmm = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h! * MS_PER_HOUR + m! * MS_PER_MINUTE;
};

/** The live schedule, the other candidates the owner looked at, and the schedule before 2026-11-01. */
const SCHEDULES: [string, MeetingSchedule][] = [
  ["live", { startTimesUtc: MEETING_START_TIMES_UTC, racesPerMeeting: RACES_PER_MEETING }],
  ["8 x 3", { startTimesUtc: ["01:00", "04:00", "07:00", "10:00", "13:00", "16:00", "19:00", "22:00"], racesPerMeeting: 3 }],
  ["6 x 4", { startTimesUtc: ["03:00", "07:00", "11:00", "15:00", "19:00", "23:00"], racesPerMeeting: 4 }],
  ["old 3 x 8", { startTimesUtc: ["07:00", "13:00", "19:00"], racesPerMeeting: 8 }],
];

describe("race meetings: the live schedule", () => {
  it("eight meetings a day, one every three hours, of four races 15 minutes apart: 32 races, derived", () => {
    expect(MEETING_START_TIMES_UTC).toEqual(["01:00", "04:00", "07:00", "10:00", "13:00", "16:00", "19:00", "22:00"]);
    expect(RACES_PER_MEETING).toBe(4);
    expect(MEETINGS_PER_DAY).toBe(MEETING_START_TIMES_UTC.length);
    expect(LIVE_RACES_PER_DAY).toBe(MEETINGS_PER_DAY * RACES_PER_MEETING);
    expect(MEETING_INTERVAL_MS).toBe(3 * MS_PER_HOUR);
    expect(MEETING_RACE_SPACING_MS).toBe(15 * MS_PER_MINUTE);
    // the longest wait for the next Live race: about two and a quarter hours
    expect(LONGEST_MEETING_WAIT_MS).toBe(2 * MS_PER_HOUR + 15 * MS_PER_MINUTE);
  });

  it("lists a race under the meeting running then, else the last one that started (old-schedule races)", () => {
    // a new meeting race
    expect(meetingOf(clock, DAY0 + 13 * MS_PER_HOUR + 15 * MS_PER_MINUTE).startMs).toBe(DAY0 + 13 * MS_PER_HOUR);
    // the old schedule's 13:00 meeting ran to 14:45: those races stay with the 13:00 meeting
    expect(meetingOf(clock, DAY0 + 14 * MS_PER_HOUR + 45 * MS_PER_MINUTE).startMs).toBe(DAY0 + 13 * MS_PER_HOUR);
    expect(meetingOf(clock, DAY0 + 20 * MS_PER_HOUR + 45 * MS_PER_MINUTE).startMs).toBe(DAY0 + 19 * MS_PER_HOUR);
    // before the day's first meeting: the previous day's last
    expect(meetingOf(clock, DAY0 + 30 * MS_PER_MINUTE).startMs).toBe(DAY0 - 2 * MS_PER_HOUR);
  });

  it("refuses a schedule the card can't run", () => {
    expect(() => meetingSchedule({ startTimesUtc: ["07:00", "13:00"], racesPerMeeting: 4 })).toThrow(/19:00/);
    expect(() => meetingSchedule({ startTimesUtc: ["07:10", "19:00"], racesPerMeeting: 4 })).toThrow(/slot grid/);
    expect(() => meetingSchedule({ startTimesUtc: ["19:00", "07:00"], racesPerMeeting: 4 })).toThrow(/out of order/);
    expect(() => meetingSchedule({ startTimesUtc: ["18:45", "19:00"], racesPerMeeting: 4 })).toThrow(/runs into/);
    expect(() => meetingSchedule({ startTimesUtc: ["07:00", "19:00"], racesPerMeeting: 2 })).toThrow(/Plate/);
    expect(() => meetingSchedule({ startTimesUtc: ["16:00", "19:00"], racesPerMeeting: 12 })).toThrow();
    expect(() => meetingSchedule({ startTimesUtc: ["07:00", "19:00"], racesPerMeeting: 5 })).toThrow(/pattern/);
  });
});

describe.each(SCHEDULES)("race meetings: %s", (_, schedule) => {
  const s = meetingSchedule(schedule);
  const R = s.racesPerMeeting;

  it("meetings of R races, 15 minutes apart, on the slot grid, at their start times", () => {
    expect(s.liveRacesPerDay).toBe(s.meetingsPerDay * R);
    const day = Array.from({ length: SLOTS_PER_DAY }, (_, i) => DAY0 + i * SLOT_INTERVAL_MS).map((t) => [t, s.meetingRaceAt(clock, t)] as const);
    const races = day.filter(([, m]) => m);
    expect(races).toHaveLength(s.liveRacesPerDay);
    for (let i = 0; i < s.meetingsPerDay; i++) {
      const inMeeting = races.filter(([, m]) => m!.ofDay === i);
      expect(inMeeting.map(([, m]) => m!.race)).toEqual(Array.from({ length: R }, (_, k) => k));
      expect(inMeeting[0]![0]).toBe(DAY0 + hhmm(s.startTimesUtc[i]!));
      expect(inMeeting.every(([t], k) => t === inMeeting[0]![0] + k * MEETING_RACE_SPACING_MS)).toBe(true);
    }
    // global meeting numbers are consecutive and unique
    const numbers = [...new Set(races.map(([, m]) => m!.number))];
    expect(numbers).toHaveLength(s.meetingsPerDay);
    expect(numbers.every((n, i) => i === 0 || n - numbers[i - 1]! === 1)).toBe(true);
    // off the grid or between meetings: no race
    const first = DAY0 + hhmm(s.startTimesUtc[0]!);
    expect(s.meetingRaceAt(clock, first + 60_000)).toBeNull();
    expect(s.meetingRaceAt(clock, first + R * MEETING_RACE_SPACING_MS)).toBeNull();
  });

  it("the longest wait for the next meeting race is the gap between meetings, at any time of day", () => {
    let worst = 0;
    for (let t = DAY0; t < DAY0 + MS_PER_DAY; t += 5 * MS_PER_MINUTE) {
      const m = s.meetingFor(clock, t);
      const next = Math.max(m.startMs, Math.ceil((t - m.startMs) / m.spacingMs) * m.spacingMs + m.startMs);
      worst = Math.max(worst, next - t);
    }
    // just after a meeting's last race: the gap to the next meeting (sampled every 5 minutes)
    expect(worst).toBeLessThanOrEqual(s.longestWaitMs);
    expect(worst).toBeGreaterThanOrEqual(s.longestWaitMs - 5 * MS_PER_MINUTE);
  });

  it("every calendar race sits inside the 19:00 meeting, the Season Finals inside the Finals meeting", () => {
    expect(s.startTimesUtc[s.calendarMeetingOfDay]).toBe(CALENDAR_MEETING_START_UTC);
    for (const season of [1, 2, 3, 7]) {
      const cal = featureCalendar(clock, season);
      expect(cal.length).toBeGreaterThan(20);
      for (const r of cal) {
        const m = s.meetingRaceAt(clock, slotOf(r.postTimeMs));
        expect(m, `${r.name} at ${slotOf(r.postTimeMs)}`).not.toBeNull();
        expect(m!.ofDay).toBe(s.calendarMeetingOfDay);
        expect(m!.finals).toBe(r.kind === "season_final");
        // Qualifiers and the Weekend Feature open the meeting, on the pattern's top race
        if (r.kind !== "season_final") {
          expect(m!.race).toBe(0);
          expect(s.cardPatternPlace(m!).place).toBe(0);
        }
      }
      // the Saturday Plate, 30 minutes after the Weekend Feature, is the meeting's third race (a handicap place)
      for (const wf of cal.filter((r) => r.kind === "weekend_feature")) {
        const m = s.meetingRaceAt(clock, slotOf(wf.postTimeMs) + PLATE_AFTER_SLOTS * SLOT_INTERVAL_MS);
        expect(m?.ofDay).toBe(s.calendarMeetingOfDay);
        expect(m?.race).toBe(PLATE_AFTER_SLOTS);
        expect(s.cardPatternPlace(m!).place).toBe(PLATE_AFTER_SLOTS);
      }
      const finalsDay = seasonStartMs(clock, season) + 27 * MS_PER_DAY;
      const finals = cal.filter((r) => r.kind === "season_final").map((r) => slotOf(r.postTimeMs) - finalsDay);
      expect(finals).toEqual([18, 18.5, 19, 19.5].map((h) => h * MS_PER_HOUR));
      expect(FINALS_MEETING_START_UTC).toBe("18:00");
      for (const [k, at] of finals.entries()) expect(s.meetingRaceAt(clock, finalsDay + at)?.race).toBe(k);
      expect(s.meetingRaceAt(clock, finalsDay + 18 * MS_PER_HOUR + 15 * MS_PER_MINUTE)).toBeNull();
      expect(s.meetingRaceAt(clock, finalsDay + 19 * MS_PER_HOUR + 45 * MS_PER_MINUTE)).toBeNull();
      // no clash with the meetings before and after
      const day = s.meetingsOn(clock, finalsDay);
      for (let i = 1; i < day.length; i++) expect(day[i]!.startMs).toBeGreaterThan(day[i - 1]!.lastPostMs);
      expect(day.filter((m) => m.finals)).toHaveLength(1);
      expect(Array.from({ length: SLOTS_PER_DAY }, (_, i) => s.meetingRaceAt(clock, finalsDay + i * SLOT_INTERVAL_MS)).filter(Boolean)).toHaveLength(s.liveRacesPerDay - R + FINALS_MEETING_RACES);
    }
  });

  it("a day runs the class pattern a whole number of times", () => {
    const places = new Map<number, number>();
    for (const m of s.meetingsOn(clock, DAY0)) for (let r = 0; r < m.races; r++) {
      const p = s.cardPatternPlace({ number: m.number, race: r }).place;
      places.set(p, (places.get(p) ?? 0) + 1);
    }
    expect([...places.keys()].sort()).toEqual(Array.from({ length: CARD_PATTERN_RACES }, (_, i) => i));
    expect(new Set(places.values())).toEqual(new Set([s.liveRacesPerDay / CARD_PATTERN_RACES]));
  });

  it("the card horizon (a day) always holds a day's meetings", () => {
    expect(CARD_HORIZON_MS).toBe(24 * MS_PER_HOUR);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60 * MS_PER_DAY }), (dt) => {
        const now = DAY0 + Math.floor(dt / SLOT_INTERVAL_MS) * SLOT_INTERVAL_MS;
        let n = 0;
        for (let t = now + SLOT_INTERVAL_MS; t <= now + CARD_HORIZON_MS; t += SLOT_INTERVAL_MS) if (s.meetingRaceAt(clock, t)) n++;
        // a day's worth (the Season Finals day's meeting is a little different)
        expect(Math.abs(n - s.liveRacesPerDay)).toBeLessThanOrEqual(Math.max(R, FINALS_MEETING_RACES));
        if (dt < 15 * MS_PER_DAY) expect(n).toBe(s.liveRacesPerDay);
      }),
      { numRuns: 40 },
    );
  });

  it("finds the meeting for a time, the end of the next meetings, and the meetings in a window", () => {
    const day = s.meetingsOn(clock, DAY0);
    const between = day[0]!.lastPostMs + 60_000; // after the first meeting, before the second
    expect(s.meetingFor(clock, between).startMs).toBe(day[1]!.startMs);
    expect(s.meetingFor(clock, day[1]!.startMs + MEETING_RACE_SPACING_MS).startMs).toBe(day[1]!.startMs);
    expect(s.meetingFor(clock, day.at(-1)!.lastPostMs + 60_000).startMs).toBe(s.meetingsOn(clock, DAY0 + MS_PER_DAY)[0]!.startMs);
    expect(s.nthMeetingEndMs(clock, between, 1)).toBe(day[1]!.lastPostMs);
    expect(s.nthMeetingEndMs(clock, between, 2)).toBe((day[2] ?? s.meetingsOn(clock, DAY0 + MS_PER_DAY)[0]!).lastPostMs);
    expect(s.meetingsBetween(clock, DAY0, DAY0 + MS_PER_DAY).map((m) => m.startMs - DAY0)).toEqual(s.startTimesUtc.map(hhmm));
    expect(s.meetingOf(clock, day[1]!.lastPostMs + 60_000).startMs).toBe(day[1]!.startMs);
  });
});

it("the live schedule's calendar meeting is the 19:00 one", () => {
  expect(MEETING_START_TIMES_UTC[CALENDAR_MEETING_OF_DAY]).toBe("19:00");
});
