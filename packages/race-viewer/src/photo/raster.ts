/**
 * Line-scan raster (pure, deterministic): composes the photograph at native resolution
 * into an RGBA buffer. No canvas needed, so it runs in tests; the browser renderer only
 * scales it by a whole number and adds text and the judge's line.
 *
 * Each horse is the lunge frame recoloured with its coat and silks, sampled column by
 * column as the line-scan would see it (nearest column, never resampled smoothly), so it
 * stays crisp pixel art while a slower horse is drawn wider.
 */
import { applyRecolor, appearanceKey, buildRecolorPlan, type KeyPalette } from "../three/recolor";
import type { PhotoFinishModel } from "./model";
import { photoLayout, type LayoutOptions, type PhotoLayout, type SpriteMetrics } from "./layout";

export interface SpriteStrip {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  frameW: number;
}

export interface PhotoArt {
  /** The race-day lunge strip (`race/horse-lunge.png`), decoded. */
  strip: SpriteStrip;
  /** Frame to use (5 = full stretch, the photo-finish hold). */
  frame: number;
  keys: KeyPalette;
}

export interface RasterOptions extends LayoutOptions {
  /** Share of the original colour kept by the sepia toning (0 = pure sepia, 1 = full colour). */
  colour?: number;
}

export interface PhotoRaster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  layout: PhotoLayout;
  sprite: SpriteMetrics;
}

/** Crop one frame out of a strip (copy). */
export function cropFrame(strip: SpriteStrip, frame: number): Uint8ClampedArray {
  const { frameW, height, width } = strip;
  const out = new Uint8ClampedArray(frameW * height * 4);
  const x0 = Math.min(Math.max(0, frame), Math.floor(width / frameW) - 1) * frameW;
  for (let y = 0; y < height; y++) out.set(strip.data.subarray((y * width + x0) * 4, (y * width + x0 + frameW) * 4), y * frameW * 4);
  return out;
}

export function spriteMetrics(frame: Uint8ClampedArray, frameW: number, frameH: number): SpriteMetrics {
  let noseX = -1;
  let tailX = frameW;
  let top = frameH;
  let bottom = -1;
  for (let y = 0; y < frameH; y++) {
    for (let x = 0; x < frameW; x++) {
      if (frame[(y * frameW + x) * 4 + 3]! < 128) continue;
      if (x > noseX) noseX = x;
      if (x < tailX) tailX = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (noseX < 0) return { frameW, frameH, noseX: frameW - 1, tailX: 0, top: 0, bottom: frameH - 1 };
  return { frameW, frameH, noseX, tailX, top, bottom };
}

/** Deterministic per-row / per-pixel noise in [0, 1). */
function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

function fillRow(data: Uint8ClampedArray, w: number, y: number, r: number, g: number, b: number): void {
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
}

/**
 * The static scene as the line-scan sees it: every stationary thing becomes a horizontal
 * streak. Mirror (dark, the stands reflected) on top, the white rail, the white painted
 * line behind the horses, the track surface, and the time scale.
 */
function background(data: Uint8ClampedArray, l: PhotoLayout): void {
  const { width: w } = l;
  for (let y = 0; y < l.height; y++) {
    let r: number;
    let g: number;
    let b: number;
    const n = hash(y, 7) - 0.5;
    if (y < l.mirrorH) {
      // The mirror: a darker, slightly blue-grey reflection of the far side with soft streaks.
      const t = y / Math.max(1, l.mirrorH);
      const v = 96 + t * 40 + n * 22;
      r = v - 6;
      g = v;
      b = v + 6;
    } else if (y < l.mainTop) {
      // Mirror frame and white rail.
      const k = y - l.mirrorH;
      const v = k === 0 || k === l.mainTop - l.mirrorH - 1 ? 52 : 236;
      r = g = b = v;
    } else if (y < l.groundY) {
      // The painted line: near white, faint streaks.
      const v = 238 + n * 10;
      r = v;
      g = v;
      b = v - 2;
    } else if (y < l.scaleTop) {
      // Track surface: grass-green streaks darkening toward the camera.
      const t = (y - l.groundY) / Math.max(1, l.scaleTop - l.groundY);
      const v = n * 26;
      r = 118 - t * 34 + v;
      g = 150 - t * 40 + v;
      b = 92 - t * 26 + v;
    } else {
      r = g = b = 22;
    }
    fillRow(data, w, y, r, g, b);
  }
}

function blitHorse(
  out: Uint8ClampedArray,
  ow: number,
  oh: number,
  src: Uint8ClampedArray,
  m: SpriteMetrics,
  noseX: number,
  width: number,
  step: number,
  top: number,
  yDiv: number,
  shade: number,
): void {
  for (let c = 0; c < width; c++) {
    const ox = noseX - c;
    if (ox < 0 || ox >= ow) continue;
    const sx = m.noseX - Math.floor(c * step + 0.5);
    if (sx < m.tailX) break;
    for (let sy = m.top; sy <= m.bottom; sy += yDiv) {
      const si = (sy * m.frameW + sx) * 4;
      if (src[si + 3]! < 128) continue;
      const oy = top + Math.floor(sy / yDiv);
      if (oy < 0 || oy >= oh) continue;
      const oi = (oy * ow + ox) * 4;
      out[oi] = src[si]! * shade;
      out[oi + 1] = src[si + 1]! * shade;
      out[oi + 2] = src[si + 2]! * shade;
      out[oi + 3] = 255;
    }
  }
}

/** Sepia toning with a little of the original colour left, plus fixed film grain. */
function tone(data: Uint8ClampedArray, w: number, h: number, keep: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b + (hash(x, y) - 0.5) * 7;
      const sr = lum * 1.06 + 8;
      const sg = lum * 0.98 + 2;
      const sb = lum * 0.82 - 4;
      data[i] = sr + (r - sr) * keep;
      data[i + 1] = sg + (g - sg) * keep;
      data[i + 2] = sb + (b - sb) * keep;
    }
  }
}

export function rasterPhotoFinish(model: PhotoFinishModel, art: PhotoArt, opts: RasterOptions = {}): PhotoRaster {
  const frame = cropFrame(art.strip, art.frame);
  const m = spriteMetrics(frame, art.strip.frameW, art.strip.height);
  const layout = photoLayout(model, m, opts);
  const { width, height } = layout;
  const data = new Uint8ClampedArray(width * height * 4);
  background(data, layout);

  const recoloured = new Map<string, Uint8ClampedArray>();
  const spriteFor = (i: number) => {
    const a = model.runners[i]!.appearance;
    const key = appearanceKey(a);
    let s = recoloured.get(key);
    if (!s) {
      s = frame.slice();
      applyRecolor(s, m.frameW, m.frameH, m.frameW, buildRecolorPlan(art.keys, a));
      recoloured.set(key, s);
    }
    return s;
  };

  if (layout.mirrorH > 0) {
    // Mirror: half height (it is across the track), same time axis, far lanes in front.
    const mirrorOrder = [...layout.placements].sort((a, b) => b.depth - a.depth);
    for (const p of mirrorOrder) blitHorse(data, width, layout.mirrorH, spriteFor(p.index), m, p.noseX, p.width, p.step, p.mirrorY, 2, 0.62);
  }
  for (const p of [...layout.placements].sort((a, b) => a.depth - b.depth)) blitHorse(data, width, layout.scaleTop, spriteFor(p.index), m, p.noseX, p.width, p.step, p.y, 1, 1);

  // Time scale: a tick every 0.01 s, longer every 0.05 s.
  for (const t of layout.ticks) {
    if (t.x < 0 || t.x >= width) continue;
    const len = t.major ? 6 : 3;
    for (let y = layout.scaleTop; y < layout.scaleTop + len; y++) {
      const i = (y * width + t.x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 226;
    }
  }

  tone(data, width, height, opts.colour ?? 0.38);
  return { width, height, data, layout, sprite: m };
}
