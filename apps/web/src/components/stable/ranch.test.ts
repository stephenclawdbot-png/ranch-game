import { describe, expect, it } from "vitest";
import type { StableHorse } from "@/lib/types";
import { HERD_MARGIN, layoutHerd, placeTags } from "./RanchStage";

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

  it("keeps every horse, and its whole roaming beat, inside the visible pasture at every width", () => {
    // visible art ranges of the pasture at 360, 390, 430, 768 and 1440 css px (the camera crop)
    for (const [l, r] of [[262, 618], [245, 635], [224, 656], [80, 800], [0, 880]] as const) {
      for (const n of [1, 4, 8, 12]) {
        const herd = layoutHerd(Array.from({ length: n }, (_, i) => horse(`h${n}-${i}`, i % 4 === 3 ? "foal" : "prime")), l, r);
        expect(herd.placed.length + herd.inBarn).toBe(n);
        for (const p of herd.placed) {
          const range = p.item.roam?.range ?? 0;
          const lo = p.item.x - (p.item.flip ? range : 0);
          const hi = p.item.x + p.item.fw + (p.item.flip ? 0 : range);
          expect(lo, `${p.s.id} at ${l}-${r}`).toBeGreaterThanOrEqual(l + HERD_MARGIN - 0.5);
          expect(hi, `${p.s.id} at ${l}-${r}`).toBeLessThanOrEqual(r - HERD_MARGIN + 0.5);
        }
      }
    }
  });
});

describe("Ranch name tags", () => {
  const overlap = (a: { left: number; top: number }, b: { left: number; top: number }, w: number, h: number) => a.left < b.left + w && b.left < a.left + w && a.top < b.top + h && b.top < a.top + h;

  it("never cover each other or leave the stage, with 6+ horses close together", () => {
    for (const W of [360, 390, 430, 768, 1440]) {
      // eight horses bunched in the middle, one at each edge
      const boxes = Array.from({ length: 8 }, (_, i) => ({ id: `h${i}`, x: W / 2 - 80 + i * 18, y: 180 + (i % 3) * 14, w: 70, tw: 96, th: 22, far: i % 2 === 1 }));
      boxes.push({ id: "left", x: -20, y: 200, w: 60, tw: 110, th: 22, far: false }, { id: "right", x: W - 30, y: 200, w: 60, tw: 110, th: 22, far: false });
      const out = placeTags(boxes, W);
      expect(out.length).toBe(boxes.length);
      for (const t of out) {
        const b = boxes.find((x) => x.id === t.id)!;
        expect(t.left).toBeGreaterThanOrEqual(4);
        expect(t.left + b.tw).toBeLessThanOrEqual(W - 4);
        expect(t.top).toBeGreaterThanOrEqual(4);
      }
      for (let i = 0; i < out.length; i++)
        for (let j = i + 1; j < out.length; j++) {
          const a = out[i]!;
          const c = out[j]!;
          const wa = boxes.find((x) => x.id === a.id)!;
          expect(overlap(a, c, wa.tw, wa.th), `${a.id} / ${c.id} at ${W}`).toBe(false);
        }
    }
  });
});
