import { describe, expect, it } from "vitest";
import { alternativeNames, isProfane, nameKey, normalizeHorseName, registrationNumber, validateHorseName, HORSE_NAME_MAX } from "./naming";

describe("horse names", () => {
  it("normalises and keys case-insensitively", () => {
    expect(normalizeHorseName("  Brave   Heart ")).toBe("Brave Heart");
    expect(nameKey(" BRAVE  heart")).toBe("brave heart");
  });

  it("accepts real racing names", () => {
    for (const n of ["Seabiscuit", "Red Rum", "Man o' War", "Secretariat", "Dr. Fager", "Nijinsky", "Zenyatta", "Kauto Star", "Ça Va Bien", "Mill-Reef"]) {
      expect(validateHorseName(n)).toEqual({ ok: true, name: n });
    }
  });

  it("enforces 2-18 characters, spaces included", () => {
    expect(validateHorseName("A")).toMatchObject({ ok: false, problem: "TOO_SHORT" });
    expect(validateHorseName("   ")).toMatchObject({ ok: false, problem: "EMPTY" });
    expect(validateHorseName("Abcdefghi Jklmnopq")).toMatchObject({ ok: true }); // 18
    expect(validateHorseName("Abcdefghi Jklmnopqr")).toMatchObject({ ok: false, problem: "TOO_LONG" }); // 19
  });

  it("rejects digits, symbols and leading punctuation", () => {
    for (const n of ["Horse 2", "R2D2", "Win$", "'Tis", "-Dash", "Emoji 🐎"]) expect(validateHorseName(n)).toMatchObject({ ok: false, problem: "BAD_CHARS" });
  });

  it("filters profanity without the Scunthorpe problem", () => {
    for (const n of ["Fuck Off", "Big Shitter", "S H I T", "Sh-it Happens", "Rape Fields", "Hitler Youth"]) expect(isProfane(n)).toBe(true);
    for (const n of ["Grape Escape", "Cumberland Gap", "Classic Brass", "Scunthorpe", "Spice Trade", "Titan", "Peacock", "Pass Hit", "Hello Sailor", "Therapist"]) expect(isProfane(n)).toBe(false);
    expect(validateHorseName("Fuk Yeah")).toMatchObject({ ok: false, problem: "PROFANE" });
  });

  it("formats registration numbers", () => {
    expect(registrationNumber(2, 4571)).toBe("G2-04571");
    expect(registrationNumber(0, 12)).toBe("G0-00012");
    expect(registrationNumber(11, 123456)).toBe("G11-123456");
  });

  it("offers deterministic, valid, distinct alternatives", () => {
    const a = alternativeNames("Silver Lark", "seed-1");
    expect(a).toEqual(alternativeNames("Silver Lark", "seed-1"));
    expect(a).not.toContain("Silver Lark");
    expect(new Set(a.map(nameKey)).size).toBe(a.length);
    expect(a.length).toBe(24);
    for (const n of a) expect(validateHorseName(n)).toMatchObject({ ok: true });
    expect(a.at(-1)!.length).toBeLessThanOrEqual(HORSE_NAME_MAX);
    expect(alternativeNames("Abcdefghijklmnopqr", "s").some((n) => / II$/.test(n))).toBe(true);
  });
});
