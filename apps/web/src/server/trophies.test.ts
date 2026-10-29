import { describe, expect, it } from "vitest";
import { trophyTier } from "./competition";

describe("Trophy Room tiers", () => {
  it("cups by race standing for wins, rosettes for Story wins and places", () => {
    expect(trophyTier("final", "graded", 1)).toBe("gold");
    expect(trophyTier("feature", "handicap", 1)).toBe("gold");
    expect(trophyTier("scheduled", "graded", 1)).toBe("gold");
    expect(trophyTier("scheduled", "listed", 1)).toBe("silver");
    expect(trophyTier("scheduled", "maiden", 1)).toBe("bronze");
    expect(trophyTier("quick", "maiden", 1)).toBe("first");
    expect(trophyTier("final", "graded", 2)).toBe("second");
    expect(trophyTier("scheduled", "novice", 3)).toBe("third");
  });
});
