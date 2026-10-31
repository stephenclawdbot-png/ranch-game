import { describe, expect, it } from "vitest";
import { ORGANIC_MID, taperCutEdges } from "./edgeTaper";

/** A w×h image opaque from row `top` down, every column (a block cut at both edges). */
function block(w: number, h: number, top: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = top; y < h; y++) for (let x = 0; x < w; x++) d[(y * w + x) * 4 + 3] = 255;
  return d;
}
const heightAt = (d: Uint8ClampedArray, w: number, h: number, x: number) => {
  for (let y = 0; y < h; y++) if (d[(y * w + x) * 4 + 3]! >= 128) return h - y;
  return 0;
};

describe("taperCutEdges", () => {
  it("slopes both cut sides down to the ground and leaves the middle alone", () => {
    const w = 200, h = 60;
    const d = block(w, h, 20); // 40 rows tall at both edges
    expect(taperCutEdges(d, w, h)).toEqual({ left: true, right: true });
    expect(heightAt(d, w, h, 0)).toBeLessThan(12);
    expect(heightAt(d, w, h, w - 1)).toBeLessThan(12);
    for (let x = 1; x < 32; x++) expect(heightAt(d, w, h, x)).toBeGreaterThanOrEqual(heightAt(d, w, h, x - 1));
    expect(heightAt(d, w, h, 100)).toBe(40);
  });
  it("leaves art that already ends inside the image untouched", () => {
    const w = 50, h = 20;
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 10; y < h; y++) for (let x = 10; x < 40; x++) d[(y * w + x) * 4 + 3] = 255;
    const before = d.slice();
    expect(taperCutEdges(d, w, h)).toEqual({ left: false, right: false });
    expect(d).toEqual(before);
  });
  it("rounds plants and sand, never buildings or lamps", () => {
    for (const f of ["course/mid-dunes.png", "course/mid-willow.png", "course/mid-hawthorn.png", "course/mid-flowers.png"]) expect(ORGANIC_MID.test(f)).toBe(true);
    for (const f of ["course/mid-terrace.png", "course/mid-lamp.png", "course/mid-wall.png", "course/rail-boards.png"]) expect(ORGANIC_MID.test(f)).toBe(false);
  });
});
