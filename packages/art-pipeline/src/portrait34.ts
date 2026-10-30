/**
 * Genetic 3/4 portrait (pure maths, no DOM): recolours the painted head-and-neck portrait
 * (and every frame of its idle loop) from the horse's genes.
 *
 * Inputs, all built offline by apps/web/scripts/portrait-roles.py:
 *   - roles.png: per still pixel a role (coat, mane, muzzle, inner ear, eye, or a fixed
 *     role: outline ink, bridle leather, bridle metal), a shading LEVEL (the grey
 *     painting's luminance, normalised per role) and flags (face-front plane, painted star);
 *   - portrait-marks.png: the five face markings as white masks on the still;
 *   - anim/warp/horse-<coat>.png: for every idle-loop frame pixel, the still pixel it shows
 *     (the PixelLab frames re-draw the head, so roles are read through this warp).
 *
 * Colour = the gene palette's ramp by LEVEL (docs/brand-v2/portraits/portrait34-proto.py),
 * plus the painting's own achromatic detail (its luminance minus its median at that LEVEL),
 * so strokes, rim light and fur texture survive the recolour. Fixed roles keep the painted
 * pixel. White patterns are masks in still space, evaluated at each pixel's warp source,
 * so they ride with the head through the loop. Everything is integer-indexed and seeded
 * only by the genes: the same appearance always gives the same pixels.
 */
import type { FaceMarking, HorseAppearance } from "@thoroughbred/shared";
import { MARKING_WHITE, resolveHorseColors } from "./palettes";

export const PORTRAIT_ART_SIZE = 128;

/** Bump when the recolour's output pixels change (it is part of every cache key). */
export const PORTRAIT_RECOLOUR_VERSION = 1;

/** Role ids x28 in roles.png R channel (must match scripts/portrait-roles.py). */
export const PORTRAIT_ROLES = {
  clear: 0,
  ink: 1,
  leather: 2,
  metal: 3,
  eye: 4,
  coat: 5,
  mane: 6,
  muzzle: 7,
  innerEar: 8,
} as const;

/** roles.png B channel bits. Face front: the lit face plane (no roan ticks, the blaze's home). */
export const PORTRAIT_FLAG_FACE_FRONT = 1;
/** The painted forehead star and its fringe: no painted detail is carried over here. */
export const PORTRAIT_FLAG_PAINTED_STAR = 2;

/** portrait-marks.png band offsets (128 px tall each), keyed by FaceMarking. */
export const PORTRAIT_MARK_BAND = { star: 0, snip: 1, stripe: 2, blaze: 3, bald: 4 } as const;

/** Deterministic 0..1 hash noise (the offline builder uses the same integer hash). */
export function portraitNoise(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  const c = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** sRGB channel-wise mix. */
export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const mixHex = (a: string, b: string, t: number) => rgbToHex(mixRgb(hexToRgb(a), hexToRgb(b), t));

/**
 * Shading ramp: LEVEL 0 -> shade x 0.55, 0.25 -> shade, 0.6 -> body, 1 -> highlight
 * (linear in sRGB, quantised to whole pixels 0..255).
 */
export function portraitRamp(level: number, shade: string, body: string, highlight: string): RGB {
  const lv = Math.min(1, Math.max(0, level));
  const s = hexToRgb(shade);
  const b = hexToRgb(body);
  const h = hexToRgb(highlight);
  const dk = s.map((v) => v * 0.55) as RGB;
  let from: RGB, to: RGB, t: number;
  if (lv < 0.25) {
    from = dk;
    to = s;
    t = lv / 0.25;
  } else if (lv < 0.6) {
    from = s;
    to = b;
    t = (lv - 0.25) / 0.35;
  } else {
    from = b;
    to = h;
    t = (lv - 0.6) / 0.4;
  }
  return mixRgb(from, to, t).map((v) => Math.round(Math.min(255, Math.max(0, v)))) as RGB;
}

function luminance(rgb: readonly number[]): number {
  return 0.299 * rgb[0]! + 0.587 * rgb[1]! + 0.114 * rgb[2]!;
}

export interface RampStops {
  shade: string;
  base: string;
  highlight: string;
}

/**
 * Mane ramp stops: dark manes rise to a warm strand sheen; flaxen/cream manes shade
 * down toward sand so the strands still read (they never go near black).
 */
export function portraitManeStops(mane: string): RampStops {
  const m = hexToRgb(mane);
  if (luminance(m) > 110) {
    return {
      shade: rgbToHex(mixRgb(m, hexToRgb("#6b5236"), 0.45)),
      base: mane,
      highlight: rgbToHex(mixRgb(m, hexToRgb("#ffffff"), 0.2)),
    };
  }
  return { shade: "#000000", base: mane, highlight: rgbToHex(mixRgb(m, hexToRgb("#8a6a50"), 0.25)) };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`);
  return `{${entries.join(",")}}`;
}

/**
 * Cache key for a rendered genetic portrait: only fields that change the pixels
 * (painting, face marking, genetics, mane override), the output size and the recolour
 * version. Silks, legs and names never enter it.
 */
export function portraitCacheKey(appearance: HorseAppearance, scale: string | number): string {
  return stableJson({
    v: PORTRAIT_RECOLOUR_VERSION,
    coat: appearance.coat,
    face: appearance.face,
    maneColor: appearance.maneColor,
    colour: appearance.colour,
    scale: String(scale),
  });
}

/** FNV-1a of a string, as an unsigned 32-bit seed. */
function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * 2:1 downsample of an animated strip, like art-src/portrait_anims.py `down2`: colour
 * averaged by alpha weight, alpha kept hard (opaque when at least half the block is).
 */
export function downsampleAlpha2x(data: ArrayLike<number>, width: number, height: number): Uint8ClampedArray {
  const w = width >> 1;
  const h = height >> 1;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0,
        g = 0,
        b = 0,
        wa = 0;
      for (let k = 0; k < 4; k++) {
        const i = ((2 * y + (k >> 1)) * width + 2 * x + (k & 1)) * 4;
        const a = data[i + 3]! / 255;
        r += data[i]! * a;
        g += data[i + 1]! * a;
        b += data[i + 2]! * a;
        wa += a;
      }
      const o = (y * w + x) * 4;
      const d = Math.max(wa, 1e-6);
      out[o] = Math.round(r / d);
      out[o + 1] = Math.round(g / d);
      out[o + 2] = Math.round(b / d);
      out[o + 3] = wa / 4 >= 128 / 255 ? 255 : 0;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Genes -> portrait look
// ---------------------------------------------------------------------------

export type PortraitTexture = "none" | "roan" | "greying" | "varnish";

/** Everything the recolour needs, resolved from the appearance (the gene -> role mapping). */
export interface PortraitLook {
  /** Coat ramp (coat role; inner ears use its darker end). */
  coat: RampStops;
  mane: RampStops;
  /** Muzzle / chin skin. */
  muzzle: string;
  /** Iris colour when the genes set one (blue, amber, green); null keeps the painted eye. */
  eye: string | null;
  /** Grullo / smoky grullo dark head (points colour), else null. */
  darkHead: string | null;
  texture: PortraitTexture;
  /** Face marking drawn (splash raises it to a blaze or bald face). */
  face: FaceMarking;
  /** Sabino: ragged, spreading edges on the face marking and a white chin. */
  sabino: 0 | 1 | 2;
  /** SW/SW: white throat. */
  throat: boolean;
  tobiano: 0 | 1 | 2;
  leopard: "none" | "varnish" | "leopard" | "fewspot";
  /** Skin pattern on the muzzle: champagne freckles or leopard-complex mottling. */
  freckles: "none" | "champagne" | "mottled";
  /** Pattern seed from the genes only (spots, tobiano edge). */
  seed: number;
}

const FACE_ORDER: FaceMarking[] = ["none", "star", "snip", "stripe", "blaze", "bald"];
const atLeast = (face: FaceMarking, min: FaceMarking): FaceMarking => (FACE_ORDER.indexOf(face) >= FACE_ORDER.indexOf(min) ? face : min);

/** True when the portrait is drawn from the genes (layered coat v2); legacy appearances keep the painting. */
export function portraitRecolours(appearance: HorseAppearance): boolean {
  return appearance.colour !== undefined;
}

/** The gene -> palette / pattern mapping of the genetic portrait. */
export function portraitLookOf(appearance: HorseAppearance): PortraitLook {
  const c = resolveHorseColors(appearance);
  const col = appearance.colour;
  const grey = col?.grey ?? "none";
  const greyedOut = grey === "dapple" || grey === "white";
  let face = appearance.face;
  if (col?.splash === 2) face = "bald";
  else if (col?.splash === 1) face = atLeast(face, "blaze");
  const leopard = greyedOut ? "none" : (col?.leopard ?? "none");
  const eye = c.eye ?? null;
  return {
    coat: { shade: c.shade, base: c.body, highlight: c.highlight },
    mane: portraitManeStops(c.mane),
    muzzle: c.muzzle,
    eye,
    darkHead: col?.dun && col.base === "black" && grey === "none" ? c.points : null,
    texture: grey === "greying" ? "greying" : leopard === "varnish" ? "varnish" : col?.roan && !greyedOut ? "roan" : "none",
    face,
    sabino: (col?.sabino ?? 0) as 0 | 1 | 2,
    throat: col?.splash === 2,
    // A grey goes white over its patterns; the white patches themselves stay.
    tobiano: (col?.tobiano ?? 0) as 0 | 1 | 2,
    leopard,
    freckles: col?.champagne ? "champagne" : col?.leopard ? "mottled" : "none",
    seed: seedOf(stableJson({ colour: col, face: appearance.face, mane: appearance.maneColor })),
  };
}

// ---------------------------------------------------------------------------
// The painting's own ramp (for the detail transfer)
// ---------------------------------------------------------------------------

const BINS = 16;
const DETAIL_ROLES = [PORTRAIT_ROLES.coat, PORTRAIT_ROLES.mane, PORTRAIT_ROLES.muzzle, PORTRAIT_ROLES.innerEar] as const;

/** Median painted luminance per LEVEL bin, per recoloured role (index = role id). */
export type PaintedRamp = Record<number, Float32Array>;

/** Fit the painting's own luminance ramp: median luminance in 16 LEVEL bins for each recoloured role. */
export function fitPaintedRamp(still: ArrayLike<number>, roles: ArrayLike<number>): PaintedRamp {
  const S = PORTRAIT_ART_SIZE;
  const out: PaintedRamp = {};
  for (const role of DETAIL_ROLES) {
    const bins: number[][] = Array.from({ length: BINS }, () => []);
    for (let p = 0; p < S * S; p++) {
      const i = p * 4;
      if (Math.round(roles[i]! / 28) !== role || still[i + 3]! === 0) continue;
      if (roles[i + 2]! & PORTRAIT_FLAG_PAINTED_STAR) continue;
      bins[Math.min(BINS - 1, (roles[i + 1]! * BINS) >> 8)]!.push(luminance([still[i]!, still[i + 1]!, still[i + 2]!]));
    }
    const med = new Float32Array(BINS).fill(Number.NaN);
    bins.forEach((v, k) => {
      if (!v.length) return;
      v.sort((a, b) => a - b);
      med[k] = v[v.length >> 1]!;
    });
    // fill empty bins by linear interpolation (flat at the ends)
    const known = [...med.keys()].filter((k) => !Number.isNaN(med[k]!));
    for (let k = 0; k < BINS; k++) {
      if (!Number.isNaN(med[k]!) || !known.length) continue;
      const lo = [...known].reverse().find((q) => q < k);
      const hi = known.find((q) => q > k);
      if (lo === undefined) med[k] = med[hi!]!;
      else if (hi === undefined) med[k] = med[lo]!;
      else med[k] = med[lo]! + ((med[hi]! - med[lo]!) * (k - lo)) / (hi - lo);
    }
    if (!known.length) med.fill(128);
    out[role] = med;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pattern masks (still space)
// ---------------------------------------------------------------------------

/** Chin / lower lip (sabino): an ellipse under the muzzle. */
function chinWhite(x: number, y: number, rag: number): boolean {
  const dx = (x - 33) / 9;
  const dy = (y - 101) / 4.5;
  return dx * dx + dy * dy < (rag > 0.5 ? 1.15 : 0.85);
}

/** Throat (SW/SW): under the jaw and down the front of the neck. */
function throatWhite(x: number, y: number, rag: number): boolean {
  if (y < 86 || x < 38 || x > 76) return false;
  // left edge follows the jaw line (40,102) -> (62,86); right edge the neck front
  const jaw = 62 - ((y - 86) * 22) / 16;
  return x > jaw - (rag > 0.6 ? 1 : 0) && x < 70 + (y - 86) / 6;
}

/** Tobiano: white crossing the neck from the crest; the head stays coloured. */
function tobianoWhite(x: number, y: number, seed: number, copies: 1 | 2): boolean {
  if (x < 60 || y < 20) return false;
  // edge runs from the crest (x0, 24) down and forward to (x0 - 14, 120), wavy
  const x0 = 80 - (seed % 9) - (copies === 2 ? 6 : 0);
  const wave = (portraitNoise((y >> 3) + (seed & 255), seed >>> 8) - 0.5) * 8;
  return x > x0 - ((y - 24) * 16) / 96 + wave;
}

/** Max sabino: white everywhere but a coloured poll cap (ears and forelock base). */
function sabinoCap(x: number, y: number, seed: number): boolean {
  const wave = (portraitNoise(x >> 2, seed & 1023) - 0.5) * 6;
  return y < 33 + wave + (x > 64 ? (x - 64) / 4 : 0);
}

/** Spot field: is (x, y) inside a spot? cell = spot spacing, p = chance a cell has a spot. */
function inSpot(x: number, y: number, seed: number, cell: number, p: number, rMin: number, rMax: number): boolean {
  const cx = Math.floor(x / cell);
  const cy = Math.floor(y / cell);
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const gx = cx + ox;
      const gy = cy + oy;
      const s = (seed & 4095) * 31;
      if (portraitNoise(gx + s, gy * 7 + 3) > p) continue;
      const px = (gx + 0.2 + 0.6 * portraitNoise(gx * 3 + s, gy + 11)) * cell;
      const py = (gy + 0.2 + 0.6 * portraitNoise(gx + 17, gy * 5 + s)) * cell;
      const r = rMin + (rMax - rMin) * portraitNoise(gx + 29 + s, gy + 31);
      const dx = x + 0.5 - px;
      const dy = (y + 0.5 - py) * 1.15;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// The recolour
// ---------------------------------------------------------------------------

export interface PortraitSource {
  /** The painted RGBA strip (frames side by side, 128 px each). */
  pixels: ArrayLike<number>;
  frames: number;
  /**
   * Distinct frames at the start of a ping-pong strip (anim/index.json `kept`): frame f at or
   * past it repeats frame 2 * (kept - 1) - f, so it is copied instead of recoloured again.
   */
  kept?: number;
  /** Warp strip (same size): R = source x, G = source y in the still. Null = identity (a still). */
  warp: ArrayLike<number> | null;
  /** roles.png RGBA (128 x 128). */
  roles: ArrayLike<number>;
  /** portrait-marks.png RGBA (128 x 640); null when the horse has no face marking. */
  marks: ArrayLike<number> | null;
  /** fitPaintedRamp of the still this strip was painted from. */
  ramp: PaintedRamp;
}

type Lut = Uint8ClampedArray; // 256 x RGB

function rampLut(stops: RampStops, scale = 1): Lut {
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = portraitRamp((i / 255) * scale, stops.shade, stops.base, stops.highlight);
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
  return out;
}

const WHITE_HAIR = "#f4f1e8";
/** Summed |RGB| gap above which a loop-frame pixel is not what its fixed-role source shows. */
const LOOP_MISMATCH = 90;
const PINK_SKIN = { shade: "#a8776c", base: "#d9a99a", highlight: "#f0c9bc" };
const FRECKLE = "#5e4038";

/**
 * Recolour a painted portrait strip from the look. Returns a new RGBA buffer of the same
 * size. Pure and deterministic.
 */
export function paintGeneticPortrait(look: PortraitLook, src: PortraitSource): Uint8ClampedArray {
  const S = PORTRAIT_ART_SIZE;
  const W = S * src.frames;
  const px = src.pixels;
  const out = new Uint8ClampedArray(px.length);
  const R = PORTRAIT_ROLES;

  const coatLut = rampLut(look.coat);
  const earLut = rampLut(look.coat, 0.62);
  const maneLut = rampLut(look.mane);
  const muzzleLut = rampLut({ shade: look.muzzle, base: look.muzzle, highlight: look.coat.shade });
  const eyeLut = look.eye ? rampLut({ shade: mixHex(look.eye, "#000000", 0.5), base: look.eye, highlight: mixHex(look.eye, "#ffffff", 0.3) }) : null;
  const whiteStops = { shade: mixHex(MARKING_WHITE, "#7d7468", 0.55), base: mixHex(MARKING_WHITE, "#b9b0a2", 0.3), highlight: "#fbf9f3" };
  const whiteLut = rampLut(whiteStops);
  const whiteManeLut = rampLut({ shade: "#9a9284", base: "#e9e4d8", highlight: "#ffffff" });
  const pinkLut = rampLut(PINK_SKIN);
  const hair = hexToRgb(WHITE_HAIR);
  const freckle = hexToRgb(FRECKLE);
  const dark = look.darkHead ? hexToRgb(look.darkHead) : null;
  const markBand = look.face === "none" || !src.marks ? -1 : PORTRAIT_MARK_BAND[look.face];
  const seed = look.seed;
  const patterned = look.tobiano > 0 || look.sabino === 2 || look.leopard === "leopard" || look.leopard === "fewspot";

  // Painted-ramp luminance per bin, and the target ramp's luminance per bin, per role.
  const binLum = (lut: Lut, k: number) => {
    const i = Math.min(255, Math.round(((k + 0.5) / BINS) * 255)) * 3;
    return luminance([lut[i]!, lut[i + 1]!, lut[i + 2]!]);
  };
  const scaleFor = (role: number, lut: Lut) => {
    const f = new Float32Array(BINS);
    const med = src.ramp[role];
    for (let k = 0; k < BINS; k++) f[k] = med ? Math.min(1.5, Math.max(0.35, (binLum(lut, k) + 24) / (med[k]! + 24))) : 0;
    return f;
  };
  const detailScale: Record<number, Float32Array> = {
    [R.coat]: scaleFor(R.coat, coatLut),
    [R.mane]: scaleFor(R.mane, maneLut),
    [R.muzzle]: scaleFor(R.muzzle, muzzleLut),
    [R.innerEar]: scaleFor(R.innerEar, earLut),
  };
  // Roan-like coats draw their own white hairs, so the painting's ticks are held down.
  const detailClamp = look.texture === "none" ? 48 : 14;

  /** Face-marking coverage at a still pixel (sabino spreads it with ragged edges). */
  const markAt = (x: number, y: number): number => {
    if (markBand < 0) return 0;
    const m = src.marks!;
    const at = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= S || yy >= S ? 0 : m[((markBand * S + yy) * S + xx) * 4 + 3]! / 255);
    let a = at(x, y);
    if (look.sabino > 0 && a < 1) {
      const reach = look.sabino === 2 ? 2 : 1;
      for (let oy = -reach; oy <= reach && a < 1; oy++)
        for (let ox = -reach; ox <= reach && a < 1; ox++) if ((ox || oy) && at(x + ox, y + oy) > 0 && portraitNoise(x * 3 + 1, y * 5 + 2) > 0.45) a = 1;
    }
    return a;
  };


  // Phase 1, once per still pixel: the recoloured pixel before the painting's detail
  // (base RGB), how the detail applies (scale, or 0), and what kind of pixel it is. Every
  // frame pixel then reads its warp source here, so the per-frame work is a lookup.
  const KEEP = 0;
  const PAINT = 1;
  const EYE = 2;
  const kind = new Uint8Array(S * S);
  const base = new Float32Array(S * S * 3);
  const dScale = new Float32Array(S * S);
  const dMed = new Float32Array(S * S);
  for (let sy = 0; sy < S; sy++) {
    for (let sx = 0; sx < S; sx++) {
      const p = sy * S + sx;
      const j = p * 4;
      const role = Math.round(src.roles[j]! / 28);
      const lvl = src.roles[j + 1]!;
      const flags = src.roles[j + 2]!;
      const faceFront = (flags & PORTRAIT_FLAG_FACE_FRONT) !== 0;
      const bin = Math.min(BINS - 1, (lvl * BINS) >> 8);
      let lut: Lut | null = null;
      if (role === R.coat) lut = coatLut;
      else if (role === R.mane) lut = maneLut;
      else if (role === R.muzzle) lut = muzzleLut;
      else if (role === R.innerEar) lut = earLut;
      else if (role === R.eye && eyeLut) lut = eyeLut;
      if (!lut) continue; // fixed roles (ink, bridle, painted eye) keep the painted pixel
      const k3 = lvl * 3;
      let r = lut[k3]!;
      let g = lut[k3 + 1]!;
      let b = lut[k3 + 2]!;
      if (role === R.eye) {
        kind[p] = EYE;
        base[p * 3] = r;
        base[p * 3 + 1] = g;
        base[p * 3 + 2] = b;
        continue;
      }
      if (role === R.muzzle) {
        // skin carries a touch of the coat around it
        r = r * 0.9 + coatLut[k3]! * 0.1;
        g = g * 0.9 + coatLut[k3 + 1]! * 0.1;
        b = b * 0.9 + coatLut[k3 + 2]! * 0.1;
      }

      // coat textures (roan never on the lit face front; greying starts on the face)
      if (role === R.coat) {
        let tick = 0;
        if (look.texture === "roan" && !faceFront) tick = sx > 60 ? 0.24 : sx > 48 ? 0.1 : 0.03;
        else if (look.texture === "greying") tick = sx < 64 ? 0.26 : 0.1;
        else if (look.texture === "varnish") tick = faceFront ? (sy < 56 ? 0.28 : 0.04) : sx > 58 ? 0.38 : 0.18;
        if (tick > 0 && portraitNoise(sx + 977, sy + 131) < tick) {
          const t = look.texture === "roan" ? 0.42 : 0.5;
          r += (hair[0] - r) * t;
          g += (hair[1] - g) * t;
          b += (hair[2] - b) * t;
        }
        if (dark && (faceFront || sx < 60)) {
          const t = faceFront ? 0.5 : 0.3;
          r += (dark[0] - r) * t;
          g += (dark[1] - g) * t;
          b += (dark[2] - b) * t;
        }
      }

      // skin patterns on the muzzle
      if (role === R.muzzle && look.freckles === "champagne" && portraitNoise(sx + 311, sy + 7) > 0.8) {
        r += (freckle[0] - r) * 0.5;
        g += (freckle[1] - g) * 0.5;
        b += (freckle[2] - b) * 0.5;
      } else if (role === R.muzzle && look.freckles === "mottled" && portraitNoise((sx >> 1) + 53, (sy >> 1) + 19) > 0.55) {
        r = r * 0.35 + pinkLut[k3]! * 0.65;
        g = g * 0.35 + pinkLut[k3 + 1]! * 0.65;
        b = b * 0.35 + pinkLut[k3 + 2]! * 0.65;
      }

      // white: the face marking, then the white patterns
      const n1 = portraitNoise(sx, sy);
      let w = 0;
      if (role === R.coat || role === R.muzzle) {
        w = markAt(sx, sy);
        if (look.sabino > 0 && chinWhite(sx, sy, n1)) w = 1;
      }
      let pw = 0;
      if (look.throat && role !== R.mane && throatWhite(sx, sy, n1)) pw = 1;
      if (look.tobiano && tobianoWhite(sx, sy, seed, look.tobiano)) pw = 1;
      if (look.sabino === 2 && role !== R.innerEar && role !== R.mane && !sabinoCap(sx, sy, seed)) pw = 1;
      if (look.leopard === "fewspot" && role !== R.innerEar) pw = role === R.mane ? 0.75 : 1;
      if (look.leopard === "leopard" && role !== R.innerEar && role !== R.mane) {
        // white over the neck, roaned up the face, the lower face front stays coloured
        pw = sx > 60 ? 1 : faceFront && sy > 58 ? 0 : portraitNoise(sx + 41, sy + 59) < 0.55 ? 0.85 : 0;
      }
      if (role === R.mane) pw *= 0.9;
      w = Math.max(w, pw);
      let spot = false;
      if (w > 0.5 && patterned && role !== R.mane) {
        if (look.leopard === "leopard") spot = inSpot(sx, sy, seed, 7, 0.8, 1.3, faceFront ? 1.8 : 2.8);
        else if (look.leopard === "fewspot") spot = inSpot(sx, sy, seed, 11, 0.16, 1.2, 2.2);
        else if (look.tobiano === 2) spot = inSpot(sx, sy, seed ^ 0x5bd1, 9, 0.22, 0.8, 1.5);
      }
      if (w > 0 && !spot) {
        // white hair; on the muzzle it shows the pink skin under it
        const wl = role === R.mane ? whiteManeLut : whiteLut;
        let wr = wl[k3]!;
        let wg = wl[k3 + 1]!;
        let wb = wl[k3 + 2]!;
        if (role === R.muzzle) {
          wr = (wr + pinkLut[k3]!) / 2;
          wg = (wg + pinkLut[k3 + 1]!) / 2;
          wb = (wb + pinkLut[k3 + 2]!) / 2;
        }
        r += (wr - r) * w;
        g += (wg - g) * w;
        b += (wb - b) * w;
      }
      kind[p] = PAINT;
      base[p * 3] = r;
      base[p * 3 + 1] = g;
      base[p * 3 + 2] = b;
      const med = src.ramp[role];
      if (med && !(flags & PORTRAIT_FLAG_PAINTED_STAR)) {
        dMed[p] = med[bin]!;
        dScale[p] = w > 0 && !spot ? 0.6 : detailScale[role]![bin]!;
      }
    }
  }

  // Nearest recoloured still pixel of every still pixel (multi-source BFS), for loop-frame
  // pixels that land on a fixed role but are not what that role shows (an eyelid over the
  // eye, a re-drawn roan tick in the forelock): those take the coat around them instead of
  // keeping a painted colour from the wrong coat.
  const nearest = new Int32Array(S * S).fill(-1);
  if (src.warp && src.frames > 1) {
    const q = new Int32Array(S * S);
    let head = 0;
    let tail = 0;
    for (let p = 0; p < S * S; p++)
      if (kind[p] === PAINT) {
        nearest[p] = p;
        q[tail++] = p;
      }
    while (head < tail) {
      const p = q[head++]!;
      const x = p % S;
      const y = (p / S) | 0;
      for (const n of [x > 0 ? p - 1 : -1, x < S - 1 ? p + 1 : -1, y > 0 ? p - S : -1, y < S - 1 ? p + S : -1]) {
        if (n < 0 || nearest[n] !== -1) continue;
        nearest[n] = nearest[p]!;
        q[tail++] = n;
      }
    }
  }

  // Phase 2, every frame pixel: its warp source's recolour plus the painting's own detail.
  const kept = src.kept && src.kept > 1 && src.kept < src.frames ? src.kept : src.frames;
  for (let f = 0; f < src.frames; f++) {
    if (f >= kept) {
      const g = 2 * (kept - 1) - f; // ping-pong: an already painted frame
      for (let y = 0; y < S; y++) {
        const row = y * W * 4;
        out.copyWithin(row + f * S * 4, row + g * S * 4, row + (g + 1) * S * 4);
      }
      continue;
    }
    for (let y = 0; y < S; y++) {
      let i = (y * W + f * S) * 4;
      for (let x = 0; x < S; x++, i += 4) {
        const pr = px[i]!;
        const pg = px[i + 1]!;
        const pb = px[i + 2]!;
        out[i] = pr;
        out[i + 1] = pg;
        out[i + 2] = pb;
        out[i + 3] = px[i + 3]!;
        if (px[i + 3]! === 0) continue;
        let p = src.warp ? src.warp[i + 1]! * S + src.warp[i]! : y * S + x;
        let kd = kind[p]!;
        if (kd !== PAINT && f > 0 && nearest[p]! >= 0) {
          // frame 0 is the still: compare with what the source pixel shows there
          const k = (((p / S) | 0) * W + (p % S)) * 4;
          if (Math.abs(pr - px[k]!) + Math.abs(pg - px[k + 1]!) + Math.abs(pb - px[k + 2]!) > LOOP_MISMATCH) {
            p = nearest[p]!;
            kd = PAINT;
          }
        }
        if (kd === KEEP) continue;
        const pl = 0.299 * pr + 0.587 * pg + 0.114 * pb;
        if (kd === EYE) {
          if (pl >= 120) continue; // the catchlight stays painted
          out[i] = base[p * 3]!;
          out[i + 1] = base[p * 3 + 1]!;
          out[i + 2] = base[p * 3 + 2]!;
          continue;
        }
        const s = dScale[p]!;
        const d = s === 0 ? 0 : s * Math.max(-detailClamp, Math.min(detailClamp, pl - dMed[p]!));
        out[i] = base[p * 3]! + d;
        out[i + 1] = base[p * 3 + 1]! + d;
        out[i + 2] = base[p * 3 + 2]! + d;
      }
    }
  }
  return out;
}
