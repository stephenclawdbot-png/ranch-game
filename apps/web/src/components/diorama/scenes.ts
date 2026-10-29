/**
 * Scene graphs for the HD-2D <Diorama>. Pure data (no DOM), so it is unit-testable.
 *
 * World units are ART PIXELS. `y` of an item is its BOTTOM edge (feet / base line); the
 * world's bottom edge is `height`. The camera sees the bottom of the world; taller viewports
 * reveal more sky (the sky colour continues upwards). `depth` is the parallax factor
 * relative to the focal plane (1 = moves with the camera); `blur` is depth-of-field blur in
 * art pixels (0 = tack sharp; the focal band is always 0).
 */
import { DIORAMA_ATLAS as A } from "./atlas.generated";
import type { DioramaHorseLook } from "./recolor";

export const DIORAMA_SCENES = ["yard", "paddock", "grandstand", "barn", "track-dusk", "pasture"] as const;
export type DioramaSceneId = (typeof DIORAMA_SCENES)[number];

export type Rect = readonly [x: number, y: number, w: number, h: number];

export interface StaticItem {
  /** Path under /art/. */
  src: string;
  x: number;
  /** Bottom edge. */
  y: number;
  rect?: Rect;
  flip?: boolean;
  /** Repeat horizontally across the whole layer, starting at x (period = image or rect width + gap). */
  tile?: boolean;
  gap?: number;
  alpha?: number;
  /** Soft contact shadow under the item: width in art px (0/undefined = none). */
  shadow?: number;
  /** Drawn every frame with a wind sway (grass, leaves) instead of being baked. */
  sway?: { amp: number; speed: number };
}

export interface FillBand {
  y0: number;
  y1: number;
  stops: readonly (readonly [number, string])[];
}

export interface AnimItem {
  src: string;
  fw: number;
  fh: number;
  frames: number;
  fps: number;
  x: number;
  /** Bottom edge (ground line). */
  y: number;
  phase?: number;
  flip?: boolean;
  /** Art px cut from the bottom of every frame (neck hidden behind a half-door). */
  cropBottom?: number;
  /** Recolour a keyed (race/palette.json) strip for this horse. */
  look?: DioramaHorseLook;
  /** Walks from `from` to `to` (world x of the sprite's left edge) at `speed` px/s, then repeats. */
  walk?: { from: number; to: number; speed: number; offset?: number };
  /** Ignores the camera scroll (gallopers that the camera tracks). */
  follow?: boolean;
  /** Slow drift around x while following (px amplitude, rad/s). */
  surge?: { amp: number; speed: number };
  shadow?: number;
  /** Extra sprites moving with this one (a groom leading the horse), x relative. */
  with?: readonly AnimItem[];
  /** Kicks up dust motes from the hooves (track). */
  dust?: boolean;
  /**
   * Level of detail: this strip's scale factor (1 = full HD size, 2 = its 2:1 copy...). When
   * set, the engine swaps in the "-sN" copy (exact box downsample, still integer-scale pixel
   * art) so the sprite always fits the box with headroom. Unset = fixed size (sprites in a
   * fixed plane, e.g. horses over stall doors).
   */
  lod?: number;
  /** Hide the sprite when the band needs a copy smaller than lodMax times its own scale. */
  lodMax?: number;
}

export interface Layer {
  id: string;
  depth: number;
  blur?: number;
  /** 0..1 mix toward the scene fog colour (aerial perspective). */
  haze?: number;
  /** Additive bloom of the layer's highlights (0..1). */
  bloom?: number;
  /** Horizontal repeat period (scrolling scenes); defaults to the world width + margins. */
  period?: number;
  /** Bake extent (world y). */
  y0: number;
  y1: number;
  fills?: readonly FillBand[];
  /** Bands painted OVER the items (contact shade at a wall base). */
  shade?: readonly FillBand[];
  /** Dark interiors painted under the items (stall openings): world rects + colour. */
  holes?: readonly { rect: Rect; color: string; src?: string }[];
  items: readonly StaticItem[];
  anims?: readonly AnimItem[];
}

export interface RaySet {
  /** Source point (world). */
  x: number;
  y: number;
  /** Direction of travel in degrees (0 = right, 90 = down). */
  angle: number;
  spread: number;
  count: number;
  length: number;
  width: number;
  color: string;
  alpha: number;
  depth: number;
  seed: number;
}

/** Out-of-focus framing pinned to a corner of the VIEW (branches hanging into the frame). */
export interface Overlay {
  src: string;
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  dx: number;
  dy: number;
  flip?: boolean;
  blur: number;
  depth: number;
  sway?: number;
}

export interface SceneDef {
  id: DioramaSceneId;
  label: string;
  width: number;
  height: number;
  /** World x the camera centres on. */
  focusX: number;
  /** World y kept in view when the box is short (banners); taller boxes anchor to the bottom. */
  focusY: number;
  /** Ground line of the focal band (feet): kept inside short views. */
  groundY?: number;
  /** Camera scroll speed (art px/s) for travelling shots; 0 = still diorama. */
  scroll: number;
  sky: { src: string | null; y: number; drift: number; top: string; bottom: string };
  fog: string;
  sun: { x: number; y: number; r: number; color: string; alpha: number };
  rays: readonly RaySet[];
  motes: { count: number; color: string; glow: string; wind: number; y0: number; y1: number; bokeh: number };
  grade: { top: string; topA: number; bottom: string; bottomA: number; vignette: number };
  layers: readonly Layer[];
  overlays?: readonly Overlay[];
  /** Colour grade baked into every animated sprite (dusk light). */
  sprites?: { color: string; alpha: number };
  /** Pointer / scroll parallax strength (default 1). Scenes with HTML pinned to sprites keep it low. */
  parallax?: number;
  /** Time (s) of the reduced-motion / poster frame. */
  posterT: number;
  poster: string;
}

// ---------------------------------------------------------------------------- helpers
const an = A.anims;
type AnimName = keyof typeof an;
function sheet(name: AnimName, x: number, y: number, extra: Partial<AnimItem> = {}): AnimItem {
  const a = an[name];
  return { src: `diorama/${name}.png`, fw: a.fw, fh: a.fh, frames: a.frames, fps: a.fps, x, y, ...extra };
}
const GALLOP: Omit<AnimItem, "x" | "y"> = { src: "race/horse-gallop.png", fw: 229, fh: 146, frames: 12, fps: 14 };
const FLAG: Omit<AnimItem, "x" | "y"> = { src: "race/bb-flag.png", fw: 90, fh: 100, frames: 8, fps: 8 };
const prop = (sheetName: "yard-props" | "barn-props" | "pasture-props", i: number, x: number, y: number, extra: Partial<StaticItem> = {}): StaticItem => ({
  src: `diorama/${sheetName}.png`,
  rect: A.props[sheetName][i] as unknown as Rect,
  x,
  y,
  ...extra,
});
const img = (src: string, x: number, y: number, extra: Partial<StaticItem> = {}): StaticItem => ({ src, x, y, ...extra });

const SILKS: [string, string, string][] = [
  ["#1f4e9c", "#f3e7c9", "#1f4e9c"],
  ["#8e2323", "#d9a441", "#d9a441"],
  ["#2b6a41", "#f6ecd3", "#2b6a41"],
  ["#f2c86a", "#1d140a", "#1d140a"],
  ["#6b3fa0", "#f6ecd3", "#f6ecd3"],
];

const yardHoles = A.holes["yard-stables"];
const barnHoles = A.holes["barn-stalls"];
const FACADE_X = 76;
const FACADE_BOTTOM = 276;
const STALLS_X = 76;
const STALLS_BOTTOM = 300;

type StallHorse = "stall-horse-bay" | "stall-horse-grey" | "stall-horse-chestnut" | "stall-horse-black";
/**
 * A horse leaning OUT over a half-door in hole `hole` of a facade at (ox, oy): head, neck and
 * chest show, the chest overlaps the door's top rail by `over` px (it is in front of it), the
 * rest of the body is hidden behind the door, and the ears stay just under the lintel.
 */
function overDoor(name: StallHorse, scale: 1 | 2 | 3, hole: readonly number[], ox: number, oy: number, dx: number, phase: number): AnimItem {
  const strip = (scale === 1 ? name : `${name}-s${scale}`) as AnimName;
  const a = an[strip] as { fw: number; fh: number; door?: number };
  const [hx, hy, hw, hh] = hole as [number, number, number, number];
  // the strip's door row (under the muzzle, across the neck) lands on the half-door line; the
  // rest of the neck is cropped, so it reads as running down behind the door
  const visible = Math.min(a.fh, a.door ?? hh - 1);
  return sheet(strip, ox + hx + Math.round((hw - a.fw) / 2) + dx, oy + hy + hh + (a.fh - visible), { cropBottom: a.fh - visible, phase, fps: 3 + (phase % 2) });
}

/** Lit stall interiors behind facade doorways (never a flat black hole). */
const interiors = (holes: readonly (readonly number[])[], ox: number, oy: number, s2: boolean) =>
  holes.map((h, i) => ({
    rect: [h[0]! + ox, h[1]! + oy, h[2]!, h[3]!] as const,
    color: "#1c1009",
    src: `diorama/stall-interior-${i % 4}${s2 ? "-s2" : ""}.png`,
  }));

// ---------------------------------------------------------------------------- scenes
const yard: SceneDef = {
  id: "yard",
  label: "Stable yard",
  width: 840,
  height: 360,
  focusX: 420,
  focusY: 255,
  groundY: 356,
  scroll: 0,
  sky: { src: "race/sky-clear.png", y: 250, drift: 2.2, top: "#3b6ea8", bottom: "#f3d9a4" },
  fog: "#f1d29a",
  sun: { x: 760, y: 70, r: 210, color: "#ffd98a", alpha: 0.55 },
  rays: [
    { x: 900, y: -60, angle: 128, spread: 26, count: 7, length: 560, width: 30, color: "#ffe2a0", alpha: 0.42, depth: 0.5, seed: 3 },
  ],
  motes: { count: 70, color: "#fff1c4", glow: "#ffd27a", wind: 6, y0: 40, y1: 360, bokeh: 7 },
  grade: { top: "#ffcf7a", topA: 0.08, bottom: "#1d140a", bottomA: 0.18, vignette: 0.42 },
  posterT: 17,
  poster: "diorama/poster-yard.png",
  overlays: [{ src: "diorama/fg-branch.png", corner: "top-left", dx: -40, dy: -24, blur: 2.4, depth: 1.6, sway: 2 }],
  layers: [
    {
      id: "hills",
      depth: 0.12,
      blur: 1.6,
      haze: 0.4,
      y0: 140,
      y1: 270,
      items: [img("race/far-hills.png", -300, 262)],
    },
    {
      id: "trees",
      depth: 0.3,
      blur: 1.1,
      haze: 0.2,
      y0: 20,
      y1: 280,
      items: [
        img("diorama/yard-trees.png", 76, 270),
        img("diorama/yard-trees.png", -560, 274, { flip: true }),
        img("diorama/yard-trees.png", 700, 276, { flip: true }),
      ],
    },
    {
      id: "stables",
      depth: 0.62,
      haze: 0.04,
      bloom: 0.25,
      y0: 0,
      y1: 300,
      fills: [{ y0: 262, y1: 300, stops: [[0, "#8a6a45"], [1, "#6d5136"]] }],
      holes: interiors(yardHoles, FACADE_X, FACADE_BOTTOM - 256, true),
      items: [
        img("race/bb-bush-b.png", 8, 280),
        img("race/bb-tree-poplar.png", 18, 280),
        img("race/bb-bush.png", 772, 282),
        img("race/bb-tree-poplar.png", 790, 282, { flip: true }),
        img("diorama/yard-stables.png", FACADE_X, FACADE_BOTTOM),
        prop("yard-props", 0, FACADE_X + 2, 286, { shadow: 80 }),
        prop("yard-props", 4, FACADE_X + 250, 282, { shadow: 26 }),
        prop("yard-props", 1, FACADE_X + 590, 288, { shadow: 70 }),
        prop("yard-props", 3, FACADE_X + 520, 286, { shadow: 46 }),
      ],
      anims: [
        overDoor("stall-horse-bay", 3, yardHoles[1]!, FACADE_X, FACADE_BOTTOM - 256, 2, 0),
        overDoor("stall-horse-chestnut", 3, yardHoles[4]!, FACADE_X, FACADE_BOTTOM - 256, 0, 3),
        overDoor("stall-horse-grey", 3, yardHoles[6]!, FACADE_X, FACADE_BOTTOM - 256, 2, 5),
        overDoor("stall-horse-black", 3, yardHoles[2]!, FACADE_X, FACADE_BOTTOM - 256, 2, 2),
      ],
    },
    {
      id: "cobbles",
      depth: 0.85,
      y0: 270,
      y1: 380,
      items: [img("diorama/yard-cobbles-s2.png", -500, 356, { tile: true }), img("diorama/yard-cobbles-s2.png", -160, 436, { tile: true, flip: true })],
      fills: [],
      shade: [{ y0: 276, y1: 300, stops: [[0, "rgba(30,14,6,0.55)"], [1, "rgba(30,14,6,0)"]] }],
    },
    {
      id: "focal",
      depth: 1,
      y0: 270,
      y1: 380,
      items: [prop("yard-props", 2, 700, 352, { shadow: 80 })],
      anims: [
        sheet("horse-walk-led", -260, 350, {
          walk: { from: -300, to: 1000, speed: 34 },
          shadow: 190,
          lod: 1,
          with: [sheet("groom-walk", 150, 356, { shadow: 50, lod: 1 })],
        }),
      ],
    },
    {
      id: "near",
      depth: 1.5,
      blur: 2.6,
      y0: -40,
      y1: 400,
      items: [
        img("diorama/fg-grass.png", -200, 384, { tile: true, sway: { amp: 3, speed: 1.3 } }),
        prop("barn-props", 0, 700, 404),
      ],
    },
  ],
};

const paddock: SceneDef = {
  id: "paddock",
  label: "Parade paddock",
  width: 880,
  height: 360,
  focusX: 440,
  focusY: 280,
  groundY: 358,
  scroll: 0,
  sky: { src: "race/sky-clear.png", y: 236, drift: 2.6, top: "#3b6ea8", bottom: "#f3d9a4" },
  fog: "#efd6a2",
  sun: { x: 120, y: 60, r: 220, color: "#ffd98a", alpha: 0.5 },
  rays: [{ x: -80, y: -60, angle: 52, spread: 24, count: 6, length: 560, width: 28, color: "#ffe2a0", alpha: 0.34, depth: 0.5, seed: 5 }],
  motes: { count: 60, color: "#fff1c4", glow: "#ffd27a", wind: 8, y0: 40, y1: 360, bokeh: 6 },
  grade: { top: "#ffcf7a", topA: 0.07, bottom: "#1d140a", bottomA: 0.16, vignette: 0.4 },
  posterT: 14.2,
  poster: "diorama/poster-paddock.png",
  overlays: [{ src: "diorama/fg-branch.png", corner: "top-right", dx: -30, dy: -30, flip: true, blur: 2.6, depth: 1.6, sway: 2 }],
  layers: [
    { id: "hills", depth: 0.1, blur: 1.6, haze: 0.42, y0: 120, y1: 250, items: [img("race/far-hills.png", -260, 236)] },
    {
      id: "trees",
      depth: 0.28,
      blur: 1.2,
      haze: 0.22,
      y0: 0,
      y1: 250,
      items: [
        img("race/bb-tree-oak.png", -40, 240),
        img("race/bb-tree-poplar.png", 170, 236),
        img("race/bb-tree-oak-b.png", 560, 238),
        img("race/bb-tree-oak.png", 720, 242, { flip: true }),
        img("race/bb-tree-poplar.png", 880, 240),
      ],
    },
    {
      id: "pavilion",
      depth: 0.42,
      blur: 0.6,
      haze: 0.1,
      y0: 0,
      y1: 252,
      items: [img("diorama/paddock-pavilion.png", 250, 262)],
      anims: [{ ...FLAG, x: 170, y: 262, phase: 2 }, { ...FLAG, x: 650, y: 262, phase: 5 }],
    },
    {
      id: "crowd",
      depth: 0.55,
      blur: 0.4,
      haze: 0.06,
      y0: 200,
      y1: 290,
      items: [img("diorama/crowd-s2.png", -120, 278, { tile: true })],
      fills: [{ y0: 270, y1: 290, stops: [[0, "#3f6b33"], [1, "#4c7a3a"]] }],
    },
    {
      id: "lawn",
      depth: 0.7,
      y0: 270,
      y1: 380,
      fills: [{ y0: 270, y1: 380, stops: [[0, "#557f3c"], [1, "#3f6b33"]] }],
      items: [img("race/tex-turf.png", -200, 400, { tile: true, alpha: 0.9 }), img("race/rail-far.png", -150, 300, { tile: true })],
      anims: [0, 1, 2].map((i) =>
        sheet("horse-walk-jockey-s2", 0, 312, {
          flip: true,
          look: { coat: (["grey", "chestnut", "black"] as const)[i]!, silks: SILKS[(i + 2) % SILKS.length] },
          walk: { from: 960, to: -200, speed: 17, offset: i * 22 },
          phase: i * 3,
          shadow: 80,
          lod: 2,
          with: [sheet("groom-walk-s2", -6, 316, { flip: true, shadow: 22, lod: 2 })],
        }),
      ),
    },
    {
      id: "ring",
      depth: 0.9,
      y0: 300,
      y1: 390,
      fills: [{ y0: 326, y1: 380, stops: [[0, "#9a7a52"], [0.5, "#b08a5a"], [1, "#8a6a45"]] }],
      items: [],
    },
    {
      id: "focal",
      depth: 1,
      y0: 160,
      y1: 380,
      items: [],
      anims: [0, 1, 2].map((i) =>
        sheet("horse-walk-jockey", 0, 352, {
          look: { coat: (["bay", "dark_bay", "chestnut"] as const)[i]!, silks: SILKS[i]! },
          walk: { from: -320, to: 1100, speed: 33, offset: i * 15.5 },
          phase: i * 2,
          shadow: 190,
          lod: 1,
          with: [sheet("groom-walk", 140, 358, { shadow: 50, phase: i, lod: 1 })],
        }),
      ),
    },
    {
      id: "near",
      depth: 1.45,
      blur: 2.8,
      y0: 240,
      y1: 420,
      items: [img("race/rail-near.png", -200, 396, { tile: true }), img("race/bb-crowd-b.png", 600, 452), img("race/bb-crowd-a.png", -250, 448)],
    },
  ],
};

const grandstand: SceneDef = {
  id: "grandstand",
  label: "Grandstand",
  width: 900,
  height: 360,
  focusX: 450,
  focusY: 270,
  groundY: 358,
  scroll: 0,
  sky: { src: "race/sky-clear.png", y: 250, drift: 3, top: "#3b6ea8", bottom: "#f3d9a4" },
  fog: "#efd6a2",
  sun: { x: 820, y: 50, r: 230, color: "#ffd98a", alpha: 0.55 },
  rays: [{ x: 980, y: -80, angle: 125, spread: 22, count: 6, length: 560, width: 30, color: "#ffe2a0", alpha: 0.36, depth: 0.5, seed: 9 }],
  motes: { count: 55, color: "#fff1c4", glow: "#ffd27a", wind: 10, y0: 40, y1: 360, bokeh: 6 },
  grade: { top: "#ffcf7a", topA: 0.07, bottom: "#1d140a", bottomA: 0.16, vignette: 0.4 },
  posterT: 4.6,
  poster: "diorama/poster-grandstand.png",
  layers: [
    { id: "hills", depth: 0.1, blur: 1.6, haze: 0.42, y0: 150, y1: 270, items: [img("race/far-hills.png", -240, 262)] },
    {
      id: "trees",
      depth: 0.25,
      blur: 1.2,
      haze: 0.22,
      y0: 0,
      y1: 240,
      items: [img("race/bb-tree-oak-b.png", -60, 272), img("race/bb-tree-poplar.png", 100, 270), img("race/bb-tree-oak.png", 740, 274, { flip: true })],
    },
    {
      id: "stand",
      depth: 0.5,
      blur: 0.5,
      haze: 0.08,
      bloom: 0.2,
      y0: -40,
      y1: 312,
      items: [img("diorama/grandstand-s2.png", 300, 300), img("race/bb-tree-poplar.png", 250, 296), img("race/bb-bush-b.png", 610, 302), img("diorama/crowd-s2.png", -200, 314, { tile: true })],
      anims: [{ ...FLAG, x: 200, y: 300, phase: 1 }, { ...FLAG, x: 680, y: 302, phase: 4 }],
    },
    {
      id: "track",
      depth: 0.8,
      y0: 290,
      y1: 390,
      fills: [{ y0: 300, y1: 390, stops: [[0, "#4f7c39"], [1, "#355f2c"]] }],
      items: [img("race/track-turf.png", -200, 396, { tile: true }), img("race/track-turf.png", -72, 460, { tile: true }), img("race/rail-far.png", -150, 326, { tile: true })],
    },
    {
      id: "focal",
      depth: 1,
      y0: 120,
      y1: 380,
      items: [img("race/finish-post.png", 610, 354, { shadow: 30 })],
      anims: [
        { ...sheet("horse-canter", 0, 342), look: { coat: "chestnut", silks: SILKS[1] }, walk: { from: -320, to: 1300, speed: 150 }, shadow: 170, dust: true, lod: 1 },
        { ...sheet("horse-canter", 0, 356), look: { coat: "bay", silks: SILKS[0] }, walk: { from: -320, to: 1300, speed: 150, offset: 5.5 }, phase: 4, shadow: 170, dust: true, lod: 1 },
      ],
    },
    {
      id: "near",
      depth: 1.45,
      blur: 2.8,
      y0: 250,
      y1: 420,
      items: [img("race/rail-near.png", -200, 400, { tile: true }), img("race/hedge-near.png", -220, 432, { tile: true })],
    },
  ],
};

const barn: SceneDef = {
  id: "barn",
  label: "Barn",
  width: 840,
  height: 360,
  focusX: 420,
  focusY: 165,
  groundY: 356,
  scroll: 0,
  sky: { src: null, y: 0, drift: 0, top: "#120904", bottom: "#2a170c" },
  fog: "#3a2010",
  sun: { x: 230, y: 40, r: 160, color: "#ffc970", alpha: 0.45 },
  rays: [
    { x: 196, y: -10, angle: 62, spread: 10, count: 5, length: 460, width: 30, color: "#ffd58a", alpha: 0.5, depth: 0.45, seed: 11 },
    { x: 530, y: -10, angle: 62, spread: 10, count: 5, length: 460, width: 30, color: "#ffd58a", alpha: 0.46, depth: 0.45, seed: 12 },
  ],
  motes: { count: 110, color: "#ffe7b0", glow: "#ffbe5c", wind: 2, y0: -60, y1: 360, bokeh: 9 },
  grade: { top: "#ffb25a", topA: 0.05, bottom: "#0b0705", bottomA: 0.28, vignette: 0.55 },
  posterT: 6.4,
  poster: "diorama/poster-barn.png",
  layers: [
    {
      id: "wall",
      depth: 0.35,
      blur: 1,
      haze: 0.12,
      bloom: 0.5,
      y0: -420,
      y1: 222,
      fills: [{ y0: -420, y1: -60, stops: [[0, "#0e0703"], [0.7, "#1f1008"], [1, "#2a170c"]] }],
      shade: [{ y0: -70, y1: -20, stops: [[0, "rgba(18,9,4,0.95)"], [1, "rgba(18,9,4,0)"]] }],
      items: [img("diorama/barn-wall.png", -560, 220, { tile: true })],
    },
    {
      id: "stalls",
      depth: 0.72,
      y0: 60,
      y1: 310,
      fills: [{ y0: 200, y1: 310, stops: [[0, "#3a2414"], [1, "#2a190e"]] }],
      holes: interiors(barnHoles, STALLS_X, STALLS_BOTTOM - 224, false),
      items: [img("diorama/barn-stalls.png", STALLS_X, STALLS_BOTTOM), prop("barn-props", 2, STALLS_X + 236, 140)],
      anims: [
        overDoor("stall-horse-bay", 1, barnHoles[1]!, STALLS_X, STALLS_BOTTOM - 224, 4, 0),
        overDoor("stall-horse-grey", 1, barnHoles[4]!, STALLS_X, STALLS_BOTTOM - 224, 2, 3),
        overDoor("stall-horse-chestnut", 1, barnHoles[7]!, STALLS_X, STALLS_BOTTOM - 224, 4, 5),
      ],
    },
    {
      id: "floor",
      depth: 0.9,
      y0: 290,
      y1: 420,
      items: [img("diorama/barn-floor.png", -560, 418, { tile: true })],
    },
    {
      id: "focal",
      depth: 1,
      y0: 150,
      y1: 380,
      items: [prop("barn-props", 3, 50, 334, { shadow: 70 }), prop("barn-props", 5, 136, 336, { shadow: 34 }), prop("barn-props", 4, 196, 326), prop("barn-props", 1, 744, 332, { shadow: 80 })],
      anims: [sheet("horse-aisle-idle", 330, 354, { shadow: 210, lod: 1, lodMax: 1 })],
    },
    {
      id: "near",
      depth: 1.5,
      blur: 3,
      y0: 200,
      y1: 420,
      items: [prop("barn-props", 0, -20, 392), prop("barn-props", 0, 60, 402, { flip: true }), prop("barn-props", 0, 770, 400)],
    },
  ],
};

const dusk: SceneDef = {
  id: "track-dusk",
  label: "Track at dusk",
  width: 880,
  height: 360,
  focusX: 440,
  focusY: 280,
  groundY: 358,
  scroll: 120,
  sky: { src: "race/sky-dusk.png", y: 250, drift: 1.2, top: "#2b2156", bottom: "#ff9a52" },
  fog: "#d98a6a",
  sun: { x: 610, y: 210, r: 260, color: "#ff9b4a", alpha: 0.7 },
  rays: [{ x: 610, y: 215, angle: 180, spread: 120, count: 9, length: 520, width: 16, color: "#ffb070", alpha: 0.1, depth: 0.08, seed: 17 }],
  motes: { count: 60, color: "#ffd7a8", glow: "#ff9b4a", wind: -40, y0: 180, y1: 360, bokeh: 7 },
  grade: { top: "#5a3a8a", topA: 0.1, bottom: "#120a1c", bottomA: 0.3, vignette: 0.5 },
  sprites: { color: "#4a2a5a", alpha: 0.22 },
  posterT: 2.2,
  poster: "diorama/poster-track-dusk.png",
  layers: [
    { id: "hills", depth: 0.08, blur: 1.4, haze: 0.5, period: 1376, y0: 150, y1: 262, items: [img("race/far-hills.png", 0, 256)] },
    {
      id: "trees",
      depth: 0.3,
      blur: 1,
      haze: 0.42,
      period: 900,
      y0: 0,
      y1: 270,
      items: [
        img("race/bb-tree-oak.png", 20, 262),
        img("race/bb-tree-poplar.png", 260, 258),
        img("race/bb-tree-poplar.png", 300, 262),
        img("race/bb-tree-oak-b.png", 480, 264, { flip: true }),
        img("race/bb-tree-oak.png", 700, 260),
      ],
    },
    {
      id: "rail-far",
      depth: 0.62,
      haze: 0.2,
      period: 336,
      y0: 220,
      y1: 300,
      fills: [{ y0: 262, y1: 300, stops: [[0, "#4a5a34"], [1, "#3f5530"]] }],
      items: [img("race/rail-far.png", 0, 292, { tile: true })],
    },
    {
      id: "turf",
      depth: 0.85,
      haze: 0.08,
      period: 256,
      y0: 286,
      y1: 400,
      items: [img("race/track-turf.png", 0, 382, { tile: true }), img("race/track-turf.png", 0, 478, { tile: true })],
    },
    {
      id: "focal",
      depth: 1,
      y0: 150,
      y1: 380,
      items: [],
      anims: [
        { ...GALLOP, x: 120, y: 318, follow: true, surge: { amp: 26, speed: 0.31 }, look: { coat: "grey", silks: SILKS[4] }, phase: 3, shadow: 160, dust: true, lod: 1 },
        { ...GALLOP, x: 420, y: 328, follow: true, surge: { amp: 20, speed: 0.23 }, look: { coat: "black", silks: SILKS[3] }, phase: 7, shadow: 160, dust: true, lod: 1 },
        { ...GALLOP, x: 250, y: 342, follow: true, surge: { amp: 30, speed: 0.19 }, look: { coat: "chestnut", silks: SILKS[1] }, phase: 1, shadow: 160, dust: true, lod: 1 },
        { ...GALLOP, x: 540, y: 356, follow: true, surge: { amp: 24, speed: 0.27 }, look: { coat: "bay", silks: SILKS[0] }, phase: 9, shadow: 160, dust: true, lod: 1 },
      ],
    },
    {
      id: "near",
      depth: 1.5,
      blur: 2.8,
      period: 336,
      y0: 300,
      y1: 420,
      items: [img("race/rail-near.png", 0, 404, { tile: true })],
    },
  ],
};

/**
 * The paddock with the race's own runners parading (coat + silks from each horse): the first
 * three walk the near ring, the next three the far lawn. No runners yet = the Club's string.
 */
export function paddockScene(looks: DioramaHorseLook[]): SceneDef {
  if (!looks.length) return paddock;
  const near = looks.slice(0, 3);
  const far = looks.slice(3, 6);
  return {
    ...paddock,
    layers: paddock.layers.map((l) =>
      l.id === "focal"
        ? { ...l, anims: (l.anims ?? []).slice(0, near.length).map((a, i) => ({ ...a, look: near[i]! })) }
        : l.id === "lawn"
          ? { ...l, anims: (l.anims ?? []).slice(0, far.length).map((a, i) => ({ ...a, look: far[i]! })) }
          : l,
    ),
  };
}

// ---------------------------------------------------------------------------- the Ranch
/** Feet lines of the two herd rows (art px): the far row stands in the field, the near row on the meadow. */
export const PASTURE_ROWS = { far: 318, near: 352 } as const;

/** The stable's own horses turned out (untacked, keyed strips recoloured to each horse's genes). */
export function looseHorse(kind: "graze" | "idle" | "walk", size: 2 | 3, x: number, y: number, extra: Partial<AnimItem> = {}): AnimItem {
  return sheet(`horse-loose-${kind}-s${size}` as AnimName, x, y, { shadow: size === 2 ? 96 : 64, ...extra });
}

const pastureBase: SceneDef = {
  id: "pasture",
  label: "The paddocks",
  width: 880,
  height: 360,
  focusX: 440,
  focusY: 270,
  groundY: 356,
  scroll: 0,
  parallax: 0.15,
  sky: { src: "race/sky-clear.png", y: 236, drift: 2.4, top: "#3b6ea8", bottom: "#f3d9a4" },
  fog: "#efd6a2",
  sun: { x: 140, y: 50, r: 230, color: "#ffd98a", alpha: 0.5 },
  rays: [{ x: -60, y: -60, angle: 50, spread: 24, count: 6, length: 560, width: 28, color: "#ffe2a0", alpha: 0.3, depth: 0.5, seed: 7 }],
  motes: { count: 50, color: "#fff1c4", glow: "#ffd27a", wind: 7, y0: 60, y1: 360, bokeh: 6 },
  grade: { top: "#ffcf7a", topA: 0.07, bottom: "#1d140a", bottomA: 0.16, vignette: 0.38 },
  posterT: 6,
  poster: "diorama/poster-pasture.png",
  overlays: [{ src: "diorama/fg-branch.png", corner: "top-right", dx: -36, dy: -28, flip: true, blur: 2.6, depth: 1.6, sway: 2 }],
  layers: [
    { id: "country", depth: 0.14, blur: 1.2, haze: 0.32, y0: 100, y1: 266, items: [img("diorama/pasture-far.png", -190, 264, { tile: true })] },
    {
      id: "shelter",
      depth: 0.4,
      blur: 0.5,
      haze: 0.12,
      y0: 0,
      y1: 266,
      items: [img("race/bb-tree-oak.png", 660, 262), prop("pasture-props", 2, 70, 260, { shadow: 90 })],
    },
    {
      id: "fence",
      depth: 0.5,
      haze: 0.06,
      y0: 170,
      y1: 270,
      fills: [{ y0: 252, y1: 270, stops: [[0, "#6f9447"], [1, "#5d8a3c"]] }],
      items: [img("diorama/pasture-fence.png", -100, 264, { tile: true })],
    },
    {
      id: "field",
      depth: 0.62,
      y0: 248,
      y1: 330,
      items: [
        img("diorama/pasture-ground-s2.png", -120, 330, { tile: true }),
        prop("pasture-props", 1, 250, 280, { shadow: 70 }),
        prop("pasture-props", 0, 600, 284, { shadow: 60 }),
      ],
      anims: [],
    },
    { id: "meadow", depth: 0.85, y0: 318, y1: 400, items: [img("diorama/pasture-ground.png", -160, 482, { tile: true })] },
    { id: "herd", depth: 1, y0: 220, y1: 380, items: [], anims: [] },
    { id: "near", depth: 1.45, blur: 2.4, y0: 300, y1: 420, items: [img("diorama/fg-grass.png", -200, 380, { tile: true })] },
  ],
};

/** The pasture with the herd placed in (far row in the field, near row on the meadow). */
export function pastureScene(far: AnimItem[], near: AnimItem[]): SceneDef {
  return { ...pastureBase, layers: pastureBase.layers.map((l) => (l.id === "field" ? { ...l, anims: far } : l.id === "herd" ? { ...l, anims: near } : l)) };
}

export const SCENES: Record<DioramaSceneId, SceneDef> = { yard, paddock, grandstand, barn, "track-dusk": dusk, pasture: pastureBase };

/** Every art file a scene needs (for preloading and tests). */
export function sceneFiles(s: SceneDef): string[] {
  const out = new Set<string>();
  if (s.sky.src) out.add(s.sky.src);
  const addAnim = (a: AnimItem) => {
    out.add(a.src);
    a.with?.forEach(addAnim);
  };
  for (const l of s.layers) {
    l.items.forEach((i) => out.add(i.src));
    l.holes?.forEach((h) => h.src && out.add(h.src));
    l.anims?.forEach(addAnim);
  }
  s.overlays?.forEach((o) => out.add(o.src));
  return [...out];
}
