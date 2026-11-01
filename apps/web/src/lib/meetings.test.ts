import { describe, expect, it } from "vitest";
import * as gc from "@thoroughbred/game-core";
import { MEETING_CADENCE, MEETINGS_LINE, localClockText, utcClockText, waitText } from "./meetings";

const NOW = Date.UTC(2026, 10, 2, 22, 20); // Mon 2 Nov 2026, 22:20 UTC

describe("the schedule in words", () => {
  it("reads the cadence from the knobs", () => {
    expect(gc.MEETINGS_EVENLY_SPACED).toBe(true);
    expect(MEETING_CADENCE).toBe(`every ${gc.MEETING_INTERVAL_MS / gc.MS_PER_HOUR} hours`);
    expect(MEETINGS_LINE).toBe(`A race meeting every ${gc.MEETING_INTERVAL_MS / gc.MS_PER_HOUR} hours`);
  });
});

describe("post times in the player's clock", () => {
  const post = Date.UTC(2026, 10, 3, 1, 0); // the 01:00 UTC meeting

  it("UTC on the server", () => {
    expect(utcClockText(post)).toBe("01:00 UTC");
  });

  it("New York (same evening), Manila (next morning), London (tomorrow)", () => {
    expect(localClockText(post, NOW, { timeZone: "America/New_York", locale: "en-US" })).toBe("8:00 pm");
    expect(localClockText(post, NOW, { timeZone: "Asia/Manila", locale: "en-PH" })).toBe("9:00 am");
    expect(localClockText(post, NOW, { timeZone: "Europe/London", locale: "en-GB" })).toBe("tomorrow at 01:00");
    // two days out: the weekday
    expect(localClockText(post + 2 * gc.MS_PER_DAY, NOW, { timeZone: "Europe/London", locale: "en-GB" })).toBe("Thu at 01:00");
  });

  it("the wait in hours and minutes", () => {
    expect(waitText(post - NOW)).toBe("2 h 40 min");
    expect(waitText(35 * 60_000)).toBe("35 min");
    expect(waitText(2 * gc.MS_PER_HOUR)).toBe("2 h");
    expect(waitText(20_000)).toBe("under a minute");
    expect(waitText(0)).toBe("now");
  });
});
