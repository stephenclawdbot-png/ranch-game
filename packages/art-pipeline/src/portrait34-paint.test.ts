/**
 * Genetic 3/4 portrait: the gene -> look mapping, and the recolour on the real served art
 * (deterministic, fixed roles untouched, warps valid, ping-pong frames copied exactly).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { HorseAppearance, HorseColour } from "@thoroughbred/shared";
import { COAT_PALETTES, coatPaletteOf } from "./palettes";
import {
  PORTRAIT_ART_SIZE as S,
  PORTRAIT_ROLES,
  fitPaintedRamp,
  paintGeneticPortrait,
  portraitCacheKey,
  portraitLookOf,
  portraitRecolours,
  type PortraitLook,
} from "./portrait34";

const SILKS = { primary: "#123456", secondary: "#abcdef", pattern: "solid", cap: "#123456" } as const;
const plain: HorseColour = { base: "bay", cream: 0, dun: false, roan: false, grey: "none", sabino: 0 };
const horse = (colour: Partial<HorseColour> | null, over: Partial<HorseAppearance> = {}): HorseAppearance => ({
  coat: "bay",
  face: "none",
  legs: ["none", "none", "none", "none"],
  silks: SILKS,
  ...(colour ? { colour: { ...plain, ...colour } } : {}),
  ...over,
});

describe("portraitLookOf: genes -> palette and patterns", () => {
  it("legacy appearances (no colour) keep the painting; layered genetics recolour", () => {
    expect(portraitRecolours(horse(null))).toBe(false);
    expect(portraitRecolours(horse({}))).toBe(true);
  });

  it("takes the coat ramp from coatPaletteOf (bay anchor)", () => {
    const l = portraitLookOf(horse({}));
    expect(l.coat).toEqual({ shade: COAT_PALETTES.bay.shade, base: COAT_PALETTES.bay.body, highlight: COAT_PALETTES.bay.highlight });
    expect(l.mane.base).toBe(COAT_PALETTES.bay.mane);
    expect(l.eye).toBeNull();
    expect(l.texture).toBe("none");
    expect(l.face).toBe("none");
  });

  it("two cream: blue eye and pink skin; grullo: dark head", () => {
    const cremello = portraitLookOf(horse({ base: "chestnut", cream: 2 }, { coat: "palomino" }));
    expect(cremello.eye).toBe("#7fa8c9");
    expect(cremello.muzzle).toBe("#d9a99a");
    expect(portraitLookOf(horse({ base: "black", dun: true }, { coat: "grey" })).darkHead).not.toBeNull();
    expect(portraitLookOf(horse({ base: "black" }, { coat: "black" })).darkHead).toBeNull();
  });

  it("roan, greying and varnish textures; greys hide roan and leopard", () => {
    expect(portraitLookOf(horse({ roan: true })).texture).toBe("roan");
    expect(portraitLookOf(horse({ grey: "greying" })).texture).toBe("greying");
    expect(portraitLookOf(horse({ leopard: "varnish" })).texture).toBe("varnish");
    const white = portraitLookOf(horse({ grey: "white", roan: true, leopard: "leopard" }, { coat: "grey" }));
    expect(white.texture).toBe("none");
    expect(white.leopard).toBe("none");
  });

  it("champagne: its own palette, amber eye, freckled skin", () => {
    const gold = portraitLookOf(horse({ base: "chestnut", champagne: true }, { coat: "chestnut" }));
    expect(gold.coat.base).not.toBe(COAT_PALETTES.chestnut.body);
    expect(gold.eye).toBe("#b5852f");
    expect(gold.freckles).toBe("champagne");
    const classic = coatPaletteOf(horse({ base: "black", champagne: true }));
    expect(classic.body).not.toBe(COAT_PALETTES.black.body);
  });

  it("silver shows only on black pigment's mane and body; pearl pales the coat", () => {
    const silverBlack = coatPaletteOf(horse({ base: "black", silver: true }));
    expect(silverBlack.mane).toBe("#d9cfc0");
    expect(silverBlack.body).not.toBe(COAT_PALETTES.black.body);
    const silverBay = coatPaletteOf(horse({ silver: true }));
    expect(silverBay.body).toBe(COAT_PALETTES.bay.body);
    expect(silverBay.mane).toBe("#d9cfc0");
    const pearl = coatPaletteOf(horse({ base: "chestnut", pearl: true }));
    const lum = (h: string) => Number.parseInt(h.slice(1, 3), 16) + Number.parseInt(h.slice(3, 5), 16) + Number.parseInt(h.slice(5, 7), 16);
    expect(lum(pearl.body)).toBeGreaterThan(lum(COAT_PALETTES.chestnut.body));
    expect(coatPaletteOf(horse({ base: "chestnut", cream: 1, pearl: true })).eye).toBe("#8fb09f");
  });

  it("splash raises the face (one copy at least a blaze, two a bald face and white throat) and blues the eye", () => {
    const one = portraitLookOf(horse({ splash: 1 }, { face: "star" }));
    expect(one.face).toBe("blaze");
    expect(one.eye).toBe("#7fa8c9");
    expect(portraitLookOf(horse({ splash: 1 }, { face: "bald" })).face).toBe("bald");
    const two = portraitLookOf(horse({ splash: 2 }));
    expect(two.face).toBe("bald");
    expect(two.throat).toBe(true);
  });

  it("white patterns and skin come through; markings stay as named", () => {
    expect(portraitLookOf(horse({ tobiano: 2 })).tobiano).toBe(2);
    expect(portraitLookOf(horse({ leopard: "fewspot" })).leopard).toBe("fewspot");
    expect(portraitLookOf(horse({ leopard: "leopard" })).freckles).toBe("mottled");
    expect(portraitLookOf(horse({ sabino: 2 }, { face: "stripe" }))).toMatchObject({ sabino: 2, face: "stripe" });
  });

  it("the pattern seed depends on the genes and face only (never silks or legs)", () => {
    const a = portraitLookOf(horse({ tobiano: 1 }));
    const b = portraitLookOf(horse({ tobiano: 1 }, { silks: { ...SILKS, primary: "#ffffff" }, legs: ["sock", "none", "none", "none"] }));
    expect(b.seed).toBe(a.seed);
    expect(portraitLookOf(horse({ tobiano: 2 })).seed).not.toBe(a.seed);
    expect(portraitCacheKey(horse({ tobiano: 1 }), 1)).not.toBe(portraitCacheKey(horse({ tobiano: 2 }), 1));
  });
});

// ----------------------------------------------------------------------------- real art

const ART = join(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/public/art/portraits");

/** Minimal PNG reader: 8-bit RGBA, non-interlaced (what the portrait scripts write). */
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

const hash = (a: Uint8ClampedArray) => createHash("sha256").update(a).digest("hex");

describe.skipIf(!existsSync(join(ART, "roles.png")))("genetic portrait on the served art", () => {
  const index = JSON.parse(readFileSync(join(ART, "anim/index.json"), "utf8")) as Record<string, { frames: number; kept: number }>;
  const roles = readPng(join(ART, "roles.png")).data;
  const marks = readPng(join(ART, "portrait-marks.png")).data;
  const load = (coat: string) => {
    const still = readPng(join(ART, `horse-${coat}.png`)).data;
    const strip = readPng(join(ART, `anim/horse-${coat}.png`));
    const warp = readPng(join(ART, `anim/warp/horse-${coat}.png`));
    return { still, strip, warp, ramp: fitPaintedRamp(still, roles) };
  };
  const paint = (look: PortraitLook, coat: string) => {
    const a = load(coat);
    return { a, out: paintGeneticPortrait(look, { pixels: a.strip.data, frames: index[coat]!.frames, kept: index[coat]!.kept, warp: a.warp.data, roles, marks, ramp: a.ramp }) };
  };

  it("every idle loop has a warp of the same size pointing at opaque still pixels", () => {
    for (const coat of Object.keys(index)) {
      const { still, strip, warp } = load(coat);
      expect([warp.w, warp.h], coat).toEqual([strip.w, strip.h]);
      expect(strip.w, coat).toBe(S * index[coat]!.frames);
      let alphaMismatch = 0;
      let clearSource = 0;
      for (let i = 0; i < warp.data.length; i += 4) {
        if (warp.data[i + 3]! > 0 !== strip.data[i + 3]! > 0) alphaMismatch++;
        if (!warp.data[i + 3]) continue;
        if (still[(warp.data[i + 1]! * S + warp.data[i]!) * 4 + 3] === 0) clearSource++;
      }
      expect({ coat, alphaMismatch, clearSource }).toEqual({ coat, alphaMismatch: 0, clearSource: 0 });
    }
  }, 30_000);

  it("is deterministic: the same genes give the same pixels", () => {
    const look = portraitLookOf(horse({ base: "chestnut", tobiano: 2, sabino: 1 }, { coat: "chestnut", face: "blaze" }));
    expect(hash(paint(look, "chestnut").out)).toBe(hash(paint(portraitLookOf(horse({ base: "chestnut", tobiano: 2, sabino: 1 }, { coat: "chestnut", face: "blaze" })), "chestnut").out));
  });

  it("leaves the outline, bridle and the unrecoloured eye as painted (exactly on the still frame)", () => {
    const look = portraitLookOf(horse({ base: "black", cream: 1, roan: true }, { coat: "black", face: "bald" }));
    const { a, out } = paint(look, "black");
    const W = S * index.black!.frames;
    let fixed = 0;
    let kept = 0;
    for (let i = 0; i < out.length; i += 4) {
      if (!a.warp.data[i + 3]) {
        expect(out[i + 3]).toBe(0);
        continue;
      }
      const j = (a.warp.data[i + 1]! * S + a.warp.data[i]!) * 4;
      const role = Math.round(roles[j]! / 28);
      if (role !== PORTRAIT_ROLES.ink && role !== PORTRAIT_ROLES.leather && role !== PORTRAIT_ROLES.metal && role !== PORTRAIT_ROLES.eye) continue;
      const same = out[i] === a.strip.data[i] && out[i + 1] === a.strip.data[i + 1] && out[i + 2] === a.strip.data[i + 2];
      if ((i / 4) % W < S) expect(same, `still pixel ${i / 4}`).toBe(true);
      fixed++;
      if (same) kept++;
    }
    expect(fixed).toBeGreaterThan(1000);
    // loop frames: only pixels that are not what their fixed source shows (an eyelid, a re-drawn tick) change
    expect(kept / fixed).toBeGreaterThan(0.9);
  });

  it("copies the ping-pong frames exactly and changes the coat colour", () => {
    const coat = "bay";
    const { frames, kept } = index[coat]!;
    const { a, out } = paint(portraitLookOf(horse({ base: "chestnut", cream: 2 })), coat);
    const W = S * frames;
    const frame = (buf: Uint8ClampedArray, f: number) => {
      const o = new Uint8ClampedArray(S * S * 4);
      for (let y = 0; y < S; y++) o.set(buf.subarray((y * W + f * S) * 4, (y * W + (f + 1) * S) * 4), y * S * 4);
      return hash(o);
    };
    for (let f = kept; f < frames; f++) expect(frame(out, f)).toBe(frame(out, 2 * (kept - 1) - f));
    expect(frame(out, 0)).not.toBe(frame(a.strip.data, 0));
  });

  it("draws the face marking: a bald face is mostly white on the face front", () => {
    const { out } = paint(portraitLookOf(horse({}, { face: "bald" })), "bay");
    const W = S * index.bay!.frames;
    const at = (x: number, y: number) => (y * W + x) * 4;
    const i = at(36, 58); // the face front, frame 0
    expect(out[i]! + out[i + 1]! + out[i + 2]!).toBeGreaterThan(600);
    const { out: plainOut } = paint(portraitLookOf(horse({})), "bay");
    expect(plainOut[i]! + plainOut[i + 1]! + plainOut[i + 2]!).toBeLessThan(450);
  });
});
