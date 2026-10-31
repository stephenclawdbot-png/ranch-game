import { describe, expect, it } from "vitest";
import { coatLabel, oneInText, topPercent } from "./format";

describe("coatLabel", () => {
  it("names the render coat plain when there is no dun factor", () => {
    expect(coatLabel({ coat: "buckskin" })).toBe("Buckskin");
  });

  it("adds \"dun\" when the appearance carries the dun factor", () => {
    expect(coatLabel({ coat: "buckskin", dun: true })).toBe("Dun buckskin");
    expect(coatLabel({ coat: "chestnut", dun: true })).toBe("Dun chestnut");
  });
});

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
describe("topPercent", () => {
  it("is rank over field, rounded up", () => {
    expect(topPercent(1, 200)).toBe(1);
    expect(topPercent(1, 10)).toBe(10);
    expect(topPercent(3, 40)).toBe(8);
    expect(topPercent(10, 10)).toBe(100);
    expect(topPercent(2, 150)).toBe(2);
  });
  it("has no percentile for small fields", () => {
    expect(topPercent(1, 1)).toBeNull();
    expect(topPercent(1, 9)).toBeNull();
  });
});
