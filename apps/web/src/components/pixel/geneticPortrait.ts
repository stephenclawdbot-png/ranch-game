"use client";

/**
 * Genetic 3/4 portrait, browser side: loads the painted portrait (or its idle-loop strip),
 * the offline role map, face-marking masks and frame warp, recolours them from the horse's
 * genes (@thoroughbred/art-pipeline `paintGeneticPortrait`, pure and deterministic), and
 * hands back blob URLs for the strip and its still frame.
 *
 * - SSR and the first client render show the painted file (same box), then the recolour
 *   swaps in: no layout shift, and a safe fallback when anything fails (no canvas, a file
 *   that does not load): the painted portrait simply stays.
 * - Results are cached by `portraitCacheKey` (genes + face + size, never silks), so every
 *   portrait of the same horse on a page, and on later pages, reuses one render.
 * - Renders run one at a time, yielding between horses, so a stable of 24 never blocks
 *   the main thread for long.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { HorseAppearance } from "@thoroughbred/shared";
import {
  PORTRAIT_ART_SIZE,
  downsampleAlpha2x,
  fitPaintedRamp,
  paintGeneticPortrait,
  portraitCacheKey,
  portraitLookOf,
  type PaintedRamp,
} from "@thoroughbred/art-pipeline";

const S = PORTRAIT_ART_SIZE;
const ART = "/art/portraits";

export interface PortraitAnim {
  frames: number;
  kept?: number;
}

export interface GeneticPortraitUrls {
  /** The recoloured strip (or still, when the coat has no idle loop). */
  strip: string;
  /** Frame 0 alone (share cards draw the still). */
  still: string;
}

interface Pixels {
  data: Uint8ClampedArray;
  w: number;
  h: number;
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
  } else {
    p = (async () => {
      if (typeof createImageBitmap !== "function" || typeof document === "undefined") throw new Error("no image decoding here");
      const res = await fetch(url);
      if (!res.ok) throw new Error(`portrait art ${res.status}: ${url}`);
      const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
      const cv = document.createElement("canvas");
      cv.width = bmp.width;
      cv.height = bmp.height;
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      return { data: ctx.getImageData(0, 0, cv.width, cv.height).data, w: cv.width, h: cv.height };
    })();
    p.catch(() => pixelCache.delete(url)); // a failed fetch may succeed on a later page
    pixelCache.set(url, p);
    if (pixelCache.size > MAX_PIXELS) pixelCache.delete(pixelCache.keys().next().value!);
  }
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

function toBlobUrl(data: Uint8ClampedArray, w: number, h: number): Promise<string> {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d");
  if (!ctx) return Promise.reject(new Error("no 2d context"));
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
  return new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error("toBlob failed"))), "image/png"));
}

async function render(appearance: HorseAppearance, thumb: boolean, anim: PortraitAnim | null): Promise<GeneticPortraitUrls> {
  const coat = appearance.coat;
  const look = portraitLookOf(appearance);
  const needMarks = look.face !== "none";
  const [strip, warp, roles, marks, ramp] = await Promise.all([
    pixels(anim ? `${ART}/anim/horse-${coat}.png` : `${ART}/horse-${coat}.png`),
    anim ? pixels(`${ART}/anim/warp/horse-${coat}.png`) : Promise.resolve(null),
    pixels(`${ART}/roles.png`),
    needMarks ? pixels(`${ART}/portrait-marks.png`) : Promise.resolve(null),
    paintedRamp(coat),
  ]);
  const frames = anim ? anim.frames : 1;
  if (strip.w !== S * frames || strip.h !== S || (warp && (warp.w !== strip.w || warp.h !== S))) throw new Error("portrait strip size mismatch");
  const painted = paintGeneticPortrait(look, { pixels: strip.data, frames, kept: anim?.kept, warp: warp?.data ?? null, roles: roles.data, marks: marks?.data ?? null, ramp });
  const out = thumb ? downsampleAlpha2x(painted, strip.w, S) : painted;
  const fw = thumb ? S / 2 : S;
  const w = fw * frames;
  // frame 0 alone, for share cards
  const still = new Uint8ClampedArray(fw * fw * 4);
  for (let y = 0; y < fw; y++) still.set(out.subarray(y * w * 4, (y * w + fw) * 4), y * fw * 4);
  const [stripUrl, stillUrl] = await Promise.all([toBlobUrl(out, w, fw), frames > 1 ? toBlobUrl(still, fw, fw) : null]);
  return { strip: stripUrl, still: stillUrl ?? stripUrl };
}

// ----------------------------------------------------------------------------- the store

/** Finished renders by key (bounded; the oldest unused ones are released). */
const done = new Map<string, GeneticPortraitUrls>();
const failed = new Set<string>();
const pending = new Set<string>();
const listeners = new Map<string, Set<() => void>>();
const MAX_DONE = 240;

let queue: Promise<void> = Promise.resolve();
const yieldToPage = () => new Promise<void>((r) => setTimeout(r, 0));

function notify(key: string) {
  listeners.get(key)?.forEach((l) => l());
}

function evict() {
  for (const [k, urls] of done) {
    if (done.size <= MAX_DONE) return;
    if (listeners.get(k)?.size) continue; // on screen: keep
    done.delete(k);
    URL.revokeObjectURL(urls.strip);
    if (urls.still !== urls.strip) URL.revokeObjectURL(urls.still);
  }
}

function request(key: string, appearance: HorseAppearance, thumb: boolean, anim: PortraitAnim | null) {
  if (done.has(key) || failed.has(key) || pending.has(key)) return;
  pending.add(key);
  queue = queue
    .then(async () => {
      try {
        const urls = await render(appearance, thumb, anim);
        done.set(key, urls);
        evict();
      } catch (e) {
        failed.add(key); // keep the painted portrait for this horse
        if (process.env.NODE_ENV !== "production" && typeof window !== "undefined" && "createImageBitmap" in window) console.warn("genetic portrait fell back to the painting:", e);
      } finally {
        pending.delete(key);
        notify(key);
      }
      await yieldToPage();
    })
    .catch(() => undefined);
}

/** Cache key of one rendered portrait (genes, face, size, strip). */
export function geneticPortraitKey(appearance: HorseAppearance, thumb: boolean, anim: PortraitAnim | null): string {
  return `${portraitCacheKey(appearance, thumb ? "thumb" : 1)}|${anim ? `anim${anim.frames}` : "still"}`;
}

/**
 * The recoloured portrait URLs for this horse, or null while rendering, on the server,
 * during hydration, or when it failed (callers show the painted file then).
 */
export function useGeneticPortrait(appearance: HorseAppearance, thumb: boolean, anim: PortraitAnim | null, enabled: boolean): GeneticPortraitUrls | null {
  const key = enabled ? geneticPortraitKey(appearance, thumb, anim) : null;
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!key) return () => undefined;
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(cb);
      request(key, appearance, thumb, anim);
      return () => {
        set.delete(cb);
        if (!set.size) listeners.delete(key);
      };
    },
    // the key carries everything that changes the pixels
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return useSyncExternalStore(
    subscribe,
    () => (key ? (done.get(key) ?? null) : null),
    () => null,
  );
}
