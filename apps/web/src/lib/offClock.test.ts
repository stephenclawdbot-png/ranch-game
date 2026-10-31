import { describe, expect, it } from "vitest";
import { BROADCAST_DELAY_S } from "@thoroughbred/shared";
import { broadcastOffAt, msToBroadcastOff } from "./offClock";

describe("the race page's off clock", () => {
  it("counts to the feed's broadcast start once there is a feed (the viewer's own countdown)", () => {
    expect(broadcastOffAt(100_000, 102_345)).toBe(102_345);
  });
  it("before the feed, counts to post time plus the broadcast delay (no jump when the feed arrives)", () => {
    expect(broadcastOffAt(100_000, null)).toBe(100_000 + BROADCAST_DELAY_S * 1000);
    expect(broadcastOffAt(100_000, undefined)).toBe(100_000 + BROADCAST_DELAY_S * 1000);
  });
  it("is null once the off has gone or before the clock is known", () => {
    expect(msToBroadcastOff(null, 5_000)).toBeNull();
    expect(msToBroadcastOff(5_000, 5_000)).toBeNull();
    expect(msToBroadcastOff(4_200, 5_000)).toBe(800);
  });
});
