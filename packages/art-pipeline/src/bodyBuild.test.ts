/**
 * Body build (V-04) and mane / tail (V-05) on the painted strips: old looks draw exactly as
 * before, every frame of every sheet keeps its hooves on the ground line, the warp is a pure
 * remap of the painted pixels (so patterns and markings ride with the body), and the hair stays
 * on the horse and off the rider.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { HorseAppearance, HorseColour } from "@thoroughbred/shared";
import {
  HORSE_SHEETS,
  MANE_LEVEL,
  TAIL_LEVEL,
  atlasFromRgba,
  buildCoatGeometry,
  buildTexels,
  cpuWarpClass,
  hairLevels,
  hairShows,
  lookShapeKey,
  paintCoatStrip,
  rgbaRoleGrid,
  setBuildSwitch,
  sheetHairField,
  sheetSpeed,
  sheetWarpAnchors,
  warpSource,
  type CoatAtlas,
} from "./index";
import { readPng } from "./testPng";

const ART = join(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/public/art");
const has = existsSync(join(ART, "race/coat-layers.png"));
const KEYS = has ? (JSON.parse(readFileSync(join(ART, "race/palette.json"), "utf8")) as { coat: string[]; mane: string[]; points: string[]; cap: string[] }) : null;
const SILKS = { primary: "#1f4e9c", secondary: "#f3e7c9", cap: "#c0392b", pattern: "solid" } as const;
const look = (c: Partial<HorseColour>, a: Partial<HorseAppearance> = {}): HorseAppearance =>
  ({ coat: "bay", face: "none", legs: ["none", "none", "none", "none"], silks: SILKS, colour: { base: "bay", cream: 0, dun: false, roan: false, grey: "none", sabino: 0, markSeed: 91, ...c }, ...a }) as HorseAppearance;

const FLAT = { height: 0, leg: 0, neck: 0, girth: 0, head: 0 };
const BUILDS = [
  { height: 2, leg: 2, neck: 2, girth: -2, head: 2 },
  { height: -2, leg: -2, neck: -2, girth: 2, head: -2 },
  { height: 0, leg: 1, neck: 2, girth: 2, head: 0 },
];
const MARKED = look({ tobiano: 1 }, { face: "blaze", legs: ["stocking", "sock", "coronet", "none"] });

let atlasMemo: CoatAtlas | null = null;
const atlas = () => {
  if (!atlasMemo) {
    const a = readPng(join(ART, "race/coat-layers.png"));
    atlasMemo = atlasFromRgba(a.data, a.w, a.h, 1);
  }
  return atlasMemo;
};
const sheets = has ? HORSE_SHEETS.map((s) => ({ ...s, img: readPng(join(ART, `${s.stem}.png`)) })) : [];
const geoOf = (s: (typeof sheets)[number]) => {
  const fw = Math.floor(s.img.w / s.frames);
  return { fw, geo: buildCoatGeometry(rgbaRoleGrid(s.img.data, s.img.w, s.img.h, fw, KEYS!)) };
};
const paint = (s: (typeof sheets)[number], geo: ReturnType<typeof geoOf>["geo"], fw: number, a: HorseAppearance) => paintCoatStrip(s.img.data, s.img.w, fw, geo, a, atlas(), KEYS!, () => undefined, sheetSpeed(s.stem));

afterEach(() => setBuildSwitch(null));

describe.skipIf(!has)("body build on the painted strips", () => {
  it("old looks (no build, no hair), flat builds and ?build=0 draw the painted strip exactly as before", { timeout: 120_000 }, () => {
    for (const s of sheets.slice(0, 3)) {
      const { fw, geo } = geoOf(s);
      const old = paint(s, geo, fw, MARKED);
      expect(paint(s, geo, fw, { ...MARKED, build: FLAT })).toEqual(old);
      setBuildSwitch(false);
      expect(paint(s, geo, fw, { ...MARKED, build: BUILDS[0], hair: { mane: 3, tail: 2, thick: true, wave: true } })).toEqual(old);
      setBuildSwitch(null);
      expect(lookShapeKey(MARKED)).toBe("");
    }
  });

  it("every frame of every sheet: hooves stay on the ground line, the horse keeps its size, every pixel is one the painting had (patterns ride with the body)", { timeout: 240_000 }, () => {
    for (const s of sheets) {
      const { fw, geo } = geoOf(s);
      const base = paint(s, geo, fw, MARKED);
      const anchors = sheetWarpAnchors(s.img.data, s.img.w, fw, geo, KEYS!);
      for (const b of BUILDS) {
        const out = paint(s, geo, fw, { ...MARKED, build: b });
        const t = buildTexels(b, anchors);
        for (let f = 0; f < s.frames; f++) {
          const fr = anchors.frames[f]!;
          let lowIn = 0;
          let lowOut = 0;
          let nIn = 0;
          let nOut = 0;
          for (let y = 0; y < s.img.h; y++)
            for (let x = 0; x < fw; x++) {
              const o = (y * s.img.w + f * fw + x) * 4;
              if (base[o + 3]! >= 128) {
                lowIn = Math.max(lowIn, y);
                nIn++;
              }
              if (out[o + 3]! >= 128) {
                lowOut = Math.max(lowOut, y);
                nOut++;
              }
            }
          if (!fr.ok) continue;
          expect(lowOut, `${s.stem} f${f}: hooves on the ground line`).toBe(lowIn);
          expect(Math.abs(nOut - nIn) / nIn, `${s.stem} f${f}: size`).toBeLessThan(0.2);
          // the warp is a remap: each output texel shows exactly the painted texel warpSource names
          const cls = (x: number, y: number) => {
            if (x < 0 || y < 0 || x >= fw || y >= s.img.h) return 0;
            const o = (y * s.img.w + f * fw + x) * 4;
            return cpuWarpClass(geo, fr, f, x, y, base[o + 3]! >= 128, 0);
          };
          for (let y = 0; y < s.img.h; y += 2)
            for (let x = 0; x < fw; x += 2) {
              const o = (y * s.img.w + f * fw + x) * 4;
              const src = warpSource(x, y, fr, t, geo.H, cls);
              if (!src) {
                expect(out[o + 3], `${s.stem} f${f} (${x},${y}) empty`).toBe(0);
                continue;
              }
              const i = (src[1] * s.img.w + f * fw + src[0]) * 4;
              // (or nothing: a loose scrap the warp cut off is dropped, WARP_FRAGMENT)
              if (out[o + 3] === 0 && base[i + 3]! > 0) continue;
              expect([out[o], out[o + 1], out[o + 2], out[o + 3]]).toEqual([base[i], base[i + 1], base[i + 2], base[i + 3]]);
            }
        }
      }
    }
  });

  it("the same look always gives the same pixels", { timeout: 60_000 }, () => {
    const s = sheets[0]!;
    const { fw, geo } = geoOf(s);
    const a = { ...MARKED, build: BUILDS[2], hair: { mane: 2, tail: 1, thick: true, wave: false } };
    expect(paint(s, geo, fw, a)).toEqual(paint(s, geo, fw, structuredClone(a)));
  });
});

describe.skipIf(!has)("mane and tail styles", () => {
  it("grow only on the horse or empty air (never the rider or tack), never below the ground line; a longer style is the shorter one grown on", { timeout: 240_000 }, () => {
    for (const s of sheets) {
      const { fw, geo } = geoOf(s);
      const grid = rgbaRoleGrid(s.img.data, s.img.w, s.img.h, fw, KEYS!);
      const field = sheetHairField(s.img.data, s.img.w, fw, geo, KEYS!, sheetSpeed(s.stem));
      let grown = 0;
      for (const set of field.sets)
        for (let f = 0; f < s.frames; f++) {
          let ground = 0;
          for (let y = 0; y < s.img.h; y++) for (let x = 0; x < fw; x++) if (grid.role(f, x, y)) ground = Math.max(ground, y);
          for (let y = 0; y < s.img.h; y++)
            for (let x = 0; x < fw; x++) {
              const b = set[(f * s.img.h + y) * fw + x]!;
              if (!b) continue;
              grown++;
              expect(grid.role(f, x, y), `${s.stem} f${f}: hair on the rider or tack`).toBeLessThan(4);
              expect(y, `${s.stem} f${f}: hair below the ground line`).toBeLessThanOrEqual(ground);
              // nesting: whatever a shorter style shows, every longer one shows too
              for (let m = 1; m < MANE_LEVEL.length; m++)
                for (let tl = 1; tl < TAIL_LEVEL.length; tl++)
                  for (const thick of [false, true]) {
                    if (!hairShows(b, hairLevels({ mane: m, tail: tl, thick }))) continue;
                    expect(hairShows(b, hairLevels({ mane: Math.min(3, m + 1), tail: Math.min(2, tl + 1), thick: true }))).toBe(true);
                  }
            }
        }
      expect(grown, s.stem).toBeGreaterThan(s.frames * 20);
    }
  });

  it("styles differ from each other and from the painted hair; a feathered horse keeps its feathering with any style", { timeout: 120_000 }, () => {
    const s = sheets[0]!;
    const { fw, geo } = geoOf(s);
    const base = look({ base: "chestnut", flaxen: true });
    const plain = paint(s, geo, fw, base);
    const styles = [
      { mane: 0, tail: 0, thick: false, wave: false },
      { mane: 1, tail: 1, thick: false, wave: false },
      { mane: 2, tail: 1, thick: true, wave: false },
      { mane: 3, tail: 2, thick: true, wave: true },
    ];
    const outs = styles.map((h) => paint(s, geo, fw, { ...base, hair: h }));
    expect(outs[0]).toEqual(plain);
    const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
      let n = 0;
      for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 3] !== b[i + 3]) n++;
      return n;
    };
    for (let k = 1; k < outs.length; k++) expect(diff(outs[k]!, outs[k - 1]!), `style ${k}`).toBeGreaterThan(200);
    // feathering: the feathered horse's legs gain hair with a style too
    const fe = look({ base: "black" }, { feather: true });
    const withStyle = paint(s, geo, fw, { ...fe, hair: { mane: 3, tail: 2, thick: false, wave: true } });
    const unfeathered = paint(s, geo, fw, { ...look({ base: "black" }), hair: { mane: 3, tail: 2, thick: false, wave: true } });
    expect(diff(withStyle, unfeathered)).toBeGreaterThan(100);
  });
});
