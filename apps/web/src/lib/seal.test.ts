import { describe, expect, it } from "vitest";
import { sealCopy, sealState } from "./seal";

describe("sealState", () => {
  it("is only committed while entries are open", () => {
    expect(sealState({ fieldLocked: false, revealed: false, verified: false })).toBe("committed");
  });
  it("is sealed once the field locks, revealed with the result, verified after the check", () => {
    expect(sealState({ fieldLocked: true, revealed: false, verified: false })).toBe("sealed");
    expect(sealState({ fieldLocked: true, revealed: true, verified: false })).toBe("revealed");
    expect(sealState({ fieldLocked: true, revealed: true, verified: true })).toBe("verified");
  });
});

describe("sealCopy", () => {
  it("never says the outcome was locked before entries close", () => {
    const c = sealCopy("committed", "abc…def");
    expect(c.body).not.toMatch(/locked when entries closed/);
    expect(c.body).toContain("The seed is committed: its fingerprint is published now and the field is sealed when entries close");
    expect(c.body).toContain("abc…def");
    expect(c.badge).not.toMatch(/^Sealed/);
  });
  it("says the outcome was locked once the field is sealed", () => {
    expect(sealCopy("sealed", "x").body).toMatch(/^The outcome was locked when entries closed/);
    expect(sealCopy("sealed", "x").title).toBe("Sealed race");
  });
  it("uses verified wording after the check", () => {
    expect(sealCopy("verified", "x").title).toBe("Verified race");
  });
});
