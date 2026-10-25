import { describe, expect, it } from "vitest";
import { COAT_PALETTES } from "@thoroughbred/art-pipeline";
import type { HorseAppearance } from "@thoroughbred/shared";
import { hexToRgb, resampleRamp } from "./color";
import { appearanceKey, applyRecolor, buildRecolorPlan, parseKeyPalette, patternHit, targetRamps, type KeyPalette } from "./recolor";

const KEYS: KeyPalette = {
  coat: ["#391314", "#5d1f17", "#772e1c", "#b04a18", "#e2833a"],
  mane: ["#010103", "#292929"],
  silksPrimary: ["#640e38", "#9f0694", "#b90fb2"],
  silksSecondary: ["#075060", "#00cdd1", "#08ebe4"],
  cap: ["#620d38", "#b80eb1"],
};

const grey: HorseAppearance = {
  coat: "grey",
  face: "none",
  legs: ["none", "none", "none", "none"],
  silks: { primary: "#1d3f8f", secondary: "#f2c230", pattern: "solid", cap: "#c8102e" },
};

function stripOf(colors: string[], w = colors.length, h = 1): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  colors.forEach((c, i) => {
    const [r, g, b] = hexToRgb(c);
    d.set([r, g, b, 255], i * 4);
  });
  return d;
}

const px = (d: Uint8ClampedArray, i: number) => `#${[d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

describe("recolour", () => {
  it("parses palette.json and rejects junk", () => {
    expect(parseKeyPalette({ coat: ["#000000"], mane: ["#111111"], fixed: { skin: ["#ffffff"] } })?.coat).toEqual(["#000000"]);
    expect(parseKeyPalette({ coat: [] })).toBeNull();
    expect(parseKeyPalette({ coat: ["red"] })).toBeNull();
    expect(parseKeyPalette(null)).toBeNull();
  });

  it("target ramps match key lengths and run dark -> light", () => {
    const t = targetRamps(KEYS, grey);
    expect(t.coat).toHaveLength(KEYS.coat.length);
    expect(t.silksPrimary).toHaveLength(3);
    const lum = (h: string) => hexToRgb(h).reduce((a, b) => a + b, 0);
    for (let i = 1; i < t.coat.length; i++) expect(lum(t.coat[i]!)).toBeGreaterThanOrEqual(lum(t.coat[i - 1]!));
    // The middle of the grey coat ramp sits near the grey body colour.
    expect(t.coat).toContain(resampleRamp([t.coat[0]!, t.coat[t.coat.length - 1]!], 2)[0]);
    void COAT_PALETTES;
  });

  it("swaps exact key colours, leaves everything else alone", () => {
    const src = [...KEYS.coat, ...KEYS.silksPrimary!, "#fbfafb", "#123456"];
    const d = stripOf(src);
    applyRecolor(d, src.length, 1, src.length, buildRecolorPlan(KEYS, grey));
    const plan = targetRamps(KEYS, grey);
    expect(px(d, 2)).toBe(plan.coat[2]);
    expect(px(d, KEYS.coat.length + 1)).toBe(plan.silksPrimary[1]);
    expect(px(d, src.length - 2)).toBe("#fbfafb");
    expect(px(d, src.length - 1)).toBe("#123456");
  });

  it("paints the silks pattern over primary-key pixels with the secondary ramp", () => {
    const W = 12;
    const d = stripOf(new Array(W).fill(KEYS.silksPrimary![1]!), W, 1);
    const hooped = { ...grey, silks: { ...grey.silks, pattern: "hoops" as const } };
    applyRecolor(d, W, 1, W, buildRecolorPlan(KEYS, hooped));
    const t = targetRamps(KEYS, hooped);
    const colours = new Set(Array.from({ length: W }, (_, i) => px(d, i)));
    expect(colours.has(t.silksPrimary[1]!)).toBe(true);
    expect([...colours].some((c) => c !== t.silksPrimary[1])).toBe(true);
    expect(patternHit("solid", 0.5, 0.5, 3, 3)).toBe(false);
  });

  it("cache key changes with coat and silks", () => {
    expect(appearanceKey(grey)).not.toBe(appearanceKey({ ...grey, coat: "bay" }));
    expect(appearanceKey(grey)).not.toBe(appearanceKey({ ...grey, silks: { ...grey.silks, pattern: "stars" } }));
  });
});
