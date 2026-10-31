import { describe, expect, it } from "vitest";
import { BLOODLINE_NUDGE_DAYS, UNLOCK_MARKET_DAYS, bloodlineNudge, type BloodlineFacts } from "./onboarding";

const facts = (over: Partial<BloodlineFacts> = {}): BloodlineFacts => ({
  guided: true,
  daysSinceFounding: BLOODLINE_NUDGE_DAYS,
  dismissed: false,
  hasBred: false,
  mares: [
    { id: "a", name: "Lucky Penny", racing: true, rating: 44 },
    { id: "b", name: "Paper Moon", racing: true, rating: 38 },
  ],
  ...over,
});

describe("the day-3 bloodline nudge", () => {
  it("opens on the stable's third day, the same day as the market", () => {
    expect(BLOODLINE_NUDGE_DAYS).toBe(UNLOCK_MARKET_DAYS);
    expect(bloodlineNudge(facts({ daysSinceFounding: 0 }))).toBeNull();
    expect(bloodlineNudge(facts({ daysSinceFounding: 1 }))).toBeNull();
    expect(bloodlineNudge(facts())).not.toBeNull();
    expect(bloodlineNudge(facts({ daysSinceFounding: 9 }))).not.toBeNull();
  });

  it("suggests retiring the lowest-rated racing filly, so the best keep racing", () => {
    expect(bloodlineNudge(facts())).toEqual({ horseId: "b", name: "Paper Moon", retired: false });
  });

  it("a mare already retired comes first: she can breed straight away", () => {
    const f = facts({ mares: [...facts().mares, { id: "c", name: "Old Flame", racing: false, rating: 60 }] });
    expect(bloodlineNudge(f)).toEqual({ horseId: "c", name: "Old Flame", retired: true });
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
