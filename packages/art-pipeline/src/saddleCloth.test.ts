/**
 * Saddle cloths (visual research V-03): the cloth found in every frame of every race and parade
 * strip is cloth-keyed, hangs at or below the horse's back line (never the rider's breeches),
 * carries a readable number box, and the gate colours are the racecard's single definition.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCoatGeometry, CLOTH_GLYPH_H, CLOTH_GLYPH_W, clothGlyphHit, clothKeySet, paintSaddleCloth, rgbaRoleGrid, rgbaSaddleCloth, SADDLE_CLOTHS, saddleClothOf } from "./index";
import { readPng } from "./testPng";

const ART = join(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/public/art");
const has = existsSync(join(ART, "race/palette.json"));
const PAL = has ? (JSON.parse(readFileSync(join(ART, "race/palette.json"), "utf8")) as { coat: string[]; mane: string[]; points: string[]; cap: string[]; fixed: { white: string[] } }) : null;

/** Every strip a runner is drawn from on race day, with its frame width. */
const STRIPS: [string, number][] = [
  ["race/horse-gallop.png", 229],
  ["race/horse-gallop-f.png", 229],
  ["race/horse-idle.png", 256],
  ["race/horse-break.png", 256],
  ["race/horse-drive.png", 256],
  ["race/horse-lunge.png", 256],
  ["race/horse-easeup.png", 256],
  ["race/horse-celebrate.png", 256],
  ["race/horse-pullup.png", 256],
  ["diorama/horse-walk-jockey.png", 256],
  ["diorama/horse-walk-jockey-f.png", 256],
  ["diorama/horse-canter.png", 229],
];

describe("saddle cloth colours", () => {
  it("are the racecard's twelve gate colours, repeating from gate 13", () => {
    expect(SADDLE_CLOTHS.map((c) => c.cloth)).toEqual(["#c8242f", "#f4efe3", "#2346a8", "#f2d24a", "#1f8a4c", "#1a1a1a", "#e8742a", "#e47aa5", "#3fb8b0", "#5b2f8f", "#a9b0b8", "#9ccc3a"]);
    expect(saddleClothOf(1)).toEqual({ cloth: "#c8242f", number: "#ffffff", gate: 1 });
    expect(saddleClothOf(13)!.cloth).toBe(SADDLE_CLOTHS[0]!.cloth);
    expect(saddleClothOf(0)).toBeNull();
  });

  it("print every gate number in the 5x5 box (narrow '1' for 10-19)", () => {
    const draw = (g: number) => Array.from({ length: CLOTH_GLYPH_H }, (_, y) => Array.from({ length: CLOTH_GLYPH_W }, (_, x) => (clothGlyphHit(g, x, y) ? "#" : ".")).join("")).join("/");
    expect(draw(7)).toBe(".###./...#./..#../..#../..#..");
    expect(draw(12)).toBe("#.###/#...#/#.###/#.#../#.###");
    expect(draw(1)).toBe("..#../.##../..#../..#../.###.");
    for (let g = 1; g <= 16; g++) expect(draw(g)).toMatch(/#/);
  });
});

describe.skipIf(!has)("saddle cloth on the strips", () => {
  for (const [file, fw] of STRIPS) {
    const path = join(ART, file);
    if (!existsSync(path)) continue;
    it(`${file}: the cloth is found in every frame, cloth-keyed, at the horse's back, with a number box`, () => {
      const png = readPng(path);
      const geo = buildCoatGeometry(rgbaRoleGrid(png.data, png.w, png.h, fw, PAL!));
      const keys = clothKeySet(PAL!.fixed.white);
      const cm = rgbaSaddleCloth(png.data, png.w, fw, keys, geo);
      let numbered = 0;
      for (let f = 0; f < cm.frames; f++) {
        let n = 0;
        let above = 0;
        for (let y = 0; y < cm.fh; y++)
          for (let x = 0; x < cm.fw; x++) {
            const k = (f * cm.fh + y) * cm.fw + x;
            if (!cm.mask[k]) continue;
            n++;
            const i = (y * png.w + f * fw + x) * 4;
            // only the white keys are cloth (the coat, tack, skin and silks never are)
            expect(keys.has((png.data[i]! << 16) | (png.data[i + 1]! << 8) | png.data[i + 2]!)).toBe(true);
            // the cloth's top edge rides a little above the back line; the breeches sit well above it
            if (geo.v[k]! < -0.3 * geo.H) above++;
          }
        expect(n, `frame ${f}`).toBeGreaterThan(0.06 * geo.H * geo.H);
        expect(above, `frame ${f}: texels far above the back line`).toBe(0);
        if (cm.boxes[f]!.number) numbered++;
      }
      // the number box: in (nearly) every frame, the same cell size, on the cloth
      expect(numbered).toBeGreaterThanOrEqual(Math.ceil(cm.frames * 0.9));
      const cells = new Set(cm.boxes.filter((b) => b.number).map((b) => b.number![2]));
      expect(cells.size).toBe(1);
      for (let k = 0; k < cm.mask.length; k++) if (cm.glyph[k] !== 255) expect(cm.mask[k]).toBe(2);
    });
  }

  it("paints the gate colour shaded by the white key, the number in the number colour, nothing else", () => {
    const [file, fw] = STRIPS[0]!;
    const png = readPng(join(ART, file));
    const geo = buildCoatGeometry(rgbaRoleGrid(png.data, png.w, png.h, fw, PAL!));
    const cm = rgbaSaddleCloth(png.data, png.w, fw, clothKeySet(PAL!.fixed.white), geo);
    const out = new Uint8ClampedArray(png.data);
    paintSaddleCloth(out, png.w, fw, cm, saddleClothOf(3)!);
    let changed = 0;
    let blue = 0;
    let ink = 0;
    for (let f = 0; f < cm.frames; f++)
      for (let y = 0; y < cm.fh; y++)
        for (let x = 0; x < cm.fw; x++) {
          const i = (y * png.w + f * fw + x) * 4;
          const k = (f * cm.fh + y) * cm.fw + x;
          const diff = out[i] !== png.data[i] || out[i + 1] !== png.data[i + 1] || out[i + 2] !== png.data[i + 2];
          if (!cm.mask[k]) {
            expect(diff).toBe(false);
            continue;
          }
          changed++;
          // gate 3: royal blue cloth (b > r), white number
          if (out[i + 2]! > out[i]! + 40) blue++;
          if (out[i]! > 200 && out[i + 1]! > 200 && out[i + 2]! > 200) ink++;
        }
    expect(changed).toBeGreaterThan(0);
    expect(blue / changed).toBeGreaterThan(0.6);
    expect(ink).toBeGreaterThan(cm.frames * 5);
  });
});
