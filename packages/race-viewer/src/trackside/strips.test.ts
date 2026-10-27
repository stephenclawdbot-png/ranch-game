import { describe, expect, it } from "vitest";
import type { HorseAppearance } from "@thoroughbred/shared";
import { buildLut, downsampleFrames, frameOrigin, indexStrip, LUT_FLAG_X, LUT_W, newPalette, primaryIndices, silkBoxes } from "./strips";
import { lookFor } from "./looks";

const KEYS = { coat: ["#401115", "#843216", "#ed8f39"], silksPrimary: ["#90097b", "#f344cc"], silksSecondary: ["#0e8dac", "#36e1ec"], cap: ["#ae1397"] };
const hex = (h: string) => [Number.parseInt(h.slice(1, 3), 16), Number.parseInt(h.slice(3, 5), 16), Number.parseInt(h.slice(5, 7), 16)];

/** Two 6x4 frames: coat body with a 2x2 silks block, transparent border column. */
function strip(): Uint8Array {
  const W = 12;
  const H = 4;
  const d = new Uint8Array(W * H * 4);
  for (let f = 0; f < 2; f++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < 5; x++) {
        const c = x >= 1 + f && x <= 2 + f && y <= 1 ? "#f344cc" : y === 3 ? "#401115" : "#843216";
        const i = (y * W + f * 6 + x) * 4;
        d.set([...hex(c), 255], i);
      }
    }
  }
  return d;
}

const look = (coat: HorseAppearance["coat"], pattern: HorseAppearance["silks"]["pattern"]): HorseAppearance =>
  ({ coat, silks: { primary: "#1f4e9c", secondary: "#f3e7c9", cap: "#1f4e9c", pattern } }) as HorseAppearance;

describe("trackside strips", () => {
  it("indexes a keyed strip into a shared palette and a frame grid", () => {
    const pal = newPalette();
    const s = indexStrip(strip(), 12, 4, 2, pal, { x: 5, y: 4 }, null, 8)!;
    expect(s.cols).toBe(1); // 8 px max width -> one frame per row
    expect(s.width).toBe(6);
    expect(s.height).toBe(8);
    expect(pal.colours.length).toBe(4); // transparent + 3 colours
    const [ox, oy] = frameOrigin(s, 1);
    expect([ox, oy]).toEqual([0, 4]);
    expect(s.index[oy * s.width + 5]).toBe(0); // transparent column stays 0
  });

  it("downsamples by block mode and keeps exact palette indices", () => {
    const pal = newPalette();
    const s = indexStrip(strip(), 12, 4, 2, pal, { x: 5, y: 4 }, null)!;
    const d = downsampleFrames(s, 2, pal);
    expect(d.fw).toBe(3);
    expect(d.fh).toBe(2);
    expect(d.anchor).toEqual({ x: 2.5, y: 2 });
    for (const k of d.index) expect(k).toBeLessThan(pal.colours.length);
    expect(new Set(d.index).size).toBeGreaterThan(1);
  });

  it("builds per-runner LUT rows with recoloured coat and silks and a pattern half", () => {
    const pal = newPalette();
    const s = indexStrip(strip(), 12, 4, 2, pal, { x: 5, y: 4 }, null)!;
    const lut = buildLut(pal, KEYS, [look("grey", "solid"), look("black", "hoops")]);
    expect(lut.length).toBe(LUT_W * 2 * 4);
    const silk = pal.lookup.get(0xf344cc)!;
    // primary silks key -> the runner's primary colour family (blue), not the magenta key
    const r0 = (0 * LUT_W + silk) * 4;
    expect(lut[r0 + 2]!).toBeGreaterThan(lut[r0]!);
    // solid silks: no pattern colour; hoops: a pattern colour exists
    expect(lut[(0 * LUT_W + 64 + silk) * 4 + 3]).toBe(0);
    expect(lut[(1 * LUT_W + 64 + silk) * 4 + 3]).toBe(255);
    // coat differs between a grey and a black runner
    const coat = pal.lookup.get(0x843216)!;
    expect(lut[(0 * LUT_W + coat) * 4]).not.toBe(lut[(1 * LUT_W + coat) * 4]);
    const boxes = silkBoxes(s, primaryIndices(pal, KEYS));
    expect(Array.from(boxes.slice(0, 4))).toEqual([1, 0, 2, 2]);
    expect(Array.from(boxes.slice(4, 8))).toEqual([2, 0, 2, 2]);
  });

  it("packs the dun flag into the marking-flags column (B byte) per runner", () => {
    const pal = newPalette();
    const s = indexStrip(strip(), 12, 4, 2, pal, { x: 5, y: 4 }, null)!;
    const FLAG_X = LUT_FLAG_X;
    const lut = buildLut(pal, KEYS, [{ ...look("buckskin", "solid"), dun: true }, look("bay", "solid")]);
    expect(lut[(0 * LUT_W + FLAG_X) * 4 + 2]).toBe(1); // dun: dorsal stripe + leg barring
    expect(lut[(1 * LUT_W + FLAG_X) * 4 + 2]).toBe(0);
  });
});

describe("trackside looks", () => {
  it("dusk by default, golden on clear afternoons, dim for rain", () => {
    expect(lookFor("dusk", 14).id).toBe("dusk");
    expect(lookFor("clear", 20).id).toBe("dusk");
    expect(lookFor("clear", null).id).toBe("dusk");
    expect(lookFor("clear", 12).id).toBe("golden");
    expect(lookFor("rain", 12).brightness).toBeLessThan(1);
    expect(lookFor("overcast", 12).saturation).toBeLessThan(1);
  });
});
