/**
 * Colour ramps for the pixel rig: every role (coat, mane, silks...) gets an 8-step ramp,
 * dark -> light, built in OKLab with pixel-art hue shifting (shadows lean cool/violet,
 * highlights lean warm). The shader lights each pixel and then snaps it to one of these steps.
 *
 * Ramp index convention: 0 = deepest shadow / outline tone, 1..6 = the shading range,
 * 7 = sheen highlight (specular only).
 */
import type { HorseAppearance } from "@thoroughbred/shared";
import { MARKING_WHITE, resolveHorseColors } from "@thoroughbred/art-pipeline";
import { ROLE_COUNT, ROLE_ID, type Role } from "./rigdef";

export const RAMP_STEPS = 8;

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  const c = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export type Lab = [number, number, number];

export function srgbToOklab(rgb: RGB): Lab {
  const [r, g, b] = rgb.map(toLin) as RGB;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab -> linear RGB (unclamped). */
function oklabToLinear([L, a, b]: Lab): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (c: RGB) => c.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLCH (L, C, h radians) -> sRGB, reducing chroma until it fits the gamut. */
export function oklchToSrgb(L: number, C: number, h: number): RGB {
  let lo = 0;
  let hi = C;
  let lin = oklabToLinear([L, C * Math.cos(h), C * Math.sin(h)]);
  if (!inGamut(lin)) {
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      const t = oklabToLinear([L, mid * Math.cos(h), mid * Math.sin(h)]);
      if (inGamut(t)) lo = mid;
      else hi = mid;
    }
    lin = oklabToLinear([L, lo * Math.cos(h), lo * Math.sin(h)]);
  }
  return lin.map((v) => toSrgb(Math.min(1, Math.max(0, v)))) as RGB;
}

export function toLch(hex: string): [number, number, number] {
  const [L, a, b] = srgbToOklab(hexToRgb(hex));
  return [L, Math.hypot(a, b), Math.atan2(b, a)];
}

const COOL = (265 / 180) * Math.PI;
const WARM = (85 / 180) * Math.PI;

/** Rotate hue `h` towards `target` by at most `amount` radians. */
function shiftHue(h: number, target: number, amount: number): number {
  let d = target - h;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return h + Math.sign(d) * Math.min(Math.abs(d), amount);
}

export interface RampOptions {
  /** Explicit shadow colour, placed at index 2. */
  shade?: string;
  /** Explicit highlight colour, placed at index 6. */
  highlight?: string;
  /** Lightness spread multiplier (1 = default). */
  contrast?: number;
  /** Hue-shift strength multiplier (1 = default). */
  hueShift?: number;
}

/**
 * Build an 8-step ramp (dark -> light) around `base` (placed at index 4).
 * Hue shifts cool in the shadows and warm in the highlights, chroma eases off at both ends.
 */
export function makeRamp(base: string, opts: RampOptions = {}): string[] {
  const [L0, C0, h0] = toLch(base);
  const k = opts.contrast ?? 1;
  const hs = opts.hueShift ?? 1;
  // Neutral colours (greys, whites, blacks) get a gentle tint rather than a rainbow.
  const neutral = C0 < 0.02;
  const hBase = neutral ? COOL : h0;
  let offs = [-0.3, -0.21, -0.135, -0.065, 0, 0.065, 0.125, 0.185].map((o) => o * k);
  // Keep the ramp inside [0.06, 0.985] by compressing the side that would clip.
  const top = L0 + offs[7]!;
  if (top > 0.985) {
    const s = (0.985 - L0) / offs[7]!;
    offs = offs.map((o) => (o > 0 ? o * Math.max(0, s) : o * (1 + (1 - Math.max(0, s)) * 0.6)));
  }
  const bottom = L0 + offs[0]!;
  if (bottom < 0.06) {
    const s = (L0 - 0.06) / -offs[0]!;
    offs = offs.map((o) => (o < 0 ? o * Math.max(0, s) : o * (1 + (1 - Math.max(0, s)) * 0.5)));
  }
  const out: string[] = offs.map((o, i) => {
    const L = Math.min(0.99, Math.max(0.02, L0 + o));
    const t = Math.abs(o) / 0.3;
    let C = neutral ? Math.max(C0, 0.012 * t) : C0 * (o < 0 ? 1 - 0.25 * t * t : 1 - 0.45 * t);
    if (neutral) C = Math.min(C, 0.03);
    const h = o < 0 ? shiftHue(hBase, COOL, 0.32 * t * hs) : shiftHue(neutral ? WARM : hBase, WARM, 0.22 * t * hs);
    return rgbToHex(oklchToSrgb(L, i === 4 ? C0 : C, i === 4 ? h0 : h));
  });
  out[4] = base.toLowerCase();
  if (opts.shade || opts.highlight) return anchorRamp(out, base, opts);
  return out;
}

/** Re-fit a generated ramp so that index 2 = shade and index 6 = highlight exactly. */
function anchorRamp(ramp: string[], base: string, opts: RampOptions): string[] {
  const lab = (h: string) => srgbToOklab(hexToRgb(h));
  const mix = (a: Lab, b: Lab, t: number): Lab => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const fromLab = (l: Lab) => {
    const C = Math.hypot(l[1], l[2]);
    return rgbToHex(oklchToSrgb(l[0], C, Math.atan2(l[2], l[1])));
  };
  const B = lab(base);
  const S = opts.shade ? lab(opts.shade) : lab(ramp[2]!);
  const Hh = opts.highlight ? lab(opts.highlight) : lab(ramp[6]!);
  const out = ramp.slice();
  out[2] = opts.shade ?? ramp[2]!;
  out[6] = opts.highlight ?? ramp[6]!;
  out[3] = fromLab(mix(S, B, 0.5));
  out[5] = fromLab(mix(B, Hh, 0.5));
  // Extrapolate the deep shadows from the shade -> body step, hue-shifted cool.
  const dL = Math.max(0.035, B[0] - S[0]);
  const deep = (f: number, shift: number) => {
    const C = Math.hypot(S[1], S[2]) * (1 - 0.18 * f);
    const h = shiftHue(Math.atan2(S[2], S[1]), COOL, shift);
    return rgbToHex(oklchToSrgb(Math.max(0.04, S[0] - dL * f), C, h));
  };
  out[1] = deep(0.75, 0.12);
  out[0] = deep(1.45, 0.22);
  const up = Math.max(0.03, Hh[0] - B[0]);
  const C7 = Math.hypot(Hh[1], Hh[2]) * 0.72;
  out[7] = rgbToHex(oklchToSrgb(Math.min(0.97, Hh[0] + up * 0.7), C7, shiftHue(Math.atan2(Hh[2], Hh[1]), WARM, 0.18)));
  return out;
}

/** Fixed colours for the parts that do not depend on the horse. */
export const FIXED_COLOURS = {
  ink: "#1a1416",
  skin: "#d8a27c",
  breeches: "#ece6da",
  boots: "#2b211d",
  tack: "#4a2f1e",
  saddlecloth: "#efe9dd",
} as const;

export interface HorsePalette {
  /** role -> 8 hex colours dark -> light */
  ramps: Record<Role, string[]>;
  /** coat texture: 0 none, 1 dapple, 2 roan */
  coatTexture: number;
}

/** Resolve every role's ramp for a horse appearance. */
export function buildHorsePalette(appearance: HorseAppearance): HorsePalette {
  const c = resolveHorseColors(appearance);
  const silks = appearance.silks;
  const ramps: Record<Role, string[]> = {
    none: Array(RAMP_STEPS).fill("#000000"),
    coat: makeRamp(c.body, { shade: c.shade, highlight: c.highlight }),
    points: makeRamp(c.points, { contrast: 0.8 }),
    mane: makeRamp(c.mane, { contrast: 0.85 }),
    hoof: makeRamp(c.hoof, { contrast: 0.8 }),
    muzzle: makeRamp(c.muzzle, { contrast: 0.8 }),
    ink: makeRamp(FIXED_COLOURS.ink, { contrast: 0.5 }),
    marking: makeRamp(MARKING_WHITE, { contrast: 0.9 }),
    silksPrimary: makeRamp(silks.primary),
    silksSecondary: makeRamp(silks.secondary),
    cap: makeRamp(silks.cap),
    skin: makeRamp(FIXED_COLOURS.skin, { contrast: 0.85 }),
    breeches: makeRamp(FIXED_COLOURS.breeches, { contrast: 0.9 }),
    boots: makeRamp(FIXED_COLOURS.boots, { contrast: 0.8 }),
    tack: makeRamp(FIXED_COLOURS.tack, { contrast: 0.8 }),
    saddlecloth: makeRamp(FIXED_COLOURS.saddlecloth, { contrast: 0.9 }),
  };
  return { ramps, coatTexture: c.texture === "dapple" ? 1 : c.texture === "roan" ? 2 : 0 };
}

/**
 * Pack a palette as RGBA8 bytes, RAMP_STEPS wide x ROLE_COUNT tall (row = role id), sRGB.
 * This is the per-horse palette texture the shader indexes.
 */
export function paletteToBytes(p: HorsePalette, out = new Uint8Array(RAMP_STEPS * ROLE_COUNT * 4)): Uint8Array {
  for (const [role, ramp] of Object.entries(p.ramps) as [Role, string[]][]) {
    const row = ROLE_ID[role];
    ramp.forEach((hex, i) => {
      const [r, g, b] = hexToRgb(hex);
      const o = (row * RAMP_STEPS + i) * 4;
      out[o] = Math.round(r * 255);
      out[o + 1] = Math.round(g * 255);
      out[o + 2] = Math.round(b * 255);
      out[o + 3] = 255;
    });
  }
  return out;
}

/** Relative luminance-ish lightness (OKLab L) of a hex colour, 0..1. */
export function lightness(hex: string): number {
  return srgbToOklab(hexToRgb(hex))[0];
}
