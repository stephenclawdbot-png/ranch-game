import { describe, expect, it } from "vitest";
import type { StableHorse } from "@/lib/types";
import { layoutHerd } from "./RanchStage";

const horse = (id: string, stage = "prime"): StableHorse =>
  ({ id, stage, horse: { name: id, appearance: { coat: "bay" } } }) as unknown as StableHorse;

describe("Ranch herd layout", () => {
  it("puts every horse out when the pasture is wide enough", () => {
    const herd = layoutHerd(["a", "b", "c"].map((id) => horse(id)), 80, 800);
    expect(herd.placed.map((p) => p.s.id).sort()).toEqual(["a", "b", "c"]);
    expect(herd.inBarn).toBe(0);
    for (const p of herd.placed) {
      expect(p.item.x).toBeGreaterThanOrEqual(80 - p.item.fw / 2);
      expect(p.item.x + p.item.fw).toBeLessThanOrEqual(800 + p.item.fw / 2);
      expect(p.item.look?.appearance).toBeDefined();
    }
  });

  it("keeps the rest in the barn on a narrow (phone) crop", () => {
    const herd = layoutHerd(Array.from({ length: 12 }, (_, i) => horse(`h${i}`)), 245, 635);
    expect(herd.placed.length).toBeLessThan(12);
    expect(herd.placed.length + herd.inBarn).toBe(12);
  });

  it("draws youngstock smaller, the lead horse close up, and is deterministic", () => {
    const a = layoutHerd([horse("mare"), horse("foal", "foal"), horse("colt")], 0, 880);
    const b = layoutHerd([horse("mare"), horse("foal", "foal"), horse("colt")], 0, 880);
    expect(a.placed.map((p) => p.item)).toEqual(b.placed.map((p) => p.item));
    const foal = a.placed.find((p) => p.s.id === "foal")!;
    expect(foal.item.src).toMatch(/-s3\.png$/);
    const lead = a.placed.find((p) => p.s.id === "mare")!;
    expect(lead.row).toBe("near");
    expect(lead.item.src).toMatch(/horse-loose-(graze|idle)\.png$/);
    expect(a.placed[a.placed.length - 1]!.row).toBe("near");
    for (const p of a.placed.filter((x) => x.row !== "near")) expect(p.item.roam?.range).toBeGreaterThan(0);
  });
});
