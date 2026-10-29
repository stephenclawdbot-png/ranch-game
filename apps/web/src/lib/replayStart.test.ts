/**
 * The pure helper behind `?at=` on a race page: "finish" (or a second) opens the replay
 * there, but only for a race that's over — a live or upcoming race ignores the param.
 */
import { describe, expect, it } from "vitest";
import { FINISH_LEAD_SEC, replayStartSec } from "./replayStart";

describe("replayStartSec", () => {
  it("?at=finish starts FINISH_LEAD_SEC before the winning time, clamped at the off", () => {
    expect(replayStartSec("finish", true, 71.3)).toBe(71.3 - FINISH_LEAD_SEC);
    expect(replayStartSec("finish", true, 2)).toBe(0);
  });

  it("is ignored entirely on a race that isn't over (no spoilers)", () => {
    expect(replayStartSec("finish", false, 71.3)).toBeUndefined();
    expect(replayStartSec("30", false, 71.3)).toBeUndefined();
  });

  it("?at=<seconds> starts at that race second once the race is over", () => {
    expect(replayStartSec("30", true, 71.3)).toBe(30);
    expect(replayStartSec("0", true, 71.3)).toBe(0);
    expect(replayStartSec("12.5", true, 71.3)).toBe(12.5);
  });

  it("anything else — missing, malformed, or a finish with no known winner time — opens the page as normal", () => {
    expect(replayStartSec(undefined, true, 71.3)).toBeUndefined();
    expect(replayStartSec("", true, 71.3)).toBeUndefined();
    expect(replayStartSec("soon", true, 71.3)).toBeUndefined();
    expect(replayStartSec("-5", true, 71.3)).toBeUndefined();
    expect(replayStartSec("finish", true, null)).toBeUndefined();
  });
});