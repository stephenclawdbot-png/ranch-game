/**
 * Runner identity (visual research V-03): the saddle cloth on the track, the HUD chip and the
 * racecard tile are one colour per gate. The LUT carries each runner's cloth (both views read it),
 * the shared strip mask marks the cloth (region 14) with its number cells, the chip draws the same
 * colour, and `?cloth=0` (or `clothColours: false`) gives back the white cloths.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type { HorseAppearance } from "@thoroughbred/shared";
import { buildCoatGeometry } from "@thoroughbred/art-pipeline";
import { buildLut, buildMarkMasks, clothNumberShown, CLOTH_NUMBER_MIN_CSS, indexedRoleGrid, indexStrip, LUT_CLOTH_NUM_X, LUT_CLOTH_X, LUT_W, MARK_REGION, newPalette, runnerCloths, stripSaddleCloth } from "./trackside/strips";
import { HORSE_FRAG } from "./trackside/shaders";
import { parseKeyPalette } from "./three/recolor";
import { ClothTile } from "./hud/Hud";
import { SADDLE_CLOTHS, saddleClothOf } from "./cloth";

const ART = join(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/public/art");
const has = existsSync(join(ART, "race/horse-gallop.png"));
const rgb = (h: string) => [Number.parseInt(h.slice(1, 3), 16), Number.parseInt(h.slice(3, 5), 16), Number.parseInt(h.slice(5, 7), 16)];
const look = { coat: "bay", silks: { primary: "#1f4e9c", secondary: "#f3e7c9", cap: "#1f4e9c", pattern: "solid" } } as HorseAppearance;

describe("saddle cloths: one colour per gate everywhere", () => {
  it("each runner's LUT row carries its gate's cloth and number colour (the chip's colours)", () => {
    const pal = newPalette();
    const horses = Array.from({ length: 12 }, (_, i) => ({ gate: i + 1 }));
    const lut = buildLut(pal, { coat: ["#401115"] }, horses.map(() => look), runnerCloths(horses, true));
    horses.forEach((h, row) => {
      const c = SADDLE_CLOTHS[row]!;
      const o = (row * LUT_W + LUT_CLOTH_X) * 4;
      expect([lut[o], lut[o + 1], lut[o + 2]]).toEqual(rgb(c.cloth));
      expect(lut[o + 3]).toBe(h.gate);
      const n = (row * LUT_W + LUT_CLOTH_NUM_X) * 4;
      expect([lut[n], lut[n + 1], lut[n + 2]]).toEqual(rgb(c.number));
      // the chip draws exactly that colour and number
      const el = ClothTile({ gate: h.gate }) as ReactElement<{ style: { background: string; color: string }; children: number }>;
      expect(el.props.style).toEqual({ background: c.cloth, color: c.number });
      expect(el.props.children).toBe(h.gate);
    });
  });

  it("off (`?cloth=0` / clothColours false): no cloth in the LUT, the strips' white cloths stay", () => {
    const horses = [{ gate: 1 }, { gate: 2 }];
    expect(runnerCloths(horses, false)).toEqual([null, null]);
    expect(runnerCloths(horses, true)).toEqual([saddleClothOf(1), saddleClothOf(2)]);
    const lut = buildLut(newPalette(), { coat: ["#401115"] }, [look, look], runnerCloths(horses, false));
    for (const row of [0, 1]) expect(lut[(row * LUT_W + LUT_CLOTH_X) * 4 + 3]).toBe(0);
  });

  it("prints the number only on a horse drawn large enough (>= ~120 px) from the full or half-size strip", () => {
    expect(clothNumberShown(CLOTH_NUMBER_MIN_CSS, 1)).toBe(true);
    expect(clothNumberShown(CLOTH_NUMBER_MIN_CSS, 2)).toBe(true);
    expect(clothNumberShown(CLOTH_NUMBER_MIN_CSS - 1, 1)).toBe(false);
    expect(clothNumberShown(400, 3)).toBe(false);
  });

  it("the horse shader paints region 14 from the cloth column, with the number cells", () => {
    expect(HORSE_FRAG).toContain(`lutAt(${LUT_CLOTH_X}.0, rowV)`);
    expect(HORSE_FRAG).toContain("clothInk(");
    expect(HORSE_FRAG).toContain("uClothNum");
    expect(MARK_REGION.cloth).toBe(14);
  });

  it.skipIf(!has)("the gallop strip's mask marks the cloth (region 14) in every frame, never over the rider's breeches", () => {
    const png = readPng(join(ART, "race/horse-gallop.png"));
    const keys = parseKeyPalette(JSON.parse(readFileSync(join(ART, "race/palette.json"), "utf8")))!;
    expect(keys.white?.length).toBeGreaterThan(0);
    const pal = newPalette();
    const fw = 229;
    const l1 = indexStrip(png.data, png.w, png.h, Math.floor(png.w / fw), pal, { x: 223, y: 140 }, null)!;
    const geo = buildCoatGeometry(indexedRoleGrid(l1, pal, keys));
    const cloth = stripSaddleCloth(l1, pal, keys, geo)!;
    const mask = buildMarkMasks(l1, pal, keys, geo, null, cloth);
    const white = new Set(keys.white!.map((h) => pal.lookup.get(Number.parseInt(h.slice(1), 16))));
    for (let f = 0; f < l1.frames; f++) {
      let n = 0;
      let cells = 0;
      const ox = (f % l1.cols) * l1.fw;
      const oy = Math.floor(f / l1.cols) * l1.fh;
      for (let y = 0; y < l1.fh; y++)
        for (let x = 0; x < l1.fw; x++) {
          const i = (oy + y) * l1.width + ox + x;
          if (mask[i * 4] !== MARK_REGION.cloth) continue;
          n++;
          expect(white.has(l1.index[i]!)).toBe(true);
          if (mask[i * 4 + 1] !== 255) cells++;
        }
      expect(n, `frame ${f}`).toBeGreaterThan(60);
      expect(cells, `frame ${f} number cells`).toBeGreaterThan(20);
    }
  });
});

/** Minimal 8-bit RGBA PNG reader (test only). */
function readPng(file: string): { w: number; h: number; data: Uint8ClampedArray } {
  const b = readFileSync(file);
  let o = 8;
  let w = 0;
  let h = 0;
  const idat: Buffer[] = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o);
    const type = b.toString("ascii", o + 4, o + 8);
    const d = b.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      w = d.readUInt32BE(0);
      h = d.readUInt32BE(4);
    } else if (type === "IDAT") idat.push(d);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? out[y * stride + i - 4]! : 0;
      const up = y > 0 ? out[(y - 1) * stride + i]! : 0;
      const c = i >= 4 && y > 0 ? out[(y - 1) * stride + i - 4]! : 0;
      let v = raw[y * (stride + 1) + 1 + i]!;
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) {
        const p = a + up - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      out[y * stride + i] = v & 255;
    }
  }
  return { w, h, data: out };
}
