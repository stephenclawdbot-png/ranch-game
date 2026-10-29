import type { Coat, HorseAppearance, HorseColour, Silks } from "@thoroughbred/shared";

export type CoatTexture = "none" | "dapple" | "roan";

export interface CoatPalette {
  /** Main coat colour. */
  body: string;
  /** Shadow side / belly / far legs. */
  shade: string;
  /** Rim light along the top line and muscle highlights. */
  highlight: string;
  /** Mane and tail. */
  mane: string;
  hoof: string;
  /** Lower legs ("points"): black on bays/buckskins, body-coloured otherwise. */
  points: string;
  /** Muzzle / nostril area. */
  muzzle: string;
  /** Extra coat texture drawn over the body. */
  texture: CoatTexture;
  /** Dorsal stripe / leg barring colour (dun coats only). */
  stripe?: string;
  /** Eye colour (blue on cremello / perlino / smoky cream). Renderers that don't draw eyes ignore it. */
  eye?: string;
}

/** Realistic thoroughbred coat colours. Every `Coat` value has an entry. */
export const COAT_PALETTES: Record<Coat, CoatPalette> = {
  bay: {
    body: "#8a4527",
    shade: "#5a2a16",
    highlight: "#b5683d",
    mane: "#17100d",
    hoof: "#2a2320",
    points: "#1b1310",
    muzzle: "#3b2219",
    texture: "none",
  },
  dark_bay: {
    body: "#4d2618",
    shade: "#2e150c",
    highlight: "#74402a",
    mane: "#110b09",
    hoof: "#231d1a",
    points: "#140d0b",
    muzzle: "#2a1810",
    texture: "none",
  },
  chestnut: {
    body: "#a4552b",
    shade: "#73371a",
    highlight: "#d07f47",
    mane: "#c58a4d",
    hoof: "#4a3a2e",
    points: "#93491f",
    muzzle: "#6d3a22",
    texture: "none",
  },
  liver_chestnut: {
    body: "#5e2e1a",
    shade: "#3d1c0f",
    highlight: "#83472a",
    mane: "#6f3b22",
    hoof: "#3a2e26",
    points: "#522715",
    muzzle: "#3a1d12",
    texture: "none",
  },
  black: {
    body: "#1f1c1c",
    shade: "#0f0d0d",
    highlight: "#47403e",
    mane: "#0b0a0a",
    hoof: "#1e1b1a",
    points: "#141212",
    muzzle: "#2a2524",
    texture: "none",
  },
  grey: {
    body: "#b4b3ae",
    shade: "#83827d",
    highlight: "#dddcd6",
    mane: "#5f5e5b",
    hoof: "#3a3634",
    points: "#77766f",
    muzzle: "#4b4846",
    texture: "none",
  },
  dapple_grey: {
    body: "#9a9c9d",
    shade: "#6b6e70",
    highlight: "#d6d8d9",
    mane: "#4a4b4d",
    hoof: "#33302e",
    points: "#56595b",
    muzzle: "#3e3c3c",
    texture: "dapple",
  },
  palomino: {
    body: "#d5a457",
    shade: "#a97a34",
    highlight: "#f0ca86",
    mane: "#f1e4c6",
    hoof: "#6b5a44",
    points: "#c49340",
    muzzle: "#8a6a4a",
    texture: "none",
  },
  buckskin: {
    body: "#c69c64",
    shade: "#977041",
    highlight: "#e2bf8c",
    mane: "#1c1612",
    hoof: "#2a2420",
    points: "#1f1813",
    muzzle: "#4a3a2c",
    texture: "none",
  },
  roan: {
    body: "#8c6d67",
    shade: "#644b46",
    highlight: "#b7988f",
    mane: "#38241f",
    hoof: "#2e2622",
    points: "#3f2b26",
    muzzle: "#3a2a26",
    texture: "roan",
  },
};

/** White used for face and leg markings. */
export const MARKING_WHITE = "#f3f0e8";

// ---------------------------------------------------------------------------
// Coat v2: layered genetics -> anchor palettes (lead spec: docs/brand-v2/coats/coat-anchors-v2.png)
// ---------------------------------------------------------------------------

/** Exact anchor colours per phenotype (body, shade, highlight, mane, points, stripe). */
interface CoatAnchor {
  body: string;
  shade: string;
  highlight: string;
  mane: string;
  points: string;
  stripe?: string;
}

const COAT_ANCHORS = {
  bay: { body: "#8a4527", shade: "#5a2a16", highlight: "#b5683d", mane: "#17100d", points: "#1b1310" },
  seal_brown: { body: "#4d2618", shade: "#2e150c", highlight: "#74402a", mane: "#110b09", points: "#140d0b" },
  chestnut: { body: "#a4552b", shade: "#73371a", highlight: "#d07f47", mane: "#c58a4d", points: "#93491f" },
  liver_chestnut: { body: "#5e2e1a", shade: "#3d1c0f", highlight: "#83472a", mane: "#6f3b22", points: "#522715" },
  black: { body: "#1f1c1c", shade: "#0f0d0d", highlight: "#47403e", mane: "#0b0a0a", points: "#141212" },
  buckskin: { body: "#c9a063", shade: "#94713b", highlight: "#e2bf82", mane: "#1a1410", points: "#1b1512" },
  smoky_brown: { body: "#8c6a45", shade: "#5e4529", highlight: "#ad8b62", mane: "#16100c", points: "#18110d" },
  palomino: { body: "#d9b56a", shade: "#a8843f", highlight: "#f0d48f", mane: "#f3ead2", points: "#cfa95e" },
  dark_palomino: { body: "#b08a4c", shade: "#7f6232", highlight: "#cfaa6c", mane: "#e9dcbc", points: "#a57f43" },
  smoky_black: { body: "#3a302a", shade: "#221c19", highlight: "#5d4d43", mane: "#120f0e", points: "#1a1614" },
  perlino: { body: "#ecdcb8", shade: "#cdb98f", highlight: "#f8eed6", mane: "#c99a6e", points: "#c58f61" },
  cremello: { body: "#efe4c8", shade: "#d2c3a0", highlight: "#fbf4e2", mane: "#f6efdd", points: "#e9dcbd" },
  smoky_cream: { body: "#e5d6bf", shade: "#c6b398", highlight: "#f4ead9", mane: "#b89f86", points: "#b49a80" },
  bay_dun: { body: "#c69c64", shade: "#976f3d", highlight: "#e0bd86", mane: "#1d1611", points: "#1d1611", stripe: "#2a1e15" },
  red_dun: { body: "#d19a68", shade: "#a46f43", highlight: "#e8b98a", mane: "#8a4a2a", points: "#a8653c", stripe: "#8a4a2a" },
  grullo: { body: "#8e857a", shade: "#625a51", highlight: "#aea598", mane: "#1c1a18", points: "#1c1a18", stripe: "#1c1a18" },
  dunskin: { body: "#dcc28f", shade: "#b39a68", highlight: "#efdcb0", mane: "#1d1611", points: "#1d1611", stripe: "#3a2a1a" },
  dunalino: { body: "#e8cd96", shade: "#c4a66c", highlight: "#f6e3b8", mane: "#f2e6c8", points: "#dcbd84", stripe: "#c49a5a" },
} satisfies Record<string, CoatAnchor>;

type AnchorName = keyof typeof COAT_ANCHORS;

/** Anchor for (base, cream): liver follows chestnut shades, seal brown the dark side. */
function anchorFor(base: HorseColour["base"], cream: HorseColour["cream"]): AnchorName {
  if (cream === 0) return base === "liver" ? "liver_chestnut" : base;
  const red = base === "chestnut" || base === "liver";
  if (cream === 2) return red ? "cremello" : base === "black" ? "smoky_cream" : "perlino";
  if (red) return base === "liver" ? "dark_palomino" : "palomino";
  return base === "black" ? "smoky_black" : base === "seal_brown" ? "smoky_brown" : "buckskin";
}

/** Anchor for a dun coat, where the table has one (dark bay duns read as bay dun). */
function dunAnchorFor(base: HorseColour["base"], cream: HorseColour["cream"]): AnchorName | null {
  const red = base === "chestnut" || base === "liver";
  if (cream === 0) return red ? "red_dun" : base === "black" ? "grullo" : "bay_dun";
  if (cream === 1) return base === "black" ? null : red ? "dunalino" : "dunskin";
  return null; // dun + two cream: lightened double-dilute, no anchor
}

// --- OKLab colour mixing (same math as @thoroughbred/pixel-rig ramp.ts) -------------------

type RGBF = [number, number, number];
type Lab = [number, number, number];

const hexToF = (hex: string): RGBF => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const fToHex = ([r, g, b]: RGBF): string => {
  const c = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
};
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function srgbToOklab(rgb: RGBF): Lab {
  const [r, g, b] = rgb.map(toLin) as RGBF;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLin([L, a, b]: Lab): RGBF {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLab -> sRGB, reducing chroma until the colour fits the gamut. */
function oklabToSrgb([L, a, b]: Lab): RGBF {
  const C = Math.hypot(a, b);
  const h = Math.atan2(b, a);
  const inGamut = (c: RGBF) => c.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  let lo = 0;
  let hi = C;
  let lin = oklabToLin([L, C * Math.cos(h), C * Math.sin(h)]);
  if (!inGamut(lin)) {
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToLin([L, mid * Math.cos(h), mid * Math.sin(h)]))) lo = mid;
      else hi = mid;
    }
    lin = oklabToLin([L, lo * Math.cos(h), lo * Math.sin(h)]);
  }
  return lin.map((v) => toSrgb(Math.min(1, Math.max(0, v)))) as RGBF;
}

const mixLab = (a: Lab, b: Lab, t: number): Lab => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Mix `hex` toward `toward` by t in OKLab. */
export function mixOklab(hex: string, toward: string, t: number): string {
  return fToHex(oklabToSrgb(mixLab(srgbToOklab(hexToF(hex)), srgbToOklab(hexToF(toward)), t)));
}

/** Scale OKLab lightness by f (>= minHex's lightness when given). */
function scaleLightness(hex: string, f: number, minHex?: string): string {
  const lab = srgbToOklab(hexToF(hex));
  lab[0] *= f;
  if (minHex) lab[0] = Math.max(lab[0], srgbToOklab(hexToF(minHex))[0]);
  return fToHex(oklabToSrgb(lab));
}

/** Cream-dun combos without an anchor lighten toward pale dun parchment. */
const DUN_LIGHTEN_TO = "#f0e0c0";
/** Two-cream coats have pink skin. */
const PINK_MUZZLE = "#d9a99a";
/** Two-cream coats (cremello / perlino / smoky cream) have blue eyes. */
const BLUE_EYE = "#7fa8c9";

function fromAnchor(a: CoatAnchor): CoatPalette {
  return {
    body: a.body,
    shade: a.shade,
    highlight: a.highlight,
    mane: a.mane,
    points: a.points,
    // New anchors derive hoof and muzzle: hoof = points darkened 25 % (never darker than
    // #2a2320), muzzle = shade darkened 30 % (pink on two-cream coats, set by the caller).
    hoof: scaleLightness(a.points, 0.75, "#2a2320"),
    muzzle: scaleLightness(a.shade, 0.7),
    ...(a.stripe ? { stripe: a.stripe } : {}),
    texture: "none",
  };
}

/**
 * Palette for an appearance. Legacies (no `colour`) fall back to the fixed `Coat` palettes,
 * byte-for-byte; layered genetics resolve base + cream + dun to an anchor, then texture:
 * roan ticks over the horse's own body colour, greys use the existing grey palettes.
 */
export function coatPaletteOf(appearance: HorseAppearance): CoatPalette {
  const col = appearance.colour;
  if (!col) return COAT_PALETTES[appearance.coat] ?? COAT_PALETTES.bay;
  if (col.grey === "white") return { ...COAT_PALETTES.grey };
  if (col.grey === "dapple") return { ...COAT_PALETTES.dapple_grey };
  let p = fromAnchor(COAT_ANCHORS[anchorFor(col.base, col.cream)]);
  if (col.dun) {
    const dunAnchor = dunAnchorFor(col.base, col.cream);
    if (dunAnchor) p = fromAnchor(COAT_ANCHORS[dunAnchor]);
    else {
      p.body = mixOklab(p.body, DUN_LIGHTEN_TO, 0.18);
      p.shade = mixOklab(p.shade, DUN_LIGHTEN_TO, 0.18);
      p.highlight = mixOklab(p.highlight, DUN_LIGHTEN_TO, 0.18);
      p.muzzle = scaleLightness(p.shade, 0.7);
      p.stripe = scaleLightness(p.mane, 0.8);
    }
  }
  if (col.cream === 2) {
    p.muzzle = PINK_MUZZLE;
    if (!col.dun) p.eye = BLUE_EYE;
  }
  p.texture = col.grey === "greying" ? "dapple" : col.roan ? "roan" : "none";
  return p;
}

export interface HorseColors extends CoatPalette {
  coat: Coat;
  marking: string;
  silks: Silks;
}

/** Final colours for a horse: coat palette + mane override + silks. */
export function resolveHorseColors(appearance: HorseAppearance): HorseColors {
  const base = coatPaletteOf(appearance);
  return {
    ...base,
    mane: appearance.maneColor ?? base.mane,
    coat: appearance.coat,
    marking: MARKING_WHITE,
    silks: appearance.silks,
  };
}

/** "#rrggbb" -> 0xrrggbb, for renderers that take numeric colours. */
export function hexToNumber(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}
