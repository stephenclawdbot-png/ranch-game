/**
 * Indexed horse strips for the Trackside view (pure array code; no DOM).
 *
 * The keyed PixelLab strips (race/horse-gallop.png, race/horse-idle.png) are converted ONCE
 * to palette-index textures (one byte per texel) shared by every horse. Per-horse coat and
 * silks colours live in a small lookup table (one row per runner), so twelve runners cost
 * twelve LUT rows instead of twelve recoloured strips. Smaller levels of detail are exact
 * s:1 downsamples that keep palette indices (block mode, darkest wins ties), so a far or
 * zoomed-out horse is still hard-edged palette art, never a resampled blur.
 */
import type { HorseAppearance } from "@thoroughbred/shared";
import { buildCoatGeometry, coatPatternOf, findSaddleCloth, saddleClothOf, GEO_REGION, longHair, type HairField, type LongHair, rampRgb, resolveHorseColors, riderSkinLevel, skinKeyLevel, type CoatGeometry, type RoleGrid, type SaddleClothLook, type SaddleClothMask } from "@thoroughbred/art-pipeline";
import { buildRecolorPlan, type KeyPalette } from "../three/recolor";
import { clothOffByUrl } from "../cloth";
import { frameOrigin, type IndexedFrames, type Palette } from "./indexed";

// the palette and the indexed levels of detail live in indexed.ts (the sheet decoder needs only those)
export { MAX_COLOURS, downsampleFrames, frameOrigin, indexOf, indexStrip, newPalette, type IndexedFrames, type Palette } from "./indexed";

/** LUT width: [0, 64) base colour per index, [64, 128) silks-pattern colour per index,
 * 128 marking flags, 129 marking white, 130 dun stripe colour, 131..134 the rider's skin
 * (dark -> light), 135..137 the rider's hair, 138 rider flags, 139 the saddle cloth, then the coat
 * pattern (art-pipeline coatPatternOf): 140..155 eight layer slots (params, colour), 156 face
 * and feather cells and the slot count, 157 the four leg-marking cells. */
export const LUT_W = 158;
/** First coat-layer slot column (two columns per slot: R cell, G mode, B amount; then RGB colour). */
export const LUT_SLOT_X = 140;
export const LUT_SLOTS = 8;
/** R face cell, G feathered long hair (1; 255 = none), B slot count. */
export const LUT_CELLS_X = 156;
/** RGBA: the leg-marking cell of front-left, front-right, hind-left, hind-right (255 = none). */
export const LUT_LEGS_X = 157;
/** Layer modes as the shader reads them. */
export const MODE_ID: Record<string, number> = { white: 1, tick: 2, dark: 3, light: 4, skin: 5 };
/** LUT columns of the rider's look (jockey looks): skin x4, hair x3, flags (R: has a look, G: long hair). */
export const LUT_SKIN_X = 131;
export const LUT_HAIR_X = 135;
export const LUT_RIDER_X = 138;
/** LUT column of the per-runner marking flags (R: leg levels packed 2 bits x4, G: face | coat pattern<<4). */
export const LUT_FLAG_X = 128;
/** LUT column of the marking paint colour (warm white, MARKING_WHITE in art-pipeline/palettes). */
export const LUT_WHITE_X = 129;
/** LUT column of the dun stripe colour (dorsal stripe / leg barring; alpha 0 = legacy darkening). */
export const LUT_STRIPE_X = 130;
/** LUT column of the saddle cloth (V-03): RGB the gate colour, A the gate number (0 = the strip's white cloth). */
export const LUT_CLOTH_X = 139;
/** LUT column of the cloth's number colour: palette index 0 (transparent) never reads its own column. */
export const LUT_CLOTH_NUM_X = 0;
export const MARKING_WHITE = 0xf3f0e8;
/** Silks pattern ids (shader). */
export const PATTERN_ID: Record<string, number> = { solid: 0, hoops: 1, stripes: 2, quartered: 3, sash: 4, chevron: 5, diamonds: 6, stars: 7 };

/** Leg marking levels (mask shader), indexed by LegMarking. */
export const LEG_LEVEL: Record<string, number> = { none: 0, coronet: 1, sock: 2, stocking: 3 };
/** Face marking ids (mask shader), indexed by FaceMarking. */
export const FACE_ID: Record<string, number> = { none: 0, star: 1, snip: 2, stripe: 3, blaze: 4, bald: 5 };
/** Coat pattern ids (mask shader), indexed by the coat texture in art-pipeline/palettes. */
export const COAT_PATTERN_ID: Record<string, number> = { none: 0, roan: 1, dapple: 2 };

/** Marking mask regions (mask R channel). */
export const MARK_REGION = { none: 0, frontNear: 1, frontFar: 2, hindNear: 3, hindFar: 4, face: 5, body: 6, riderFace: 7, riderHair: 8, cap: 9, womanTrim: 10, womanTexel: 11, mane: 12, tail: 13, cloth: 14, hair: 16 } as const;

/** Per-frame bounding box (frame-local source texels: x0, y0, w, h) of the silks primary keys. */
export function silkBoxes(src: IndexedFrames, primary: Set<number>): Float32Array {
  const out = new Float32Array(src.frames * 4);
  for (let f = 0; f < src.frames; f++) {
    const [ox, oy] = frameOrigin(src, f);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let y = 0; y < src.fh; y++) {
      for (let x = 0; x < src.fw; x++) {
        if (!primary.has(src.index[(oy + y) * src.width + ox + x]!)) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 >= x0) out.set([x0, y0, x1 - x0 + 1, y1 - y0 + 1], f * 4);
    else out.set([0, 0, 1, 1], f * 4);
  }
  return out;
}

/** Palette indices of the silks primary keys. */
export function primaryIndices(palette: Palette, keys: KeyPalette): Set<number> {
  const set = new Set<number>();
  for (const h of keys.silksPrimary ?? []) {
    const i = palette.lookup.get(Number.parseInt(h.slice(1), 16));
    if (i !== undefined) set.add(i);
  }
  return set;
}

/** Role grid of an indexed strip for the shared coat geometry (art-pipeline coatGeometry). */
export function indexedRoleGrid(src: IndexedFrames, palette: Palette, keys: KeyPalette): RoleGrid {
  const roles = new Uint8Array(256).fill(4);
  roles[0] = 0;
  const put = (ramp: string[] | undefined, role: number) => {
    for (const h of ramp ?? []) {
      const i = palette.lookup.get(Number.parseInt(h.slice(1), 16));
      if (i !== undefined) roles[i] = role;
    }
  };
  put(keys.coat, 1);
  put(keys.points, 2);
  put(keys.hoof, 2);
  put(keys.mane, 3);
  put(keys.cap, 5);
  return {
    frames: src.frames,
    fw: src.fw,
    fh: src.fh,
    role(f, x, y) {
      const [ox, oy] = frameOrigin(src, f);
      return roles[src.index[(oy + y) * src.width + ox + x]!]!;
    },
  };
}

/**
 * Marking masks at a strip's level of detail 0 (one RGBA texel per source texel, same frame
 * grid), from the shared coat geometry (art-pipeline coatGeometry: the same horse spaces every
 * view paints the coat layers in):
 *   R = region (MARK_REGION: 1/2 front legs near/far, 3/4 hind legs near/far, 5 face, 6 body,
 *       12 mane, 13 tail; + 16 for an empty texel where long hair may grow; 7..11 the rider),
 *   G = legacy param (legs: 0 at the hoof .. 1 at the belly; face: brow .. nose; body: texels
 *       under the top line * 32), B = face only: texels from the profile edge * 32.
 * `coatMasks` (below) carries the horse-space coordinates the coat layers are sampled at.
 */
export function buildMarkMasks(src: IndexedFrames, palette: Palette, keys: KeyPalette, geo: CoatGeometry = buildCoatGeometry(indexedRoleGrid(src, palette, keys)), hair: LongHair | null = null, cloth: SaddleClothMask | null = null): Uint8Array {
  const out = new Uint8Array(src.width * src.height * 4);
  const { fw, fh } = src;
  for (let f = 0; f < src.frames; f++) {
    const [ox, oy] = frameOrigin(src, f);
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        const i = (f * fh + y) * fw + x;
        const r = geo.region[i]!;
        if (!r) {
          // long hair grown where the horse has no region (strands past the outline): mane hair
          if (hair && hair.key[i]! >= 0 && !src.index[(oy + y) * src.width + ox + x]) {
            const o = ((oy + y) * src.width + ox + x) * 4;
            out[o] = MARK_REGION.hair + MARK_REGION.mane;
            out[o + 3] = 255;
          }
          continue;
        }
        const o = ((oy + y) * src.width + ox + x) * 4;
        const reg = r === GEO_REGION.mane ? MARK_REGION.mane : r === GEO_REGION.tail ? MARK_REGION.tail : r;
        out[o] = reg + (geo.outside[i] ? MARK_REGION.hair : 0);
        if (r >= 1 && r <= 5) out[o + 1] = Math.round(Math.min(1, Math.max(0, geo.p1[i]!)) * 255);
        else if (r === GEO_REGION.body) out[o + 1] = Math.min(255, Math.max(0, Math.round(geo.v[i]! * 32)));
        if (r === GEO_REGION.face) out[o + 2] = Math.min(255, Math.max(0, Math.round(geo.p2[i]! * 32)));
        out[o + 3] = 255;
      }
    // the saddle cloth (V-03): R = 14, G = the number box cell (cx + cy * 8; 255 outside it)
    if (cloth)
      for (let y = 0; y < fh; y++)
        for (let x = 0; x < fw; x++) {
          const i = (f * fh + y) * fw + x;
          if (!cloth.mask[i]) continue;
          const o = ((oy + y) * src.width + ox + x) * 4;
          out[o] = MARK_REGION.cloth;
          out[o + 1] = cloth.glyph[i]!;
          out[o + 2] = 0;
          out[o + 3] = 255;
        }
  }
  riderMasks(src, palette, keys, out);
  return out;
}

/**
 * Each runner's saddle cloth (V-03): the gate's colour and number from the racecard's single
 * definition (art-pipeline SADDLE_CLOTHS). `on` false = none (the strips' own white cloths);
 * omitted = on unless the page asks for the old white cloths (`?cloth=0`).
 */
export function runnerCloths(horses: readonly { gate: number }[], on?: boolean): (SaddleClothLook | null)[] {
  const show = on ?? !clothOffByUrl();
  return horses.map((h) => (show ? saddleClothOf(h.gate) : null));
}

/** Smallest drawn frame width (CSS px) that prints the cloth's number: a horse of ~120 px and more. */
export const CLOTH_NUMBER_MIN_CSS = 130;

/**
 * Is the cloth's number printed? The horse is drawn large enough to read it (frame >= ~130 CSS px,
 * the horse itself ~120) and from the full or half-size strip (the number's 2-texel cells stay whole).
 */
export function clothNumberShown(frameCssW: number, lod: number): boolean {
  return frameCssW >= CLOTH_NUMBER_MIN_CSS && lod <= 2;
}

/** The saddle cloth of an indexed strip (art-pipeline saddleCloth): its cloth is drawn in the fixed white keys. */
export function stripSaddleCloth(src: IndexedFrames, palette: Palette, keys: KeyPalette, geo: CoatGeometry): SaddleClothMask | null {
  const white = new Set<number>();
  for (const h of keys.white ?? []) {
    const i = palette.lookup.get(Number.parseInt(h.slice(1), 16));
    if (i !== undefined) white.add(i);
  }
  if (!white.size) return null;
  return findSaddleCloth((f, x, y) => {
    const [ox, oy] = frameOrigin(src, f);
    return white.has(src.index[(oy + y) * src.width + ox + x]!);
  }, geo);
}

/**
 * Horse-space masks for the coat layers (same grid as buildMarkMasks):
 *   uv: RG = body u, BA = body v, each (texels * 4 + 32768) as 16 bits (low byte first);
 *   pq: R = leg g / face t (0..1) or tail a / 1.7, G = leg s / face e / tail l as 128 + texels * 4,
 *       B = for long hair grown off a leg: the palette index of the leg texel it grows from.
 */
export function coatMasks(src: IndexedFrames, geo: CoatGeometry, hair: LongHair | null = null, palette: Palette | null = null): { uv: Uint8Array; pq: Uint8Array; H: number } {
  const uv = new Uint8Array(src.width * src.height * 4);
  const pq = new Uint8Array(src.width * src.height * 4);
  const { fw, fh } = src;
  const enc16 = (v: number) => Math.min(65535, Math.max(0, Math.round(v * 4) + 32768));
  for (let f = 0; f < src.frames; f++) {
    const [ox, oy] = frameOrigin(src, f);
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        const i = (f * fh + y) * fw + x;
        const r = geo.region[i]!;
        if (!r) continue;
        const o = ((oy + y) * src.width + ox + x) * 4;
        const u = enc16(geo.u[i]!);
        const v = enc16(geo.v[i]!);
        uv[o] = u & 255;
        uv[o + 1] = u >> 8;
        uv[o + 2] = v & 255;
        uv[o + 3] = v >> 8;
        const p1 = r === GEO_REGION.tail ? geo.p1[i]! / 1.7 : geo.p1[i]!;
        pq[o] = Math.round(Math.min(1, Math.max(0, p1)) * 255);
        pq[o + 1] = Math.min(255, Math.max(0, Math.round(128 + geo.p2[i]! * 4)));
        pq[o + 3] = 255;
      }
    // the feathered horse's long hair (art-pipeline longHair): its key's palette index in B
    if (hair && palette)
      for (let y = 0; y < fh; y++)
        for (let x = 0; x < fw; x++) {
          const i = (f * fh + y) * fw + x;
          const k = hair.key[i]!;
          if (k < 0) continue;
          const pi = palette.lookup.get(k);
          if (pi === undefined) continue;
          const o = ((oy + y) * src.width + ox + x) * 4;
          pq[o + 2] = pi;
          pq[o + 3] = 255;
        }
  }
  return { uv, pq, H: geo.H };
}

/** The long hair of an indexed strip (shared by every feathered runner). */
export function stripLongHair(src: IndexedFrames, palette: Palette, keys: KeyPalette, geo: CoatGeometry, speed: number): LongHair {
  const grid = indexedRoleGrid(src, palette, keys);
  const keyAt = (f: number, x: number, y: number) => {
    const [ox, oy] = frameOrigin(src, f);
    const k = src.index[(oy + y) * src.width + ox + x]!;
    return k ? palette.colours[k]! : -1;
  };
  return longHair(grid, keyAt, geo, keys, speed);
}

/**
 * The mane and tail field (art-pipeline hairField, V-05) into the masks' alpha bytes: the marking
 * mask's A holds the straight strand set, the coat mask pq's A the wavy set (the shader reads the
 * runner's set and levels). An empty texel the field reaches becomes a hair candidate (R = 16 +
 * mane or tail), like the feathered long hair's. Call after every other mask writer.
 */
export function applyHairField(src: IndexedFrames, geo: CoatGeometry, field: HairField, mask: Uint8Array, pq: Uint8Array): void {
  const { fw, fh } = src;
  const [s0, s1] = field.sets;
  for (let f = 0; f < src.frames; f++) {
    const [ox, oy] = frameOrigin(src, f);
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        const i = (f * fh + y) * fw + x;
        const o = ((oy + y) * src.width + ox + x) * 4;
        const a = s0[i]!;
        const b = s1[i]!;
        mask[o + 3] = a;
        pq[o + 3] = b;
        if ((a || b) && !geo.region[i] && !src.index[(oy + y) * src.width + ox + x] && !mask[o]) mask[o] = MARK_REGION.hair + ((a | b) & 128 ? MARK_REGION.tail : MARK_REGION.mane);
      }
  }
}

/**
 * Women riders (jockey gender): where the -f strip (same frames, edited with PixelLab: a slimmer
 * back and hair under the cap) differs from the shared strip, the mask says so, so one indexed
 * strip serves both: R = 10, the texel is empty for a woman rider (the slimmer back); R = 11,
 * a woman rider shows palette index G there (her hair, the re-shaped jacket). Both frame grids
 * must match (indexStrip with the same palette).
 */
export function womanMasks(male: IndexedFrames, woman: IndexedFrames, out: Uint8Array): number {
  if (male.width !== woman.width || male.height !== woman.height) return 0;
  let n = 0;
  for (let i = 0; i < male.index.length; i++) {
    const m = male.index[i]!;
    const w = woman.index[i]!;
    if (m === w) continue;
    const o = i * 4;
    out[o] = w === 0 ? MARK_REGION.womanTrim : MARK_REGION.womanTexel;
    out[o + 1] = w;
    out[o + 2] = 0;
    out[o + 3] = 255;
    n++;
  }
  return n;
}

/**
 * Rider regions of the mask (jockey looks): per frame, the cap's texels (R = 9, G/B = their
 * place in the cap's box, for the cap pattern), the rider's face (R = 7, G = skin level * 64 + 32:
 * the small coat / mane / skin-keyed patches under and in front of the cap; the horse's own coat
 * always runs out of that window) and the hair cue (R = 8): a nape line under the back of the
 * cap (G = level * 64) and a ponytail behind it (G = level * 64 + 32, drawn on empty texels too,
 * only for long-haired jockeys). Riders face right.
 */
function riderMasks(src: IndexedFrames, palette: Palette, keys: KeyPalette, out: Uint8Array): void {
  const set = (ramp?: string[]) => {
    const r = new Set<number>();
    for (const h of ramp ?? []) {
      const k = palette.lookup.get(Number.parseInt(h.slice(1), 16));
      if (k !== undefined) r.add(k);
    }
    return r;
  };
  const isCap = set(keys.cap);
  const faceKeys = new Set([...set(keys.coat), ...set(keys.mane), ...set(keys.points), ...set(keys.skin)]);
  if (!isCap.size) return;
  const skinIdx = (keys.skin ?? []).map((h) => palette.lookup.get(Number.parseInt(h.slice(1), 16)) ?? -1);
  const levelOf = (k: number) => {
    const i = skinIdx.indexOf(k);
    return i >= 0 ? skinKeyLevel(i, skinIdx.length) : riderSkinLevel(palette.luma[k]!);
  };
  const { fw, fh } = src;
  const paint = (f: [number, number], x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= fw || y >= fh) return;
    const o = ((f[1] + y) * src.width + f[0] + x) * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  };
  for (let fr = 0; fr < src.frames; fr++) {
    const f = frameOrigin(src, fr);
    const idx = (x: number, y: number) => src.index[(f[1] + y) * src.width + f[0] + x]!;
    let cx0 = fw, cy0 = fh, cx1 = -1, cy1 = -1;
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++)
        if (isCap.has(idx(x, y))) {
          cx0 = Math.min(cx0, x);
          cx1 = Math.max(cx1, x);
          cy0 = Math.min(cy0, y);
          cy1 = Math.max(cy1, y);
        }
    if (cx1 < 0) continue;
    for (let y = cy0; y <= cy1; y++)
      for (let x = cx0; x <= cx1; x++)
        if (isCap.has(idx(x, y))) paint(f, x, y, MARK_REGION.cap, Math.round(((x - cx0) / Math.max(1, cx1 - cx0)) * 255), Math.round(((y - cy0) / Math.max(1, cy1 - cy0)) * 255));
    const capW = cx1 - cx0 + 1;
    const wx0 = Math.max(0, cx0 - 2);
    const wx1 = Math.min(fw - 1, cx1 + Math.max(4, Math.round(capW * 0.35)));
    const wy1 = Math.min(fh - 1, cy1 + Math.max(8, Math.round(capW * 0.9)));
    const inWin = (x: number, y: number) => x >= wx0 && x <= wx1 && y >= cy0 && y <= wy1;
    const cand = (x: number, y: number) => inWin(x, y) && faceKeys.has(idx(x, y));
    const seen = new Set<number>();
    const face = new Set<number>();
    for (let y = cy0; y <= wy1; y++) {
      for (let x = wx0; x <= wx1; x++) {
        if (seen.has(y * fw + x) || !cand(x, y)) continue;
        const patch: number[] = [];
        let edge = false;
        const stack = [x, y];
        seen.add(y * fw + x);
        while (stack.length) {
          const py = stack.pop()!;
          const px = stack.pop()!;
          patch.push(px, py);
          if (px === wx1 || py === wy1) edge = true;
          for (const [qx, qy] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]] as const) {
            if (seen.has(qy * fw + qx) || !cand(qx, qy)) continue;
            seen.add(qy * fw + qx);
            stack.push(qx, qy);
          }
        }
        if (edge || patch.length / 2 > Math.max(40, capW * 6)) continue;
        for (let n = 0; n < patch.length; n += 2) {
          face.add(patch[n + 1]! * fw + patch[n]!);
          paint(f, patch[n]!, patch[n + 1]!, MARK_REGION.riderFace, levelOf(idx(patch[n]!, patch[n + 1]!)) * 64 + 32, 0);
        }
      }
    }
    // hair: the nape under the back of the cap, a ponytail behind it
    for (let x = cx0; x <= Math.min(cx1, cx0 + 2); x++) if (face.has((cy1 + 1) * fw + x)) paint(f, x, cy1 + 1, MARK_REGION.riderHair, x === cx0 ? 0 : 64, 0);
    for (const [x, y, k] of [[cx0 - 1, cy1 - 1, 1], [cx0 - 1, cy1, 1], [cx0 - 2, cy1 + 1, 2], [cx0 - 2, cy1 + 2, 1], [cx0 - 3, cy1 + 3, 0], [cx0 - 1, cy1 + 1, 0]] as const) {
      if (x < 0 || y >= fh || isCap.has(idx(x, y))) continue;
      paint(f, x, y, MARK_REGION.riderHair, k * 64 + 32, 0);
    }
  }
}

/**
 * Lookup table: one row per runner. Base colour = the recoloured key (coat, mane, points,
 * silks, cap) or the source colour for fixed roles; the pattern half holds the secondary
 * silks colour for primary keys (alpha 0 elsewhere). Column LUT_FLAG_X packs the marking
 * flags: R = leg levels 2 bits each in tuple order (FL|FR<<2|HL<<4|HR<<6), G = face id |
 * coat pattern << 4, B = dun (primitive markings); column LUT_WHITE_X is the marking white;
 * column LUT_STRIPE_X the dun stripe colour (alpha 0 when the palette has none — the shader
 * falls back to the legacy fixed darkening).
 */
export function buildLut(palette: Palette, keys: KeyPalette, appearances: readonly HorseAppearance[], cloths: readonly (SaddleClothLook | null | undefined)[] = []): Uint8Array {
  const rows = Math.max(1, appearances.length);
  const lut = new Uint8Array(LUT_W * rows * 4);
  appearances.forEach((a, row) => {
    const plan = buildRecolorPlan(keys, a);
    const colors = resolveHorseColors(a);
    for (let i = 1; i < palette.colours.length; i++) {
      const src = palette.colours[i]!;
      const out = plan.map.get(src) ?? src;
      const o = (row * LUT_W + i) * 4;
      lut[o] = (out >> 16) & 255;
      lut[o + 1] = (out >> 8) & 255;
      lut[o + 2] = out & 255;
      lut[o + 3] = 255;
      const pi = plan.primaryIndex.get(src);
      if (pi !== undefined && plan.pattern !== "solid") {
        const sec = plan.secondaryRamp[pi] ?? out;
        const p = (row * LUT_W + 64 + i) * 4;
        lut[p] = (sec >> 16) & 255;
        lut[p + 1] = (sec >> 8) & 255;
        lut[p + 2] = sec & 255;
        lut[p + 3] = 255;
      }
    }
    const fl = LEG_LEVEL[a.legs?.[0] ?? "none"] ?? 0;
    const fr = LEG_LEVEL[a.legs?.[1] ?? "none"] ?? 0;
    const hl = LEG_LEVEL[a.legs?.[2] ?? "none"] ?? 0;
    const hr = LEG_LEVEL[a.legs?.[3] ?? "none"] ?? 0;
    // the cap pattern's colour: the secondary silks ramp at the cap key's shade
    plan.capIndex.forEach((ci, src) => {
      const k = palette.lookup.get(src);
      if (k === undefined || plan.pattern === "solid") return;
      const sec = plan.capSecondary[ci] ?? src;
      const p = (row * LUT_W + 64 + k) * 4;
      lut[p] = (sec >> 16) & 255;
      lut[p + 1] = (sec >> 8) & 255;
      lut[p + 2] = sec & 255;
      lut[p + 3] = 255;
    });
    // the rider's look (named jockeys)
    if (a.rider) {
      const put = (x: number, c: [number, number, number]) => {
        const o = (row * LUT_W + x) * 4;
        lut[o] = c[0];
        lut[o + 1] = c[1];
        lut[o + 2] = c[2];
        lut[o + 3] = 255;
      };
      rampRgb(a.rider.skin, 4).forEach((c, i) => put(LUT_SKIN_X + i, c));
      rampRgb(a.rider.hair, 3).forEach((c, i) => put(LUT_HAIR_X + i, c));
      put(LUT_RIDER_X, [255, a.rider.long ? 255 : 0, a.rider.gender === "f" ? 255 : 0]);
    }
    const fo = (row * LUT_W + LUT_FLAG_X) * 4;
    lut[fo] = fl | (fr << 2) | (hl << 4) | (hr << 6);
    lut[fo + 1] = (FACE_ID[a.face ?? "none"] ?? 0) | ((COAT_PATTERN_ID[colors.texture] ?? 0) << 4);
    lut[fo + 2] = a.dun ? 1 : 0;
    lut[fo + 3] = 255;
    const wo = (row * LUT_W + LUT_WHITE_X) * 4;
    lut[wo] = (MARKING_WHITE >> 16) & 255;
    lut[wo + 1] = (MARKING_WHITE >> 8) & 255;
    lut[wo + 2] = MARKING_WHITE & 255;
    lut[wo + 3] = 255;
    if (colors.stripe) {
      const n = Number.parseInt(colors.stripe.slice(1), 16);
      const so = (row * LUT_W + LUT_STRIPE_X) * 4;
      lut[so] = (n >> 16) & 255;
      lut[so + 1] = (n >> 8) & 255;
      lut[so + 2] = n & 255;
      lut[so + 3] = 255;
    }
    // the coat pattern: the same definition every view draws
    const pat = coatPatternOf(a);
    const layers = pat.layers.slice(0, LUT_SLOTS);
    layers.forEach((L, k) => {
      const po = (row * LUT_W + LUT_SLOT_X + k * 2) * 4;
      lut[po] = L.cell;
      lut[po + 1] = MODE_ID[L.mode] ?? 0;
      lut[po + 2] = Math.round(Math.min(1, L.amount) * 255);
      lut[po + 3] = 255;
      const n = Number.parseInt(L.colour.slice(1), 16);
      lut[po + 4] = (n >> 16) & 255;
      lut[po + 5] = (n >> 8) & 255;
      lut[po + 6] = n & 255;
      lut[po + 7] = 255;
    });
    const co = (row * LUT_W + LUT_CELLS_X) * 4;
    lut[co] = pat.faceCell >= 0 ? pat.faceCell : 255;
    lut[co + 1] = pat.feather ? 1 : 255;
    lut[co + 2] = layers.length;
    lut[co + 3] = 255;
    const lo = (row * LUT_W + LUT_LEGS_X) * 4;
    pat.legs.forEach((c, k) => (lut[lo + k] = c >= 0 ? c : 255));
    // the saddle cloth in the gate's colour, its number colour in the (unused) index-0 column
    const cl = cloths[row];
    if (cl) {
      const bg = Number.parseInt(cl.cloth.slice(1), 16);
      const fg = Number.parseInt(cl.number.slice(1), 16);
      const bo = (row * LUT_W + LUT_CLOTH_X) * 4;
      lut[bo] = (bg >> 16) & 255;
      lut[bo + 1] = (bg >> 8) & 255;
      lut[bo + 2] = bg & 255;
      lut[bo + 3] = Math.max(1, Math.min(255, cl.gate));
      const no = (row * LUT_W + LUT_CLOTH_NUM_X) * 4;
      lut[no] = (fg >> 16) & 255;
      lut[no + 1] = (fg >> 8) & 255;
      lut[no + 2] = fg & 255;
      lut[no + 3] = 255;
    }
  });
  return lut;
}

/**
 * Per palette index, what the coat layers need to know about the key (shared by every runner):
 * row 0: R = role (1 coat, 2 points, 3 mane; 0 not the horse) * 64, G = shade 0 (dark) .. 255
 * (light) in its ramp; row 1, x = 0..15: R = the mane key for long hair of shade x / 15.
 */
export function buildKeyInfo(palette: Palette, keys: KeyPalette): Uint8Array {
  const out = new Uint8Array(64 * 2 * 4);
  const put = (ramp: string[] | undefined, role: number) =>
    ramp?.forEach((h, i) => {
      const k = palette.lookup.get(Number.parseInt(h.slice(1), 16));
      if (k === undefined || k >= 64) return;
      out[k * 4] = role * 64;
      out[k * 4 + 1] = Math.round((ramp.length > 1 ? i / (ramp.length - 1) : 0.6) * 255);
      out[k * 4 + 3] = 255;
    });
  put(keys.coat, 1);
  put(keys.points, 2);
  put(keys.hoof, 2);
  put(keys.mane, 3);
  const mane = (keys.mane ?? []).map((h) => palette.lookup.get(Number.parseInt(h.slice(1), 16)) ?? 0);
  for (let x = 0; x < 16; x++) {
    const v = 1 + Math.round((x / 15) * 254);
    const j = Math.min(mane.length - 1, Math.max(Math.min(1, mane.length - 1), Math.round(((v - 1) / 254) * (mane.length - 1))));
    out[(64 + x) * 4] = mane[j] ?? 0;
    out[(64 + x) * 4 + 3] = 255;
  }
  return out;
}
