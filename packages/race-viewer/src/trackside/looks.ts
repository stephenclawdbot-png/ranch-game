/**
 * Trackside lighting looks (pure). Dusk is the default and matches the "track-dusk"
 * diorama; clear daytime posts get a golden-hour variant, overcast and rain dim and
 * desaturate the picture and drop the sun, rays and rim light.
 */
import type { Weather } from "@thoroughbred/shared";

export type TracksideLookId = "dusk" | "golden" | "overcast" | "rain";

export interface TracksideLook {
  id: TracksideLookId;
  /** Art stem of the sky strip. */
  sky: "sky-dusk" | "sky-clear" | "sky-overcast";
  skyTop: string;
  skyBottom: string;
  /** Aerial-perspective colour baked into far layers. */
  fog: string;
  hazeMul: number;
  sun: { x: number; y: number; r: number; color: string; alpha: number } | null;
  rays: { color: string; alpha: number } | null;
  motes: { count: number; color: string; glow: string; wind: number };
  grade: { top: string; topA: number; bottom: string; bottomA: number; vignette: number };
  /** Colour grade baked into every sprite (mix). */
  spriteTint: [string, number];
  /** Rim light on the sprites (normal maps): colour, strength, light direction (image space, y up). */
  rim: { color: string; amount: number; dir: [number, number, number] };
  ground: { tint: string; amount: number };
  saturation: number;
  brightness: number;
  dust: string;
  rain: boolean;
}

const DUSK: TracksideLook = {
  id: "dusk",
  sky: "sky-dusk",
  skyTop: "#2b2156",
  skyBottom: "#ff9a52",
  fog: "#d98a6a",
  hazeMul: 1,
  sun: { x: 0.7, y: 0.32, r: 0.42, color: "#ff9b4a", alpha: 0.7 },
  rays: { color: "#ffb070", alpha: 0.1 },
  motes: { count: 60, color: "#ffd7a8", glow: "#ff9b4a", wind: -40 },
  grade: { top: "#5a3a8a", topA: 0.1, bottom: "#120a1c", bottomA: 0.3, vignette: 0.5 },
  spriteTint: ["#4a2a5a", 0.2],
  rim: { color: "#ffb15e", amount: 0.55, dir: [0.62, 0.55, -0.56] },
  ground: { tint: "#3a2050", amount: 0.12 },
  saturation: 1,
  brightness: 1,
  dust: "#e8b48a",
  rain: false,
};

const GOLDEN: TracksideLook = {
  ...DUSK,
  id: "golden",
  sky: "sky-clear",
  skyTop: "#5d8fc4",
  skyBottom: "#ffd79a",
  fog: "#e8c08a",
  hazeMul: 0.8,
  sun: { x: 0.74, y: 0.22, r: 0.36, color: "#ffd27a", alpha: 0.5 },
  rays: { color: "#ffe2a0", alpha: 0.08 },
  motes: { count: 44, color: "#fff0c8", glow: "#ffd27a", wind: -30 },
  grade: { top: "#ffd79a", topA: 0.08, bottom: "#1a1408", bottomA: 0.24, vignette: 0.42 },
  spriteTint: ["#5a3a1a", 0.1],
  rim: { color: "#ffe09a", amount: 0.45, dir: [0.6, 0.65, -0.45] },
  ground: { tint: "#3a2a10", amount: 0.06 },
  dust: "#d8c09a",
};

const OVERCAST: TracksideLook = {
  ...DUSK,
  id: "overcast",
  sky: "sky-overcast",
  skyTop: "#5c6470",
  skyBottom: "#aeb4b8",
  fog: "#9aa2a6",
  hazeMul: 1.15,
  sun: null,
  rays: null,
  motes: { count: 0, color: "#ffffff", glow: "#ffffff", wind: -20 },
  grade: { top: "#3a4450", topA: 0.12, bottom: "#0c1014", bottomA: 0.3, vignette: 0.45 },
  spriteTint: ["#3c4652", 0.2],
  rim: { color: "#dfe6ea", amount: 0.12, dir: [0.3, 0.9, 0.2] },
  ground: { tint: "#28323a", amount: 0.14 },
  saturation: 0.72,
  brightness: 0.9,
  dust: "#b8ad9a",
};

const RAIN: TracksideLook = {
  ...OVERCAST,
  id: "rain",
  skyTop: "#454c58",
  skyBottom: "#8a9298",
  grade: { top: "#2a3440", topA: 0.16, bottom: "#06090c", bottomA: 0.36, vignette: 0.5 },
  saturation: 0.62,
  brightness: 0.8,
  rain: true,
};

/**
 * Look for a race: dusk races and evening posts are dusk; clear daytime posts are golden
 * hour; overcast and rain dim and desaturate. `hour` is the local hour of the post time.
 */
export function lookFor(weather: Weather, hour: number | null): TracksideLook {
  if (weather === "rain") return RAIN;
  if (weather === "overcast") return OVERCAST;
  if (weather === "clear" && hour !== null && hour >= 7 && hour < 17) return GOLDEN;
  return DUSK;
}
