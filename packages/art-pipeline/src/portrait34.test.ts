import { describe, expect, it } from "vitest";
import type { HorseAppearance } from "@thoroughbred/shared";
import { downsampleAlpha2x, hexToRgb, portraitCacheKey, portraitManeStops, portraitNoise, portraitRamp } from "./portrait34";

describe("portraitRamp", () => {
  const shade = "#5a2a16";
  const body = "#8a4527";
  const hi = "#b5683d";

  it("hits the four stops exactly (shade x 0.55 -> shade -> body -> highlight)", () => {
    expect(portraitRamp(0, shade, body, hi)).toEqual(hexToRgb(shade).map((v) => Math.round(v * 0.55)));
    expect(portraitRamp(0.25, shade, body, hi)).toEqual(hexToRgb(shade));
    expect(portraitRamp(0.6, shade, body, hi)).toEqual(hexToRgb(body));
    expect(portraitRamp(1, shade, body, hi)).toEqual(hexToRgb(hi));
  });

  it("is monotone in lightness across the range and clamps out-of-range levels", () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const [r, g, b] = portraitRamp(i / 20, shade, body, hi);
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
    expect(portraitRamp(1.4, shade, body, hi)).toEqual(hexToRgb(hi));
  });
});

describe("portraitManeStops", () => {
  it("gives dark manes a black root and a warm sheen (never lighter than the sheen)", () => {
    const s = portraitManeStops("#17100d");
    expect(s.shade).toBe("#000000");
    expect(s.base).toBe("#17100d");
    const [r] = hexToRgb(s.highlight);
    expect(r).toBeGreaterThan(0x17); // sheen lifts the strands
    expect(hexToRgb(s.highlight)[2]).toBeGreaterThan(13);
  });

  it("gives flaxen manes a darker shade and a pale sheen (never near black)", () => {
    const s = portraitManeStops("#f3ead2");
    const shadeL = hexToRgb(s.shade).reduce((a, b) => a + b, 0);
    const baseL = hexToRgb(s.base).reduce((a, b) => a + b, 0);
    const hiL = hexToRgb(s.highlight).reduce((a, b) => a + b, 0);
    expect(shadeL).toBeLessThan(baseL);
    expect(hiL).toBeGreaterThan(baseL);
    expect(hexToRgb(s.shade)[0]).toBeGreaterThan(0x60); // sandy, not black
  });
});

describe("portraitNoise", () => {
  it("is deterministic and in [0, 1)", () => {
    for (const [x, y] of [[0, 0], [5, 7], [63, 19], [128, 255]] as const) {
      const v = portraitNoise(x, y);
      expect(v).toBe(portraitNoise(x, y));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("downsampleAlpha2x", () => {
  it("averages colour by alpha and keeps alpha hard (portrait_anims.py down2)", () => {
    // 4x2: block 0 = opaque greys 10, 30 over 20 and a clear pixel; block 1 = one opaque red + three clear
    const px = [10, 10, 10, 255, 30, 30, 30, 255, 200, 0, 0, 255, 0, 0, 0, 0, 20, 20, 20, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const out = downsampleAlpha2x(px, 4, 2);
    expect([...out.slice(0, 4)]).toEqual([20, 20, 20, 255]);
    expect([...out.slice(4, 8)]).toEqual([200, 0, 0, 0]);
  });
});

describe("portraitCacheKey", () => {
  const base = {
    coat: "bay",
    face: "none",
    legs: ["none", "none", "none", "none"],
    silks: { primary: "#123456", secondary: "#abcdef", pattern: "solid", cap: "#123456" },
  } as unknown as HorseAppearance;

  it("ignores fields that do not change the portrait pixels (silks, legs)", () => {
    const a = { ...base, legs: ["sock", "none", "none", "none"], silks: { primary: "#ffffff", secondary: "#000000", pattern: "hoops", cap: "#101010" } } as unknown as HorseAppearance;
    expect(portraitCacheKey(a, 2)).toBe(portraitCacheKey(base, 2));
  });

  it("changes with face marking, scale, mane override and genetics", () => {
    const k = portraitCacheKey(base, 2);
    expect(portraitCacheKey({ ...base, face: "blaze" } as HorseAppearance, 2)).not.toBe(k);
    expect(portraitCacheKey(base, "thumb")).not.toBe(k);
    expect(portraitCacheKey({ ...base, maneColor: "#ff0000" } as HorseAppearance, 2)).not.toBe(k);
    expect(portraitCacheKey({ ...base, colour: { base: "chestnut", cream: 1, dun: false, roan: false, grey: "none", sabino: 0 } } as HorseAppearance, 2)).not.toBe(k);
  });

  it("is stable across differently ordered but equal genetics objects", () => {
    const colour = { base: "bay", cream: 0, dun: true, roan: false, grey: "none", sabino: 0 };
    const reordered = { sabino: 0, grey: "none", roan: false, dun: true, cream: 0, base: "bay" };
    const a = { ...base, colour } as HorseAppearance;
    const b = { ...base, colour: reordered } as HorseAppearance;
    expect(portraitCacheKey(a, 1)).toBe(portraitCacheKey(b, 1));
  });
});
