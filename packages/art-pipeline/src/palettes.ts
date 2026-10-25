import type { Coat, HorseAppearance, Silks } from "@thoroughbred/shared";

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

export interface HorseColors extends CoatPalette {
  coat: Coat;
  marking: string;
  silks: Silks;
}

/** Final colours for a horse: coat palette + mane override + silks. */
export function resolveHorseColors(appearance: HorseAppearance): HorseColors {
  const base = COAT_PALETTES[appearance.coat] ?? COAT_PALETTES.bay;
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
