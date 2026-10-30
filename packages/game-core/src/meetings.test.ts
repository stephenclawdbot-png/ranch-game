import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  CARD_HORIZON_MS,
  LIVE_RACES_PER_DAY,
  MEETING_RACE_SPACING_MS,
  MEETING_START_TIMES_UTC,
  MEETINGS_PER_DAY,
  RACES_PER_MEETING,
  meetingFor,
  meetingRaceAt,
  meetingsBetween,
  nthMeetingEndMs,
} from "./meetings";
import { featureCalendar, SLOT_INTERVAL_MS, SLOTS_PER_DAY } from "./seasons";
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, seasonStartMs } from "./time";

const EPOCH = Date.UTC(2026, 0, 5); // season 1 starts on a Monday (packages/db RULES.seasonEpochMs)
const clock = { epochMs: EPOCH };
const DAY0 = EPOCH + 10 * MS_PER_DAY;

describe("race meetings", () => {
  it("three meetings of eight races, 15 minutes apart, on the slot grid", () => {
    expect(MEETING_START_TIMES_UTC).toEqual(["07:00", "13:00", "19:00"]);
    expect(RACES_PER_MEETING).toBe(8);
    expect(MEETING_RACE_SPACING_MS).toBe(15 * MS_PER_MINUTE);
    expect(LIVE_RACES_PER_DAY).toBe(24);
    const day = Array.from({ length: SLOTS_PER_DAY }, (_, i) => DAY0 + i * SLOT_INTERVAL_MS).map((t) => [t, meetingRaceAt(clock, t)] as const);
    const races = day.filter(([, m]) => m);
    expect(races).toHaveLength(LIVE_RACES_PER_DAY);
    for (let i = 0; i < MEETINGS_PER_DAY; i++) {
      const inMeeting = races.filter(([, m]) => m!.ofDay === i);
      expect(inMeeting.map(([, m]) => m!.race)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      const [h, min] = MEETING_START_TIMES_UTC[i]!.split(":").map(Number);
      expect(inMeeting[0]![0]).toBe(DAY0 + h! * MS_PER_HOUR + min! * MS_PER_MINUTE);
    }
    // global meeting numbers are consecutive and unique
    const numbers = [...new Set(races.map(([, m]) => m!.number))];
    expect(numbers).toHaveLength(3);
    expect(numbers[1]! - numbers[0]!).toBe(1);
    // off the grid or between meetings: no race
    expect(meetingRaceAt(clock, DAY0 + 7 * MS_PER_HOUR + 60_000)).toBeNull();
    expect(meetingRaceAt(clock, DAY0 + 10 * MS_PER_HOUR)).toBeNull();
  });

  it("every calendar race sits inside the evening meeting (Season Finals day opens at 18:00)", () => {
    for (const season of [1, 2, 3, 7]) {
      const cal = featureCalendar(clock, season);
      expect(cal.length).toBeGreaterThan(20);
      for (const r of cal) {
        const slotMs = Math.floor((r.postTimeMs - EPOCH) / SLOT_INTERVAL_MS) * SLOT_INTERVAL_MS + EPOCH;
        const m = meetingRaceAt(clock, slotMs);
        expect(m, `${r.name} at ${slotMs}`).not.toBeNull();
        expect(m!.ofDay).toBe(MEETINGS_PER_DAY - 1);
      }
      // the Saturday Plate, 30 minutes after the Weekend Feature, too
      for (const wf of cal.filter((r) => r.kind === "weekend_feature")) {
        const slotMs = Math.floor((wf.postTimeMs - EPOCH) / SLOT_INTERVAL_MS) * SLOT_INTERVAL_MS + EPOCH;
        expect(meetingRaceAt(clock, slotMs + 2 * SLOT_INTERVAL_MS)?.ofDay).toBe(MEETINGS_PER_DAY - 1);
      }
      const finalsDay = seasonStartMs(clock, season) + 27 * MS_PER_DAY;
      expect(meetingRaceAt(clock, finalsDay + 18 * MS_PER_HOUR)?.race).toBe(0);
      expect(meetingRaceAt(clock, finalsDay + 19 * MS_PER_HOUR)?.race).toBe(4);
      expect(meetingRaceAt(clock, finalsDay + 19 * MS_PER_HOUR + 45 * MS_PER_MINUTE)?.race).toBe(7);
      expect(meetingRaceAt(clock, finalsDay + 20 * MS_PER_HOUR)).toBeNull();
      // still 24 races that day
      expect(Array.from({ length: SLOTS_PER_DAY }, (_, i) => meetingRaceAt(clock, finalsDay + i * SLOT_INTERVAL_MS)).filter(Boolean)).toHaveLength(LIVE_RACES_PER_DAY);
    }
  });

  it("the card horizon (a day) always holds a day's meetings", () => {
    expect(CARD_HORIZON_MS).toBe(24 * MS_PER_HOUR);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60 * MS_PER_DAY }), (dt) => {
        const now = DAY0 + Math.floor(dt / SLOT_INTERVAL_MS) * SLOT_INTERVAL_MS;
        let n = 0;
        for (let t = now + SLOT_INTERVAL_MS; t <= now + CARD_HORIZON_MS; t += SLOT_INTERVAL_MS) if (meetingRaceAt(clock, t)) n++;
        // a day's worth: 24 races (the Season Finals day's earlier evening meeting shifts it by a few)
        expect(n).toBeGreaterThanOrEqual(LIVE_RACES_PER_DAY - 4);
        expect(n).toBeLessThanOrEqual(LIVE_RACES_PER_DAY + 4);
        if (dt < 15 * MS_PER_DAY) expect(n).toBe(LIVE_RACES_PER_DAY);
      }),
      { numRuns: 60 },
    );
  });

  it("finds the meeting for a time and the end of the next meetings", () => {
    const at10 = DAY0 + 10 * MS_PER_HOUR;
    expect(meetingFor(clock, at10).startMs).toBe(DAY0 + 13 * MS_PER_HOUR);
    expect(meetingFor(clock, DAY0 + 7 * MS_PER_HOUR + 30 * MS_PER_MINUTE).startMs).toBe(DAY0 + 7 * MS_PER_HOUR);
    expect(meetingFor(clock, DAY0 + 22 * MS_PER_HOUR).startMs).toBe(DAY0 + MS_PER_DAY + 7 * MS_PER_HOUR);
    expect(nthMeetingEndMs(clock, at10, 1)).toBe(DAY0 + 14 * MS_PER_HOUR + 45 * MS_PER_MINUTE);
    expect(nthMeetingEndMs(clock, at10, 2)).toBe(DAY0 + 20 * MS_PER_HOUR + 45 * MS_PER_MINUTE);
    expect(meetingsBetween(clock, DAY0, DAY0 + MS_PER_DAY).map((m) => (m.startMs - DAY0) / MS_PER_HOUR)).toEqual([7, 13, 19]);
  });
});
