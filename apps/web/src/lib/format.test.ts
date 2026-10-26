import { describe, expect, it } from "vitest";
import { oneInText } from "./format";

describe("oneInText", () => {
  it("turns a chance per 1,000 into plain odds, rounded to two figures", () => {
    expect(oneInText(2.5)).toBe("about 1 in 400");
    expect(oneInText(16)).toBe("about 1 in 63"); // 80 permille risk, 20% of injuries career-ending
    expect(oneInText(0.12)).toBe("about 1 in 8,300"); // a sound horse: 4 permille, 3% share
    expect(oneInText(0.5)).toBe("about 1 in 2,000");
  });

  it("collapses tiny chances instead of printing huge numbers", () => {
    expect(oneInText(0.03)).toBe("under 1 in 10,000");
    expect(oneInText(0)).toBe("under 1 in 10,000");
  });
});