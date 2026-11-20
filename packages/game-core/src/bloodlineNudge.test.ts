import { describe, expect, it } from "vitest";
import { BREED_FROM_STARTS } from "./lifecycle";
import { BLOODLINE_NUDGE_DAYS, UNLOCK_MARKET_DAYS, bloodlineNudge, type BloodlineFacts } from "./onboarding";

const facts = (over: Partial<BloodlineFacts> = {}): BloodlineFacts => ({
  guided: true,
  daysSinceFounding: BLOODLINE_NUDGE_DAYS,
  dismissed: false,
  hasBred: false,
  mares: [
    { id: "a", name: "Lucky Penny", racing: true, rating: 44, starts: 1 },
    { id: "b", name: "Paper Moon", racing: true, rating: 38, starts: 1 },
  ],
  ...over,
});

describe("the bloodline nudge", () => {
  it("opens on the stable's third day, the same day as the market", () => {
    expect(BLOODLINE_NUDGE_DAYS).toBe(UNLOCK_MARKET_DAYS);
    expect(bloodlineNudge(facts({ daysSinceFounding: 0 }))).toBeNull();
    expect(bloodlineNudge(facts({ daysSinceFounding: 1 }))).toBeNull();
    expect(bloodlineNudge(facts())).not.toBeNull();
    expect(bloodlineNudge(facts({ daysSinceFounding: 9 }))).not.toBeNull();
  });

  it("opens sooner, the day a racing filly has the starts to breed", () => {
    const ready = facts({ daysSinceFounding: 1, mares: [{ id: "a", name: "Lucky Penny", racing: true, rating: 44, starts: BREED_FROM_STARTS }] });
    expect(bloodlineNudge(ready)).toEqual({ horseId: "a", name: "Lucky Penny", retired: false, ready: true, startsToGo: 0 });
    expect(bloodlineNudge(facts({ daysSinceFounding: 0, mares: [{ id: "a", name: "Lucky Penny", racing: true, rating: 44, starts: BREED_FROM_STARTS - 1 }] }))).toBeNull();
  });

  it("never asks to retire: a filly short of her starts is told how many she needs, the closest first", () => {
    const f = facts({
      mares: [
        { id: "a", name: "Lucky Penny", racing: true, rating: 44, starts: BREED_FROM_STARTS - 1 },
        { id: "b", name: "Paper Moon", racing: true, rating: 38, starts: 0 },
      ],
    });
    expect(bloodlineNudge(f)).toEqual({ horseId: "a", name: "Lucky Penny", retired: false, ready: false, startsToGo: 1 });
    // Level on starts: the lower-rated one, so the better racer is the one kept busy.
    expect(bloodlineNudge(facts())).toEqual({ horseId: "b", name: "Paper Moon", retired: false, ready: false, startsToGo: BREED_FROM_STARTS - 1 });
  });

  it("a mare that can be covered today comes first: a retired one before a racing one", () => {
    const racingReady = { id: "d", name: "Fair Wind", racing: true, rating: 50, starts: BREED_FROM_STARTS };
    expect(bloodlineNudge(facts({ mares: [...facts().mares, racingReady] }))).toEqual({ horseId: "d", name: "Fair Wind", retired: false, ready: true, startsToGo: 0 });
    const f = facts({ mares: [...facts().mares, racingReady, { id: "c", name: "Old Flame", racing: false, rating: 60, starts: 0 }] });
    expect(bloodlineNudge(f)).toEqual({ horseId: "c", name: "Old Flame", retired: true, ready: true, startsToGo: 0 });
  });

  it("once: never after 'Not now', never once the stable has bred, never for unguided stables or without a mare", () => {
    expect(bloodlineNudge(facts({ dismissed: true }))).toBeNull();
    expect(bloodlineNudge(facts({ hasBred: true }))).toBeNull();
    expect(bloodlineNudge(facts({ guided: false }))).toBeNull();
    expect(bloodlineNudge(facts({ mares: [] }))).toBeNull();
  });

  it("is deterministic whatever the order the mares come in", () => {
    const m = facts().mares;
    expect(bloodlineNudge(facts({ mares: [...m].reverse() }))).toEqual(bloodlineNudge(facts()));
  });
});
