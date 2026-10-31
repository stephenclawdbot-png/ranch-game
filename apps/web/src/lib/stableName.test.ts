import { describe, expect, it } from "vitest";
import { StableNameSchema, cleanStableName, stableNameProblem } from "./stableName";

describe("stable names", () => {
  it("accepts one to three words of 3-24 characters", () => {
    for (const ok of ["Godolphin", "Whitecross House", "Mill Reef Stud", "O'Brien & Sons", "Ash-Lee 7"]) expect(stableNameProblem(ok)).toBeNull();
  });
  it("refuses too short, too long, too many words, odd characters, digits only and house names", () => {
    expect(stableNameProblem("Ab")).toMatch(/At least/);
    expect(stableNameProblem("A".repeat(25))).toMatch(/At most 24/);
    expect(stableNameProblem("One Two Three Four")).toMatch(/words/);
    expect(stableNameProblem("Bad<Name>")).toMatch(/only/);
    expect(stableNameProblem("1234")).toMatch(/letter/);
    for (const bad of ["The Club", "Post Time Official", "Admin Stable", "posttime"]) expect(stableNameProblem(bad)).toMatch(/kept for the game/);
  });
  it("stores names trimmed with single spaces", () => {
    expect(cleanStableName("  Mill   Reef  ")).toBe("Mill Reef");
    expect(StableNameSchema.parse("  Mill   Reef ")).toBe("Mill Reef");
    expect(StableNameSchema.safeParse("x").success).toBe(false);
  });
});
