/**
 * Horse paint worker: paints keyed horse strips for a look off the main thread (fetch, decode,
 * coat, build, long hair, island clean-up: sheetPaint.ts) and hands back ImageBitmaps the page
 * only has to draw. Finished strips are kept in IndexedDB (lib/paintCache.ts) as PNGs, so a horse
 * is painted once per device and version. The order of work is paintQueue.ts.
 */
import { atlasFromRgba, type CoatAtlas } from "@thoroughbred/art-pipeline";
import { paintCache, type PaintCache } from "@/lib/paintCache";
import { PaintQueue, type PaintIn, type PaintOut } from "./paintQueue";
import { COAT_ATLAS_SRC } from "./recolor";
import type { Rgba } from "./sheetPaint";

export type { PaintIn };
export type PaintOutMsg = PaintOut<ImageBitmap>;

const ctx = self as unknown as { onmessage: ((e: MessageEvent<PaintIn>) => void) | null; postMessage: (m: PaintOutMsg, transfer?: Transferable[]) => void };

let base = "";
let cache: PaintCache | null = null;

const decoded = new Map<string, Promise<Rgba>>();
const MAX_DECODED = 16;
function pixels(src: string): Promise<Rgba> {
  let p = decoded.get(src);
  if (p) {
    decoded.delete(src);
    decoded.set(src, p);
    return p;
  }
  p = (async () => {
    const res = await fetch(`${base}/art/${src}`);
    if (!res.ok) throw new Error(`art ${res.status}: ${src}`);
    // decoded like an <img> drawn on a canvas (the main-thread painter's input)
    const bmp = await createImageBitmap(await res.blob());
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const x = cv.getContext("2d", { willReadFrequently: true });
    if (!x) throw new Error("no 2d context");
    x.drawImage(bmp, 0, 0);
    bmp.close();
    return { data: x.getImageData(0, 0, cv.width, cv.height).data, w: cv.width, h: cv.height };
  })();
  p.catch(() => decoded.delete(src));
  decoded.set(src, p);
  if (decoded.size > MAX_DECODED) decoded.delete(decoded.keys().next().value!);
  return p;
}

let atlasP: Promise<CoatAtlas | null> | null = null;

let queue: PaintQueue<ImageBitmap, Blob> | null = null;
function makeQueue(): PaintQueue<ImageBitmap, Blob> {
  return new PaintQueue<ImageBitmap, Blob>({
    pixels,
    atlas: () =>
      (atlasP ??= pixels(COAT_ATLAS_SRC).then(
        (p) => atlasFromRgba(p.data, p.w, p.h, 1),
        () => {
          atlasP = null;
          return null;
        },
      )),
    picture: (data, w, h) => createImageBitmap(new ImageData(new Uint8ClampedArray(data), w, h)),
    fromCache: async (blob, w, h) => {
      const b = await createImageBitmap(blob);
      if (b.width === w && b.height === h) return b;
      b.close();
      return null;
    },
    encode: async (data, w, h) => {
      const cv = new OffscreenCanvas(w, h);
      const x = cv.getContext("2d");
      if (!x) throw new Error("no 2d context");
      x.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
      return cv.convertToBlob({ type: "image/png" });
    },
    cache: cache ? { get: (k) => cache!.get<Blob>(k), put: (k, v) => cache!.put(k, v) } : null,
    post: (m) => ctx.postMessage(m, m.stage === "error" ? [] : [m.bitmap]),
    later: (fn) => setTimeout(fn, 0),
    now: () => performance.now(),
  });
}

const early: PaintIn[] = [];
ctx.onmessage = (e) => {
  const m = e.data;
  if (m.type === "init") {
    base = m.base ?? "";
    const start = (c: PaintCache | null) => {
      cache = c;
      queue = makeQueue();
      for (const x of early.splice(0)) handle(x);
    };
    if (m.cache) paintCache("strips", m.version).then(start, () => start(null));
    else start(null);
    return;
  }
  if (!queue) early.push(m);
  else handle(m);
};

function handle(m: PaintIn) {
  if (!queue) return;
  if (m.type === "job") queue.add(m.id, m.key, m.job, m.prio, m.quick);
  else if (m.type === "prio") queue.prio(m.id, m.prio);
  else if (m.type === "drop") queue.drop(m.id);
}
