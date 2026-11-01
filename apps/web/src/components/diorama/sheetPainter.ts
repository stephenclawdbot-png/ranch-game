/**
 * The page side of horse painting: ask for a keyed strip painted for a look and get its best
 * picture so far (a quick recolour first, the finished strip when the worker has it). The page
 * only draws finished bitmaps; painting, decoding and the IndexedDB cache live in
 * paint.worker.ts. Finished strips are also kept in memory by key, so every scene of a visit
 * shares one paint per (look, sheet, size).
 *
 * Where no worker can paint (no Worker or OffscreenCanvas), the same jobs run here, one per
 * idle slice, quick passes first; such devices are "lite" under Auto (lib/deviceTier.ts), so
 * the expensive warp is not among them unless the player asked for it.
 */
import { buildsOn } from "@thoroughbred/art-pipeline";
import { deployedBuild } from "@/lib/paintCache";
import { reportPaintMs } from "@/lib/deviceTier";
import { jobFiles, paintSheet, paintSheetQuick, sheetKey, SHEET_PAINT_VERSION, type Rgba, type SheetPaintJob } from "./sheetPaint";
import { COAT_ATLAS_SRC, coatAtlasOf, type DioramaHorseLook } from "./recolor";
import type { PaintIn, PaintOutMsg as PaintOut } from "./paint.worker";

export type SheetImage = ImageBitmap | HTMLCanvasElement;

export interface SheetHandle {
  readonly key: string;
  /** The best picture so far, or null before the first pass. */
  image(): SheetImage | null;
  stage(): "none" | "quick" | "final";
  /** Called whenever a better picture arrives. Returns an unsubscribe. */
  listen(cb: () => void): () => void;
  /** Make it more (lower) or less urgent. */
  prio(p: number): void;
  /** The caller no longer needs it (an unfinished job nobody wants is dropped). */
  release(): void;
}

interface Entry {
  key: string;
  id: number;
  job: SheetPaintJob;
  img: SheetImage | null;
  stage: "none" | "quick" | "final";
  listeners: Set<() => void>;
  refs: number;
  prio: number;
  used: number;
}

const entries = new Map<string, Entry>();
const byId = new Map<number, Entry>();
let nextId = 1;
/** Finished strips kept with no one using them (most recently used kept). */
const MAX_IDLE = 72;

export const paintStats = { jobs: 0, quick: 0, final: 0, cached: 0, memHits: 0, paintMs: 0, maxMs: 0, warmMaxMs: 0, worker: false, errors: 0 };
if (typeof window !== "undefined") {
  (window as unknown as { __paintStats?: typeof paintStats }).__paintStats = paintStats;
  /** Probes (perf and pixel checks): a hash of every finished strip's pixels, by key. */
  (window as unknown as { __paintDigest?: () => Record<string, string> }).__paintDigest = () => {
    const out: Record<string, string> = {};
    for (const en of entries.values()) {
      if (en.stage !== "final" || !en.img) continue;
      const c = document.createElement("canvas");
      c.width = en.job.w;
      c.height = en.job.h;
      const x = c.getContext("2d", { willReadFrequently: true })!;
      x.drawImage(en.img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let h = 2166136261;
      for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i]!, 16777619);
      out[en.key] = (h >>> 0).toString(16);
    }
    return out;
  };
}

// ----------------------------------------------------------------------------- the worker

let worker: Worker | null | undefined;
function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof Worker !== "function" || typeof OffscreenCanvas !== "function" || typeof createImageBitmap !== "function") return null;
  // `?paint=main` paints on the page (comparison and tests: the same pixels either way)
  if (/[?&]paint=main(&|$)/.test(globalThis.location?.search ?? "")) return null;
  try {
    const w = new Worker(new URL("./paint.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<PaintOut>) => onResult(e.data);
    w.onerror = () => {
      // the worker could not start (or died): paint what it held here
      worker = null;
      w.terminate();
      paintStats.worker = false;
      for (const en of byId.values()) if (en.stage !== "final") local(en);
    };
    // dev builds change the painter without a deploy: no cache there
    const cache = process.env.NODE_ENV === "production";
    w.postMessage({ type: "init", version: `${SHEET_PAINT_VERSION}|${deployedBuild()}`, cache } satisfies PaintIn);
    worker = w;
    paintStats.worker = true;
  } catch {
    worker = null;
  }
  return worker;
}

function onResult(m: PaintOut) {
  const en = byId.get(m.id);
  if (m.stage === "error") {
    paintStats.errors++;
    if (en && en.stage !== "final") local(en); // try here (the quick recolour at least)
    if (process.env.NODE_ENV !== "production") console.warn("horse paint failed:", m.error);
    return;
  }
  if (!en || (en.stage === "final" && m.stage === "quick")) {
    m.bitmap.close();
    return;
  }
  if (m.stage === "final") {
    byId.delete(m.id);
    paintStats.final++;
    if (m.cached) paintStats.cached++;
    else {
      paintStats.paintMs += m.ms;
      paintStats.maxMs = Math.max(paintStats.maxMs, m.ms);
      if (m.warm) paintStats.warmMaxMs = Math.max(paintStats.warmMaxMs, m.ms);
      // judged on a sheet's later paints: its first one also builds the sheet's own data
      if (en.job.builds && m.warm) reportPaintMs(m.ms);
    }
  } else paintStats.quick++;
  set(en, m.bitmap, m.stage);
}

function set(en: Entry, img: SheetImage, stage: "quick" | "final") {
  const old = en.img;
  en.img = img;
  en.stage = stage;
  en.listeners.forEach((l) => l());
  if (old && old !== img && "close" in old) old.close();
  if (stage === "final") trim();
}

function trim() {
  let idle = 0;
  for (const en of entries.values()) if (!en.refs) idle++;
  if (idle <= MAX_IDLE) return;
  const old = [...entries.values()].filter((e) => !e.refs && e.stage === "final").sort((a, b) => a.used - b.used);
  for (const en of old.slice(0, idle - MAX_IDLE)) {
    entries.delete(en.key);
    if (en.img && "close" in en.img) en.img.close();
  }
}

// ----------------------------------------------------------------------------- main-thread fallback

const localQueue: { en: Entry; quick: boolean }[] = [];
let localBusy = false;
const localPixels = new Map<string, Promise<Rgba>>();
const localSheets = new Set<string>();

function decodeHere(src: string): Promise<Rgba> {
  let p = localPixels.get(src);
  if (!p) {
    p = new Promise<Rgba>((res, rej) => {
      const im = new Image();
      im.onload = () => {
        const c = document.createElement("canvas");
        c.width = im.width;
        c.height = im.height;
        const x = c.getContext("2d", { willReadFrequently: true })!;
        x.drawImage(im, 0, 0);
        res({ data: x.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height });
      };
      im.onerror = () => rej(new Error(`art: ${src}`));
      im.src = `/art/${src}`;
    });
    p.catch(() => localPixels.delete(src));
    localPixels.set(src, p);
    if (localPixels.size > 12) localPixels.delete(localPixels.keys().next().value!);
  }
  return p;
}

let atlasImg: Promise<HTMLImageElement | null> | null = null;
function atlasHere() {
  atlasImg ??= new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = `/art/${COAT_ATLAS_SRC}`;
  });
  return atlasImg.then((im) => coatAtlasOf(im));
}

function canvasOf(data: Uint8ClampedArray, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
  return c;
}

function local(en: Entry) {
  byId.delete(en.id);
  if (en.stage === "none") localQueue.push({ en, quick: true });
  localQueue.push({ en, quick: false });
  pumpLocal();
}

function pumpLocal() {
  if (localBusy || !localQueue.length) return;
  localBusy = true;
  // quick passes first, then the most urgent
  localQueue.sort((a, b) => (a.quick !== b.quick ? (a.quick ? -1 : 1) : a.en.prio - b.en.prio));
  const { en, quick } = localQueue.shift()!;
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  const go = async () => {
    try {
      if (en.stage === "final" || (!en.refs && !quick && en.stage !== "none")) return;
      const files = jobFiles(en.job);
      const strip = await decodeHere(files.strip);
      if (quick) {
        if (en.stage === "none") set(en, canvasOf(paintSheetQuick(en.job, strip), en.job.w, en.job.h), "quick");
        return;
      }
      const [full, atlas] = await Promise.all([files.full ? decodeHere(files.full).catch(() => null) : null, files.atlas ? atlasHere() : null]);
      const t0 = performance.now();
      const data = paintSheet(en.job, strip, full, atlas);
      const ms = performance.now() - t0;
      paintStats.final++;
      paintStats.paintMs += ms;
      paintStats.maxMs = Math.max(paintStats.maxMs, ms);
      const sheet = files.full ?? files.strip;
      if (en.job.builds && localSheets.has(sheet)) reportPaintMs(ms);
      localSheets.add(sheet);
      set(en, canvasOf(data, en.job.w, en.job.h), "final");
    } catch {
      paintStats.errors++;
    } finally {
      localBusy = false;
      setTimeout(pumpLocal, 0);
    }
  };
  if (quick || !idle) setTimeout(() => void go(), 0);
  else idle(() => void go(), { timeout: 1500 });
}

// ----------------------------------------------------------------------------- requests

/**
 * Ask for a keyed strip painted for a look. `src` is the strip drawn (under /art), `w`/`h` its
 * size, `fw`/`frames` its frame layout; `prio` 0 for on screen, higher for later.
 */
export function requestSheet(src: string, w: number, h: number, fw: number, frames: number, look: DioramaHorseLook, prio = 0): SheetHandle {
  const job: SheetPaintJob = { src, w, h, fw, frames, look, builds: buildsOn() };
  const key = sheetKey(job);
  let en = entries.get(key);
  if (en) {
    if (en.stage === "final") paintStats.memHits++;
  } else {
    en = { key, id: nextId++, job, img: null, stage: "none", listeners: new Set(), refs: 0, prio, used: 0 };
    entries.set(key, en);
    byId.set(en.id, en);
    paintStats.jobs++;
    const wk = getWorker();
    if (wk) wk.postMessage({ type: "job", id: en.id, key, quick: true, job, prio } satisfies PaintIn);
    else local(en);
  }
  const e = en;
  e.refs++;
  e.used = performance.now();
  if (prio < e.prio && e.stage !== "final") {
    e.prio = prio;
    worker?.postMessage({ type: "prio", id: e.id, prio } satisfies PaintIn);
  }
  let released = false;
  return {
    key,
    image: () => e.img,
    stage: () => e.stage,
    listen(cb) {
      e.listeners.add(cb);
      return () => e.listeners.delete(cb);
    },
    prio(p) {
      if (e.stage === "final" || p === e.prio) return;
      e.prio = p;
      worker?.postMessage({ type: "prio", id: e.id, prio: p } satisfies PaintIn);
    },
    release() {
      if (released) return;
      released = true;
      e.refs--;
      e.used = performance.now();
      if (e.refs > 0) return;
      if (e.stage !== "final") {
        // nobody wants it: drop the unfinished job (it is asked for again if needed)
        worker?.postMessage({ type: "drop", id: e.id } satisfies PaintIn);
        byId.delete(e.id);
        entries.delete(e.key);
        if (e.img && "close" in e.img) e.img.close();
        for (let i = localQueue.length - 1; i >= 0; i--) if (localQueue[i]!.en === e) localQueue.splice(i, 1);
      } else trim();
    },
  };
}
