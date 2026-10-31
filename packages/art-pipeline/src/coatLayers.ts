/**
 * Coat layers (coat audit, 2026-11): every white pattern, marking, shade, rare colour and the
 * feathered long hair, drawn by PixelLab once on a reference horse (art-src/coat-layers) and
 * stored in horse space, so every view paints the same pattern in the same place of the horse.
 *
 * The atlas (race/coat-layers.png, a 2x copy for portraits) is a grid of cells, one per layer
 * variant. Each cell holds the layer in four horse spaces (see coatGeometry.ts):
 *   - body: u (rump -> nose) x v (under the top line), the barrel, neck, mane and long mane;
 *   - face: t (brow -> nose) x e (in from the profile edge / the face's centre line);
 *   - legs: g (hoof -> belly) x s (across the leg), one block per leg (near/far fore/hind);
 *   - tail: a (root -> tip) x l (across the tail).
 * Values: 0 = nothing; otherwise the layer's amount (white, tick, dark, light, skin) or, for
 * hair, 1..255 = long hair present, its shade.
 *
 * `coatPatternOf(appearance)` is THE per-horse pattern definition: which layers, which drawn
 * variants (from the appearance's pattern seed), which face and leg marking cells, the colours.
 * Race strips (Trackside shader and 3D), ranch and paddock sprites, the gallop sprite, share
 * cards and the 3/4 portrait all read it, so a horse looks the same everywhere.
 */
import type { FaceMarking, HorseAppearance, LegMarking } from "@thoroughbred/shared";
import { GEO_REGION, type CoatGeometry } from "./coatGeometry";
import { coatPaletteOf, mixOklab, MARKING_WHITE, type CoatPalette } from "./palettes";

export type LayerMode = "white" | "tick" | "dark" | "light" | "skin" | "hair";

/** The layer catalogue: id, how it paints, how many drawn variants (cells, in this order). */
export const COAT_LAYERS = [
  ["tobiano", "white", 3],
  ["tobiano-ink", "white", 2],
  ["leopard", "white", 3],
  ["blanket", "white", 2],
  ["fewspot", "white", 2],
  ["splash", "white", 2],
  ["splash2", "white", 1],
  ["sabino1", "white", 2],
  ["sabino2", "white", 2],
  ["birdcatcher", "white", 2],
  ["face-star", "white", 3],
  ["face-snip", "white", 2],
  ["face-stripe", "white", 2],
  ["face-blaze", "white", 3],
  ["face-bald", "white", 2],
  ["leg-coronet", "white", 2],
  ["leg-sock", "white", 2],
  ["leg-stocking", "white", 2],
  ["roan", "tick", 2],
  ["rabicano", "tick", 2],
  ["varnish", "tick", 1],
  ["greying", "tick", 1],
  ["dapple", "light", 2],
  ["dun", "dark", 2],
  ["sooty", "dark", 2],
  ["brindle", "dark", 3],
  ["bendor", "dark", 2],
  ["pangare", "light", 2],
  ["skin", "skin", 1],
  ["feather", "hair", 2],
] as const satisfies readonly (readonly [string, LayerMode, number])[];

export type LayerId = (typeof COAT_LAYERS)[number][0];
export const LAYER_IDS = COAT_LAYERS.map((l) => l[0]) as LayerId[];

/** First cell index of each layer (cells run in catalogue order, variants together). */
export const LAYER_CELL: Record<LayerId, number> = (() => {
  const out = {} as Record<LayerId, number>;
  let n = 0;
  for (const [id, , v] of COAT_LAYERS) {
    out[id] = n;
    n += v;
  }
  return out;
})();
export const LAYER_VARIANTS: Record<LayerId, number> = Object.fromEntries(COAT_LAYERS.map(([id, , v]) => [id, v])) as Record<LayerId, number>;
export const LAYER_MODE: Record<LayerId, LayerMode> = Object.fromEntries(COAT_LAYERS.map(([id, m]) => [id, m])) as Record<LayerId, LayerMode>;
export const CELL_COUNT = COAT_LAYERS.reduce((s, l) => s + l[2], 0);

// ---------------------------------------------------------------------------
// Atlas layout (1x; the 2x atlas doubles every number)
// ---------------------------------------------------------------------------

/** Atlas pixels per barrel depth H. */
export const ATLAS_PER_H = 48;
export const ATLAS_CELL = { w: 256, h: 144 } as const;
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = Math.ceil(CELL_COUNT / ATLAS_COLS);
/** Body space: u/H in [-0.6, 3.6], v/H in [-0.3, 1.6]. */
export const BODY = { x: 0, y: 0, u0: -0.6, u1: 3.6, v0: -0.3, v1: 1.6 } as const;
/** Face space: t in [0, 1] (rows), e/H in [0, 0.8] (columns). */
export const FACE = { x: 204, y: 0, w: 38, h: 48, e1: 0.8 } as const;
/** Tail space: a in [0, 1.7] (rows), l/H in [-0.35, 0.35]. */
export const TAIL = { x: 204, y: 50, w: 34, h: 48, a1: 1.7, l1: 0.35 } as const;
/** Leg space: g 1 (top) .. 0 (hoof) down the rows, s/H in [-0.45, 0.25]; four legs side by side. */
export const LEGS = { x: 0, y: 94, w: 34, h: 48, s0: -0.45, s1: 0.25 } as const;

export interface CoatAtlas {
  /** 1 (race, ranch, sprites) or 2 (portraits). */
  scale: number;
  width: number;
  height: number;
  /** One byte per atlas pixel. */
  data: Uint8Array;
}

/** Atlas size at a scale. */
export const atlasSize = (scale: number) => ({ width: ATLAS_COLS * ATLAS_CELL.w * scale, height: ATLAS_ROWS * ATLAS_CELL.h * scale });

/**
 * Cell-local atlas position (1x units, fractional) of a geometry point, or null outside every
 * space. `region` is a GEO_REGION; p1/p2/u/v as in CoatGeometry (texels), H the strip's barrel depth.
 */
export function spaceXY(region: number, p1: number, p2: number, u: number, v: number, H: number): [number, number] | null {
  if (region >= 1 && region <= 4) {
    const sx = (p2 / H - LEGS.s0) / (LEGS.s1 - LEGS.s0);
    if (sx < 0 || sx > 1) return null;
    return [LEGS.x + (region - 1) * LEGS.w + sx * (LEGS.w - 1), LEGS.y + (1 - Math.min(1, Math.max(0, p1))) * (LEGS.h - 1)];
  }
  if (region === GEO_REGION.face) {
    const ex = p2 / H / FACE.e1;
    if (ex > 1) return null;
    return [FACE.x + Math.max(0, ex) * (FACE.w - 1), FACE.y + Math.min(1, Math.max(0, p1)) * (FACE.h - 1)];
  }
  if (region === GEO_REGION.tail) {
    const lx = (p2 / H + TAIL.l1) / (2 * TAIL.l1);
    if (lx < 0 || lx > 1 || p1 > TAIL.a1) return null;
    return [TAIL.x + lx * (TAIL.w - 1), TAIL.y + (Math.max(0, p1) / TAIL.a1) * (TAIL.h - 1)];
  }
  if (region === GEO_REGION.body || region === GEO_REGION.mane) {
    const bx = (u / H - BODY.u0) / (BODY.u1 - BODY.u0);
    const by = (v / H - BODY.v0) / (BODY.v1 - BODY.v0);
    if (bx < 0 || bx > 1 || by < 0 || by > 1) return null;
    return [BODY.x + bx * ((BODY.u1 - BODY.u0) * ATLAS_PER_H - 1), BODY.y + by * ((BODY.v1 - BODY.v0) * ATLAS_PER_H - 1)];
  }
  return null;
}

/** Sample a cell at a cell-local 1x position (nearest). */
export function sampleCell(atlas: CoatAtlas, cell: number, x: number, y: number): number {
  const s = atlas.scale;
  const cx = (cell % ATLAS_COLS) * ATLAS_CELL.w * s;
  const cy = Math.floor(cell / ATLAS_COLS) * ATLAS_CELL.h * s;
  const px = cx + Math.min(ATLAS_CELL.w * s - 1, Math.max(0, Math.floor(x * s)));
  const py = cy + Math.min(ATLAS_CELL.h * s - 1, Math.max(0, Math.floor(y * s)));
  return atlas.data[py * atlas.width + px] ?? 0;
}

// ---------------------------------------------------------------------------
// The per-horse pattern definition
// ---------------------------------------------------------------------------

export interface PatternLayer {
  id: LayerId;
  cell: number;
  mode: LayerMode;
  /** Strength 0..1 (sooty light / heavy, dapples...). */
  amount: number;
  /** Paint colour (dark, light, skin) or the white. */
  colour: string;
}

export interface CoatPattern {
  /** The palette every view recolours with (coatPaletteOf). */
  palette: CoatPalette;
  /** Shading, ticking and white layers in paint order (markings come after). */
  layers: PatternLayer[];
  /** Face marking drawn (splash and sabino can raise it) and its cell, or -1. */
  face: FaceMarking;
  faceCell: number;
  /** Per leg (front-left, front-right, hind-left, hind-right): the leg-marking cell or -1. */
  legs: [number, number, number, number];
  legMarks: [LegMarking, LegMarking, LegMarking, LegMarking];
  /** Feathered long hair: its cell, or -1. */
  featherCell: number;
  /** The pattern seed it was drawn from. */
  seed: number;
}

const FACE_ORDER: FaceMarking[] = ["none", "star", "snip", "stripe", "blaze", "bald"];
const LEG_ORDER: LegMarking[] = ["none", "coronet", "sock", "stocking"];
const atLeast = <T>(order: T[], v: T, min: T): T => (order.indexOf(v) >= order.indexOf(min) ? v : min);

/** Deterministic 32-bit mix (same in every view). */
export function patternHash(seed: number, salt: string): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < salt.length; i++) h = Math.imul(h ^ salt.charCodeAt(i), 0x01000193) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  return h >>> 0;
}

/** The appearance's pattern seed: the genome's marking seed, or a stable hash of the look. */
export function patternSeedOf(a: HorseAppearance): number {
  if (a.colour?.seed !== undefined) return a.colour.seed >>> 0;
  const s = JSON.stringify([a.coat, a.face, a.legs, a.colour ?? null, a.dun ?? false]);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const WHITE = MARKING_WHITE;
const BRINDLE = "#2a1810";
const BEND_OR = "#3a1c10";
const PANGARE = "#ead2a2";

/** The one pattern definition every view draws (see the module comment). */
export function coatPatternOf(a: HorseAppearance): CoatPattern {
  const palette = coatPaletteOf(a);
  const col = a.colour;
  const seed = patternSeedOf(a);
  const pick = (id: LayerId) => LAYER_CELL[id] + (patternHash(seed, id) % LAYER_VARIANTS[id]);
  const layers: PatternLayer[] = [];
  const add = (id: LayerId, amount = 1, colour = WHITE) => layers.push({ id, cell: pick(id), mode: LAYER_MODE[id], amount, colour });
  const grey = col?.grey ?? (a.coat === "grey" ? "white" : a.coat === "dapple_grey" ? "dapple" : "none");
  const greyedOut = grey === "dapple" || grey === "white";
  const domWhite = !!col?.dominantWhite;
  let face: FaceMarking = a.face ?? "none";
  const legMarks = [...(a.legs ?? ["none", "none", "none", "none"])] as CoatPattern["legMarks"];

  if (!domWhite) {
    // shading (pigment: hidden once a grey has greyed out)
    if (!greyedOut) {
      if (a.dun || col?.dun) add("dun", 1, palette.stripe ?? mixOklab(palette.shade, "#000000", 0.45));
      if (col?.sooty) add("sooty", col.sooty === 2 ? 1 : 0.6, mixOklab(palette.shade, "#000000", 0.35));
      if (col?.pangare) add("pangare", 0.8, PANGARE);
      if (col?.brindle) add("brindle", 1, mixOklab(palette.shade, BRINDLE, 0.55));
      if (col?.bendOr) add("bendor", 1, BEND_OR);
    }
    if (grey === "dapple" || (!col && a.coat === "dapple_grey")) add("dapple", 1, mixOklab(palette.highlight, "#ffffff", 0.45));
    // ticking
    if (grey === "greying") add("greying");
    if ((col?.roan || (!col && a.coat === "roan")) && !greyedOut) add("roan");
    if (col?.rabicano) add("rabicano");
    if (col?.leopard === "varnish") add("varnish");
    // white patterns
    if (col?.sabino === 2) add("sabino2");
    else if (col?.sabino === 1) add("sabino1");
    if (col?.tobiano === 2) add("tobiano-ink");
    else if (col?.tobiano === 1) add("tobiano");
    if (col?.splash === 2) add("splash2");
    else if (col?.splash === 1) add("splash");
    if (col?.leopard === "leopard") add(patternHash(seed, "patn1") % 5 < 3 ? "leopard" : "blanket");
    else if (col?.leopard === "fewspot") add("fewspot");
    if (col?.birdcatcher) add("birdcatcher");
    // pink skin: two creams, champagne, pearl with cream, leopard mottling
    if (col && (col.cream === 2 || col.champagne || (col.pearl && col.cream > 0) || col.leopard)) add("skin", 1, palette.muzzle);
    // markings raised by the white genes (the portrait follows the same rules)
    if (col?.splash === 2) face = "bald";
    else if (col?.splash === 1) face = atLeast(FACE_ORDER, face, "blaze");
    // (max sabino's own layer whitens the face and legs; the named markings stay as named)
    if (col?.splash === 2) for (let i = 0; i < 4; i++) legMarks[i] = atLeast(LEG_ORDER, legMarks[i]!, "stocking");
  } else {
    face = "none";
    for (let i = 0; i < 4; i++) legMarks[i] = "none";
  }
  const faceId = face === "none" ? null : (`face-${face}` as LayerId);
  const legCell = (m: LegMarking) => (m === "none" ? -1 : pick(`leg-${m}` as LayerId));
  return {
    palette,
    layers,
    face,
    faceCell: faceId ? pick(faceId) : -1,
    legs: legMarks.map(legCell) as CoatPattern["legs"],
    legMarks,
    featherCell: a.feather ? pick("feather") : -1,
    seed,
  };
}

/** Leg tuple index (front-left, front-right, hind-left, hind-right) of a leg region (near = right side, facing right). */
export const LEG_OF_REGION: Record<number, number> = { [GEO_REGION.frontNear]: 1, [GEO_REGION.frontFar]: 0, [GEO_REGION.hindNear]: 3, [GEO_REGION.hindFar]: 2 };

// ---------------------------------------------------------------------------
// CPU painter (3D strips, photo finish, ranch and paddock sprites, gallop sprite, share cards)
// ---------------------------------------------------------------------------

type RGB = [number, number, number];
const toRgb = (h: string): RGB => {
  const n = Number.parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lerp = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export interface KeyRoles {
  coat: readonly string[];
  mane?: readonly string[];
  points?: readonly string[];
  hoof?: readonly string[];
}

/** Per key colour: its role (1 coat, 2 points, 3 mane) and its shade 0 (dark) .. 1 (light) in its ramp. */
export function keyShades(keys: KeyRoles): Map<number, { role: number; shade: number }> {
  const out = new Map<number, { role: number; shade: number }>();
  const put = (ramp: readonly string[] | undefined, role: number) => ramp?.forEach((h, i) => out.set(Number.parseInt(h.slice(1), 16), { role, shade: ramp.length > 1 ? i / (ramp.length - 1) : 0.6 }));
  put(keys.coat, 1);
  put(keys.points, 2);
  put(keys.hoof, 2);
  put(keys.mane, 3);
  return out;
}

/** The white of a white layer at a shade (the frame's own shading carries over). */
export function whiteAt(shade: number): RGB {
  const w = toRgb(WHITE);
  const dark = lerp(w, [120, 116, 128], 0.55);
  return shade < 0.6 ? lerp(dark, w, shade / 0.6) : lerp(w, [255, 255, 255], (shade - 0.6) / 0.4);
}

/** The value of `cell` at geometry texel i (0 when outside its spaces). */
export function layerAt(atlas: CoatAtlas, cell: number, geo: CoatGeometry, i: number): number {
  const xy = spaceXY(geo.region[i]!, geo.p1[i]!, geo.p2[i]!, geo.u[i]!, geo.v[i]!, geo.H);
  return xy ? sampleCell(atlas, cell, xy[0], xy[1]) : 0;
}

/**
 * Grow the feathered long hair into a keyed strip (before recolouring): leg hair takes the key of
 * the leg texel it grows from (so it is coat-coloured over a dark leg and turns white with the
 * leg's marking later), mane and tail hair a mane key by its shade. Returns the hair flags.
 */
export function growFeather(keyed: Uint8ClampedArray | Uint8Array, width: number, frameW: number, geo: CoatGeometry, atlas: CoatAtlas, cell: number, keys: KeyRoles): Uint8Array {
  const hair = new Uint8Array(geo.frames * geo.fw * geo.fh);
  const mane = (keys.mane ?? []).map((h) => toRgb(h));
  if (cell < 0 || !mane.length) return hair;
  const at = (f: number, x: number, y: number) => (y * width + f * frameW + x) * 4;
  for (let f = 0; f < geo.frames; f++)
    for (let y = 0; y < geo.fh; y++)
      for (let x = 0; x < geo.fw; x++) {
        const i = (f * geo.fh + y) * geo.fw + x;
        const r = geo.region[i]!;
        if (!r) continue;
        const v = layerAt(atlas, cell, geo, i);
        if (!v) continue;
        const o = at(f, x, y);
        if (r >= 1 && r <= 4) {
          const s = geo.src[i]!;
          if (!geo.outside[i] || s < 0) {
            hair[i] = 1;
            continue; // hair over the leg itself: keep the leg's own key (markings follow it)
          }
          const sx = s % geo.fw;
          const sy = Math.floor(s / geo.fw) % geo.fh;
          const so = at(f, sx, sy);
          keyed[o] = keyed[so]!;
          keyed[o + 1] = keyed[so + 1]!;
          keyed[o + 2] = keyed[so + 2]!;
          keyed[o + 3] = 255;
          hair[i] = 1;
        } else if (r === GEO_REGION.tail || r === GEO_REGION.mane || r === GEO_REGION.body) {
          // the mane's own ramp by the painting's shade (never its darkest outline key)
          const k = mane[Math.min(mane.length - 1, Math.max(Math.min(1, mane.length - 1), Math.round(((v - 1) / 254) * (mane.length - 1))))]!;
          keyed[o] = k[0];
          keyed[o + 1] = k[1];
          keyed[o + 2] = k[2];
          keyed[o + 3] = 255;
          hair[i] = 2;
        }
      }
  return hair;
}

/**
 * Paint the pattern layers and markings over a recoloured strip (`out`, same layout as the keyed
 * source it was recoloured from). `keyed` gives each texel's role and shade.
 */
export function paintCoatLayers(
  out: Uint8ClampedArray | Uint8Array,
  keyed: Uint8ClampedArray | Uint8Array,
  width: number,
  frameW: number,
  geo: CoatGeometry,
  pattern: CoatPattern,
  atlas: CoatAtlas,
  keys: KeyRoles,
  hair: Uint8Array | null = null,
): void {
  const shades = keyShades(keys);
  const legWhite = pattern.legs;
  for (let f = 0; f < geo.frames; f++)
    for (let y = 0; y < geo.fh; y++)
      for (let x = 0; x < geo.fw; x++) {
        const i = (f * geo.fh + y) * geo.fw + x;
        const r = geo.region[i]!;
        if (!r) continue;
        const o = (y * width + f * frameW + x) * 4;
        if (out[o + 3]! < 128) continue;
        const k = shades.get((keyed[o]! << 16) | (keyed[o + 1]! << 8) | keyed[o + 2]!);
        if (!k) continue; // tack, ink, rider
        const role = k.role;
        const isHair = role === 3 || (hair?.[i] ?? 0) === 2;
        let c: RGB = [out[o]!, out[o + 1]!, out[o + 2]!];
        let white = false;
        for (const L of pattern.layers) {
          if (L.mode === "skin" && r !== GEO_REGION.face) continue;
          const v = layerAt(atlas, L.cell, geo, i);
          if (!v) continue;
          if (L.mode === "white") {
            // white patterns reach the tail (tail space) but never the mane, long or short
            if (v >= 128 && !(isHair && r !== GEO_REGION.tail)) white = true;
          } else if (isHair) {
            continue; // shading and ticking stay on the coat, never on the mane or tail
          } else if (L.mode === "tick") {
            if (v >= 128 && !white) c = lerp(c, [255, 255, 255], 0.45);
          } else if (L.mode === "dark" || L.mode === "light") {
            c = lerp(c, toRgb(L.colour), Math.min(1, (v / 255) * L.amount * (L.mode === "light" ? 0.75 : 0.85)));
          } else if (L.mode === "skin") {
            if (v >= 128) c = lerp(c, toRgb(L.colour), 0.8);
          }
        }
        if (r === GEO_REGION.face && pattern.faceCell >= 0 && role !== 3 && layerAt(atlas, pattern.faceCell, geo, i) >= 128) white = true;
        if (r >= 1 && r <= 4) {
          const cell = legWhite[LEG_OF_REGION[r]!]!;
          if (cell >= 0 && layerAt(atlas, cell, geo, i) >= 128) white = true;
        }
        if (white) c = whiteAt(isHair ? 0.55 + k.shade * 0.45 : k.shade);
        // long hair strands: the painting's shade over the colour underneath
        if (hair?.[i] && pattern.featherCell >= 0) {
          const hv = layerAt(atlas, pattern.featherCell, geo, i);
          if (hv) c = c.map((ch) => Math.min(255, ch * (0.84 + 0.3 * ((hv - 1) / 254)))) as RGB;
        }
        out[o] = Math.round(c[0]);
        out[o + 1] = Math.round(c[1]);
        out[o + 2] = Math.round(c[2]);
      }
}

/**
 * Everything for one keyed strip: grow the long hair (feathered horses), recolour (the caller's
 * recolour, in place on the RGBA it is given), then paint the layers. Returns the painted RGBA.
 */
export function paintCoatStrip(
  keyedSrc: Uint8ClampedArray | Uint8Array,
  width: number,
  frameW: number,
  geo: CoatGeometry,
  appearance: HorseAppearance,
  atlas: CoatAtlas | null,
  keys: KeyRoles,
  recolour: (data: Uint8ClampedArray<ArrayBuffer>) => void,
): Uint8ClampedArray<ArrayBuffer> {
  const keyed = new Uint8ClampedArray(keyedSrc);
  const pattern = coatPatternOf(appearance);
  const hair = atlas && pattern.featherCell >= 0 ? growFeather(keyed, width, frameW, geo, atlas, pattern.featherCell, keys) : null;
  const out = new Uint8ClampedArray(keyed);
  recolour(out);
  if (atlas) paintCoatLayers(out, keyed, width, frameW, geo, pattern, atlas, keys, hair);
  return out;
}

/** Decode the atlas PNG's pixels (RGBA, the value in R) into a CoatAtlas. */
export function atlasFromRgba(rgba: ArrayLike<number>, width: number, height: number, scale: number): CoatAtlas {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4]!;
  return { scale, width, height, data };
}
