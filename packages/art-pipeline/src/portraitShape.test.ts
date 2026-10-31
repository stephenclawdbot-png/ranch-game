import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { BREED_HEADS, PORTRAIT_ROLES, headShapeOf, headWarp, isPaintedShape, portraitCacheKey, reshapePortrait } from "./index";
import type { HorseAppearance } from "@thoroughbred/shared";

const ART = join(__dirname, "../../../apps/web/public/art/portraits");
const png = (f: string) => readPng(join(ART, f));

function readPng(file: string): { w: number; h: number; data: Uint8ClampedArray } {
  const buf = readFileSync(file);
  let o = 8;
  let w = 0;
  let h = 0;
  const idat: Buffer[] = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString("ascii", o + 4, o + 8);
    const body = buf.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new Error(`${file}: not 8-bit RGBA non-interlaced`);
    } else if (type === "IDAT") idat.push(body);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[y * stride + x - 4]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4]! : 0;
      let v = line[x]!;
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, data: out };
}



const horse = (over: Partial<HorseAppearance> = {}): HorseAppearance =>
  ({ coat: "bay", face: "star", legs: ["none", "none", "none", "none"], silks: { primary: "#000000", secondary: "#ffffff", cap: "#000000", pattern: "solid" }, ...over }) as HorseAppearance;

describe("portrait head shapes", () => {
  const roles = png("roles.png").data;

  it("gives every breed its own head, and the painting stays as it is for an unknown one", () => {
    const sigs = new Set<string>();
    for (const b of Object.keys(BREED_HEADS)) {
      const m = headWarp(headShapeOf(horse({ head: b })), roles);
      let h = 0;
      for (let i = 0; i < m.length; i++) h = (Math.imul(h, 31) + m[i]!) | 0;
      sigs.add(String(h));
    }
    expect(sigs.size).toBe(Object.keys(BREED_HEADS).length);
    expect(isPaintedShape(headShapeOf({ coat: "bay", face: "none" } as HorseAppearance))).toBe(false); // per-horse nudges always apply
  });

  it("is deterministic and part of the cache key", () => {
    const a = horse({ head: "arabian", age: "foal" });
    expect(headWarp(headShapeOf(a), roles)).toEqual(headWarp(headShapeOf(a), roles));
    expect(portraitCacheKey(a, 1)).not.toBe(portraitCacheKey(horse({ head: "arabian" }), 1));
  });

  it("draws a foal small, short-maned and without the bridle's leather", () => {
    const foal = headWarp(headShapeOf(horse({ age: "foal" })), roles);
    const adult = headWarp(headShapeOf(horse()), roles);
    const role = (p: number) => Math.round(roles[p * 4]! / 28);
    const count = (m: Int32Array, r: number) => [...m].filter((p) => p >= 0 && role(p) === r).length;
    expect([...foal].filter((p) => p >= 0).length).toBeLessThan([...adult].filter((p) => p >= 0).length * 0.85);
    expect(count(foal, PORTRAIT_ROLES.leather)).toBe(0);
    expect(count(foal, PORTRAIT_ROLES.mane)).toBeLessThan(count(adult, PORTRAIT_ROLES.mane) * 0.6);
  });

  it("reshapes a still into pixels plus a warp that points back into the still", () => {
    const still = png("horse-bay.png").data;
    const map = headWarp(headShapeOf(horse({ head: "friesian" })), roles);
    const r = reshapePortrait(still, 1, null, map);
    for (let o = 0; o < map.length; o += 97) {
      if (map[o]! < 0 || still[map[o]! * 4 + 3] === 0) continue;
      expect(r.warp[o * 4]! + r.warp[o * 4 + 1]! * 128).toBe(map[o]);
    }
  });
});
