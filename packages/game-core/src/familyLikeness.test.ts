import { describe, expect, it } from "vitest";
import type { HorseAppearance, HorseColour } from "@thoroughbred/shared";
import { familyLikeness, likenessText } from "./familyLikeness";

const SILKS = { primary: "#111111", secondary: "#ffffff", pattern: "solid", cap: "#111111" } as const;
const look = (c: Partial<HorseColour> = {}, a: Partial<HorseAppearance> = {}): HorseAppearance =>
  ({ coat: "bay", face: "none", legs: ["none", "none", "none", "none"], silks: SILKS, colour: { base: "bay", cream: 0, dun: false, roan: false, grey: "none", sabino: 0, ...c }, ...a }) as HorseAppearance;

describe("family likeness (looks only)", () => {
  it("names each trait's source: dam, sire or both", () => {
    const foal = look({ base: "chestnut" }, { face: "blaze" });
    expect(familyLikeness(foal, look({ base: "chestnut" }), look({}, { face: "blaze" }))).toEqual([
      { kind: "coat", trait: "chestnut coat", from: "dam" },
      { kind: "markings", trait: "blaze", from: "sire" },
    ]);
    expect(familyLikeness(foal, look({ base: "chestnut" }), look({ base: "chestnut" }))[0]).toEqual({ kind: "coat", trait: "chestnut coat", from: "both" });
  });

  it("prefers the most telling coat trait: a rare colour or pattern before grey, dilution or the base colour", () => {
    const foal = look({ grey: "greying", tobiano: 1 });
    const dam = look({ grey: "dapple" });
    const sire = look({ tobiano: 1 });
    expect(familyLikeness(foal, dam, sire)[0]).toEqual({ kind: "coat", trait: "tobiano patches", from: "sire" });
    expect(familyLikeness(look({ grey: "greying" }), dam, look())[0]).toEqual({ kind: "coat", trait: "grey coat", from: "dam" });
    expect(familyLikeness(look({ brindle: true }), look({ brindle: true }), look())[0]!.trait).toBe("brindle stripes");
  });

  it("reads build and hair: long legs from the leggy parent, a long mane, feathering", () => {
    const flat = { height: 0, leg: 0, neck: 0, girth: 0, head: 0 };
    const foal = look({ base: "black" }, { build: { ...flat, leg: 2 }, hair: { mane: 3, tail: 2, thick: true, wave: true } });
    const dam = look({ base: "chestnut" }, { build: { ...flat, leg: 1 } });
    const sire = look({ base: "chestnut" }, { build: { ...flat, leg: -1 }, hair: { mane: 3, tail: 2, thick: true, wave: false } });
    const body = familyLikeness(foal, dam, sire).find((l) => l.kind === "body");
    expect(body).toEqual({ kind: "body", trait: "long mane", from: "sire" });
    const noHair = { ...foal, hair: undefined };
    expect(familyLikeness(noHair, dam, sire).find((l) => l.kind === "body")).toEqual({ kind: "body", trait: "long legs", from: "dam" });
    expect(familyLikeness(look({}, { feather: true }), look(), look({}, { feather: true }))).toContainEqual({ kind: "body", trait: "feathered legs", from: "sire" });
  });

  it("an unknown parent is left out; nothing shared gives no lines; at most one line per kind", () => {
    const foal = look({ base: "chestnut" }, { face: "star", legs: ["sock", "sock", "none", "none"] });
    expect(familyLikeness(foal, null, look({ base: "chestnut" }))).toEqual([{ kind: "coat", trait: "chestnut coat", from: "sire" }]);
    expect(familyLikeness(foal, null, null)).toEqual([]);
    expect(familyLikeness(foal, look({ base: "black" }), look({ base: "black" }))).toEqual([]);
    const lines = familyLikeness(foal, look({ base: "chestnut" }, { face: "star", legs: ["sock", "none", "sock", "none"] }), look({ base: "chestnut" }));
    expect(new Set(lines.map((l) => l.kind)).size).toBe(lines.length);
    expect(lines.find((l) => l.kind === "markings")).toEqual({ kind: "markings", trait: "star", from: "dam" });
    expect(familyLikeness(foal, look({ base: "chestnut" }), look({ base: "chestnut" }), 1)).toHaveLength(1);
  });

  it("says it in words", () => {
    expect(likenessText({ kind: "markings", trait: "blaze", from: "dam" }, "her", { dam: "Fair Wind" })).toBe("Blaze from her dam, Fair Wind");
    expect(likenessText({ kind: "coat", trait: "grey coat", from: "sire" }, "his", {})).toBe("Grey coat from his sire");
    expect(likenessText({ kind: "coat", trait: "chestnut coat", from: "both" }, "its", {})).toBe("Chestnut coat, like both parents");
  });
});
