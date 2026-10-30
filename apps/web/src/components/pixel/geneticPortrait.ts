"use client";

/**
 * Genetic 3/4 portrait, browser side: asks for the recoloured strip of a horse (its genes
 * painted onto the portrait and every frame of its idle loop, `geneticPortraitRender.ts`)
 * and hands back blob URLs for the strip and its still frame.
 *
 * - SSR and the first client render show the painted file (same box), then the recolour
 *   swaps in: no layout shift, and a safe fallback when anything fails (no worker and no
 *   canvas, a file that does not load): the painted portrait simply stays.
 * - Renders run in a worker (fetch, decode, recolour and PNG encode off the main thread);
 *   where workers or OffscreenCanvas are missing they run on the main thread, one horse at
 *   a time with a yield between horses.
 * - Results are cached by `portraitCacheKey` (genes + face + size, never silks), so every
 *   portrait of the same horse on a page, and on later pages, reuses one render.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { HorseAppearance } from "@thoroughbred/shared";
import { portraitCacheKey } from "@thoroughbred/art-pipeline";
import { renderGeneticPortrait, type GeneticPortraitBlobs, type PortraitAnim } from "./geneticPortraitRender";
import type { PortraitJob } from "./portrait.worker";

export type { PortraitAnim };

export interface GeneticPortraitUrls {
  /** The recoloured strip (or still, when the coat has no idle loop). */
  strip: string;
  /** Frame 0 alone (share cards draw the still). */
  still: string;
}

// ----------------------------------------------------------------------------- rendering

let worker: Worker | null | undefined; // undefined: not tried yet; null: unavailable
let nextId = 1;
const inflight = new Map<number, { job: Omit<PortraitJob, "id">; resolve: (b: GeneticPortraitBlobs) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof Worker !== "function" || typeof OffscreenCanvas !== "function") return null;
  try {
    const w = new Worker(new URL("./portrait.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ id: number; strip?: Blob; still?: Blob | null; error?: string }>) => {
      const job = inflight.get(e.data.id);
      if (!job) return;
      inflight.delete(e.data.id);
      if (e.data.strip) job.resolve({ strip: e.data.strip, still: e.data.still ?? null });
      // the worker could not render it (no OffscreenCanvas 2d, say): try the main thread
      else onMainThread(job.job.appearance, job.job.thumb, job.job.anim).then(job.resolve, job.reject);
    };
    w.onerror = () => {
      // the worker could not start (or died): render what it held on the main thread
      worker = null;
      w.terminate();
      const held = [...inflight.values()];
      inflight.clear();
      for (const j of held) onMainThread(j.job.appearance, j.job.thumb, j.job.anim).then(j.resolve, j.reject);
    };
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

let mainQueue: Promise<unknown> = Promise.resolve();
function onMainThread(appearance: HorseAppearance, thumb: boolean, anim: PortraitAnim | null): Promise<GeneticPortraitBlobs> {
  const run = mainQueue.then(async () => {
    await new Promise((r) => setTimeout(r, 0)); // let the page breathe between horses
    return renderGeneticPortrait(appearance, thumb, anim);
  });
  mainQueue = run.catch(() => undefined);
  return run;
}

function render(appearance: HorseAppearance, thumb: boolean, anim: PortraitAnim | null): Promise<GeneticPortraitBlobs> {
  const w = getWorker();
  if (!w) return onMainThread(appearance, thumb, anim);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const job = { appearance, thumb, anim };
    inflight.set(id, { job, resolve, reject });
    w.postMessage({ id, ...job } satisfies PortraitJob);
  });
}

// ----------------------------------------------------------------------------- the store

/** Finished renders by key (bounded; the oldest unused ones are released). */
const done = new Map<string, GeneticPortraitUrls>();
const failed = new Set<string>();
const pending = new Set<string>();
const listeners = new Map<string, Set<() => void>>();
const MAX_DONE = 240;

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
  if (typeof createImageBitmap !== "function" || typeof URL.createObjectURL !== "function") {
    failed.add(key); // no image decoding here (tests, very old browsers): the painting stays
    return;
  }
  pending.add(key);
  render(appearance, thumb, anim)
    .then((b) => {
      const strip = URL.createObjectURL(b.strip);
      done.set(key, { strip, still: b.still ? URL.createObjectURL(b.still) : strip });
      evict();
    })
    .catch((e) => {
      failed.add(key); // keep the painted portrait for this horse
      if (process.env.NODE_ENV !== "production") console.warn("genetic portrait fell back to the painting:", e);
    })
    .finally(() => {
      pending.delete(key);
      notify(key);
    });
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
