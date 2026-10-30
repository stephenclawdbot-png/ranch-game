/**
 * Genetic 3/4 portrait render (no React, no DOM beyond a canvas): fetch and decode the
 * painted strip, role map, marks and warp, recolour with @thoroughbred/art-pipeline
 * `paintGeneticPortrait` (pure, deterministic), encode PNG blobs. Runs in the portrait
 * worker (OffscreenCanvas), or on the main thread where workers are unavailable.
 */
import type { HorseAppearance } from "@thoroughbred/shared";
import {
  PORTRAIT_ART_SIZE,
  downsampleAlpha2x,
  fitPaintedRamp,
  paintGeneticPortrait,
  portraitLookOf,
  type PaintedRamp,
} from "@thoroughbred/art-pipeline";

const S = PORTRAIT_ART_SIZE;
const ART = "/art/portraits";

export interface PortraitAnim {
  frames: number;
  kept?: number;
}

export interface GeneticPortraitBlobs {
  /** The recoloured strip (or still, when the coat has no idle loop). */
  strip: Blob;
  /** Frame 0 alone (share cards draw the still); null when the strip is a still. */
  still: Blob | null;
}

interface Pixels {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function canvas(w: number, h: number): { ctx: Canvas2D; encode: () => Promise<Blob> } {
  if (typeof OffscreenCanvas === "function") {
    const cv = new OffscreenCanvas(w, h);
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context");
    return { ctx, encode: () => cv.convertToBlob({ type: "image/png" }) };
  }
  if (typeof document === "undefined") throw new Error("no canvas here");
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  return { ctx, encode: () => new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png")) };
}

/** Decoded art, most recently used last (a strip and its warp are ~1 MB each, so bounded). */
const pixelCache = new Map<string, Promise<Pixels>>();
const MAX_PIXELS = 14;

/** Decoded RGBA of a served PNG (fetch + createImageBitmap; rejects where unsupported). */
function pixels(url: string): Promise<Pixels> {
  let p = pixelCache.get(url);
  if (p) {
    pixelCache.delete(url);
    pixelCache.set(url, p);
    return p;
  }
  p = (async () => {
    if (typeof createImageBitmap !== "function") throw new Error("no image decoding here");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`portrait art ${res.status}: ${url}`);
    const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
    const { ctx } = canvas(bmp.width, bmp.height);
    ctx.drawImage(bmp, 0, 0);
    const out = { data: ctx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height };
    bmp.close();
    return out;
  })();
  p.catch(() => pixelCache.delete(url)); // a failed fetch may succeed later
  pixelCache.set(url, p);
  if (pixelCache.size > MAX_PIXELS) pixelCache.delete(pixelCache.keys().next().value!);
  return p;
}

const rampCache = new Map<string, Promise<PaintedRamp>>();
function paintedRamp(coat: string): Promise<PaintedRamp> {
  let p = rampCache.get(coat);
  if (!p) {
    p = Promise.all([pixels(`${ART}/horse-${coat}.png`), pixels(`${ART}/roles.png`)]).then(([still, roles]) => fitPaintedRamp(still.data, roles.data));
    p.catch(() => rampCache.delete(coat));
    rampCache.set(coat, p);
  }
  return p;
}

function encode(data: Uint8ClampedArray, w: number, h: number): Promise<Blob> {
  const { ctx, encode: toBlob } = canvas(w, h);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
  return toBlob();
}

/** Render one horse's genetic portrait (128 px frames, or the 64 px thumb). */
export async function renderGeneticPortrait(appearance: HorseAppearance, thumb: boolean, anim: PortraitAnim | null, base = ""): Promise<GeneticPortraitBlobs> {
  const coat = appearance.coat;
  const look = portraitLookOf(appearance);
  const art = `${base}${ART}`;
  const [strip, warp, roles, marks, ramp] = await Promise.all([
    pixels(anim ? `${art}/anim/horse-${coat}.png` : `${art}/horse-${coat}.png`),
    anim ? pixels(`${art}/anim/warp/horse-${coat}.png`) : Promise.resolve(null),
    pixels(`${art}/roles.png`),
    look.face !== "none" ? pixels(`${art}/portrait-marks.png`) : Promise.resolve(null),
    paintedRamp(coat),
  ]);
  const frames = anim ? anim.frames : 1;
  if (strip.w !== S * frames || strip.h !== S || (warp && (warp.w !== strip.w || warp.h !== S))) throw new Error("portrait strip size mismatch");
  const painted = paintGeneticPortrait(look, { pixels: strip.data, frames, kept: anim?.kept, warp: warp?.data ?? null, roles: roles.data, marks: marks?.data ?? null, ramp });
  const out = thumb ? downsampleAlpha2x(painted, strip.w, S) : painted;
  const fw = thumb ? S / 2 : S;
  const w = fw * frames;
  if (frames === 1) return { strip: await encode(out, fw, fw), still: null };
  // frame 0 alone, for share cards
  const still = new Uint8ClampedArray(fw * fw * 4);
  for (let y = 0; y < fw; y++) still.set(out.subarray(y * w * 4, (y * w + fw) * 4), y * fw * 4);
  const [s, f0] = await Promise.all([encode(out, w, fw), encode(still, fw, fw)]);
  return { strip: s, still: f0 };
}
