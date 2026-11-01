/**
 * The paint worker's painter (sheetPaint.ts, run by paintQueue.ts) gives byte-identical pixels to
 * the engine's former main-thread painter for the same inputs, builds on and off; the queue's
 * order, its cache hit path, and the page side's memory cache.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { saddleClothOf, setBuildSwitch, type CoatAtlas } from "@thoroughbred/art-pipeline";
import { atlas, png } from "./testArt";
import { IDENTITY_HORSES, identityAppearance } from "@/dev/identityHorses";
import { DIORAMA_ATLAS } from "./atlas.generated";
import { applyRiderLook, downsampleSheet, fullSheetOf, paintHorseSheet, type DioramaHorseLook } from "./recolor";
import { jobFiles, paintSheet, paintSheetQuick, sheetKey, type SheetPaintJob } from "./sheetPaint";
import { PaintQueue, type PaintOut } from "./paintQueue";

/**
 * The engine's main-thread painter before the worker (engine.ts sprite(), 2026-11-01), on
 * arrays instead of canvases: a player's horse on its full-size sheet, painted and reduced into
 * a cleared strip-sized buffer; anything else painted on the strip in place.
 */
function oldPainter(src: string, fw: number, frames: number, look: DioramaHorseLook, at: CoatAtlas | null): Uint8ClampedArray {
  const im = png(src);
  const full = look.appearance && at ? fullSheetOf(src) : null;
  const fim = full ? png(full.src) : undefined;
  if (full && fim) {
    const fd = new Uint8ClampedArray(fim.data);
    paintHorseSheet(fd, fim.w, fim.h, Math.floor(fim.w / frames), look, at, full.src, full.n <= 2);
    const small = downsampleSheet(fd, fim.w, fim.h, frames, full.n);
    const id = new Uint8ClampedArray(im.w * im.h * 4);
    for (let y = 0; y < Math.min(small.height, im.h); y++) id.set(small.data.subarray(y * small.width * 4, y * small.width * 4 + Math.min(small.width, im.w) * 4), y * im.w * 4);
    return id;
  }
  const d = new Uint8ClampedArray(im.data);
  paintHorseSheet(d, im.w, im.h, fw, look, at, src);
  return d;
}

const ANIMS = DIORAMA_ATLAS.anims as Record<string, { fw: number; fh: number; frames: number }>;
const strip = (name: string) => {
  const a = ANIMS[name]!;
  return { src: `diorama/${name}.png`, fw: a.fw, frames: a.frames };
};
const SHEETS = [strip("horse-loose-walk-s2"), strip("horse-loose-graze-s3"), strip("horse-loose-idle"), strip("horse-walk-jockey-s2")];
const LOOKS: DioramaHorseLook[] = IDENTITY_HORSES.map((h, i) => {
  const a = identityAppearance(h, i);
  return { coat: a.coat, appearance: a, cloth: i % 3 === 0 ? saddleClothOf((i % 12) + 1) : undefined };
});

const jobOf = (s: (typeof SHEETS)[number], look: DioramaHorseLook, builds: boolean): SheetPaintJob => {
  const im = png(s.src);
  return { src: s.src, w: im.w, h: im.h, fw: s.fw, frames: s.frames, look, builds };
};
const inputs = (job: SheetPaintJob) => {
  const f = jobFiles(job);
  return [png(f.strip), f.full ? png(f.full) : null, f.atlas ? atlas() : null] as const;
};

afterEach(() => setBuildSwitch(null));

describe("worker painter = the old main-thread painter", () => {
  it("byte-identical pixels for the identity horses on ranch and paddock strips, builds on and off", () => {
    expect(LOOKS.some((l) => l.appearance?.build)).toBe(true);
    let compared = 0;
    for (const builds of [true, false]) {
      for (const s of SHEETS) {
        for (const look of LOOKS) {
          const job = jobOf(s, look, builds);
          const got = paintSheet(job, ...inputs(job));
          setBuildSwitch(builds);
          const want = oldPainter(s.src, s.fw, s.frames, look, atlas());
          setBuildSwitch(null);
          expect(got.length).toBe(want.length);
          expect(Buffer.from(got.buffer, got.byteOffset, got.byteLength).equals(Buffer.from(want.buffer, want.byteOffset, want.byteLength)), `${s.src} ${look.appearance?.colour?.base} builds=${builds}`).toBe(true);
          compared++;
        }
      }
    }
    expect(compared).toBe(2 * SHEETS.length * LOOKS.length);
  }, 300_000);

  it("builds change the finished strip and its cache key; the quick pass is the plain recolour", () => {
    const look = LOOKS.find((l) => l.appearance?.build && (l.appearance.build.leg || l.appearance.build.height))!;
    const s = SHEETS[0]!;
    const on = jobOf(s, look, true);
    const off = jobOf(s, look, false);
    expect(sheetKey(on)).not.toBe(sheetKey(off));
    expect(sheetKey(on)).toBe(sheetKey({ ...on, look: JSON.parse(JSON.stringify(look)) as DioramaHorseLook }));
    expect(sheetKey(on, true)).not.toBe(sheetKey(on));
    const a = paintSheet(on, ...inputs(on));
    const b = paintSheet(off, ...inputs(off));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    const quick = paintSheetQuick(on, png(s.src));
    const want = new Uint8ClampedArray(png(s.src).data);
    applyRiderLook(want, on.w, on.h, on.fw, look, false);
    expect(Buffer.from(quick).equals(Buffer.from(want))).toBe(true);
  }, 120_000);
});

// ----------------------------------------------------------------------------- the queue

type Pic = { data: Uint8ClampedArray };
function harness(cacheInit: Map<string, Uint8ClampedArray> = new Map()) {
  const posts: PaintOut<Pic>[] = [];
  const store = cacheInit;
  const gets: string[] = [];
  const q = new PaintQueue<Pic, Uint8ClampedArray>({
    pixels: async (src) => png(src),
    atlas: async () => atlas(),
    picture: async (data) => ({ data: new Uint8ClampedArray(data) }),
    fromCache: async (blob) => ({ data: blob }),
    encode: async (data) => new Uint8ClampedArray(data),
    cache: {
      get: async (k) => {
        gets.push(k);
        return store.get(k) ?? null;
      },
      put: async (k, v) => void store.set(k, v),
    },
    post: (m) => posts.push(m),
    later: (fn) => setTimeout(fn, 0),
    now: () => 0,
  });
  return { q, posts, store, gets };
}

describe("paint queue", () => {
  it("quick passes first, then finished strips on screen before later ones; finished strips go to the cache", async () => {
    const { q, posts, store } = harness();
    const look = LOOKS[1]!;
    const later = jobOf(SHEETS[1]!, look, true);
    const now = jobOf(SHEETS[0]!, look, true);
    q.add(1, sheetKey(later), later, 3, true);
    q.add(2, sheetKey(now), now, 0, true);
    await q.drained();
    expect(posts.map((p) => `${p.id}:${p.stage}`)).toEqual(["1:quick", "2:quick", "2:final", "1:final"]);
    const fin = posts.find((p) => p.id === 2 && p.stage === "final") as { bitmap: Pic; cached: boolean };
    expect(fin.cached).toBe(false);
    expect(Buffer.from(fin.bitmap.data).equals(Buffer.from(paintSheet(now, ...inputs(now))))).toBe(true);
    expect(store.has(sheetKey(now))).toBe(true);
    expect(store.has(sheetKey(later))).toBe(true);
  }, 120_000);

  it("a cache hit answers with the finished strip at once: no quick pass, no painting", async () => {
    const look = LOOKS[2]!;
    const job = jobOf(SHEETS[0]!, look, true);
    const first = harness();
    first.q.add(1, sheetKey(job), job, 0, true);
    await first.q.drained();
    // a later visit: the same key in the cache
    const second = harness(first.store);
    const t0 = performance.now();
    second.q.add(7, sheetKey(job), job, 0, true);
    await second.q.drained();
    expect(second.posts.map((p) => `${p.id}:${p.stage}`)).toEqual(["7:final"]);
    const hit = second.posts[0] as { bitmap: Pic; cached: boolean };
    expect(hit.cached).toBe(true);
    expect(Buffer.from(hit.bitmap.data).equals(Buffer.from(first.store.get(sheetKey(job))!))).toBe(true);
    expect(performance.now() - t0).toBeLessThan(1000);
    // a lite device asks for a different key: painted, not the full strip
    const lite = jobOf(SHEETS[0]!, look, false);
    second.q.add(8, sheetKey(lite), lite, 0, false);
    await second.q.drained();
    expect((second.posts[1] as { cached: boolean }).cached).toBe(false);
  }, 120_000);

  it("a dropped job is never painted", async () => {
    const { q, posts } = harness();
    const job = jobOf(SHEETS[2]!, LOOKS[3]!, true);
    q.add(1, sheetKey(job), job, 0, true);
    q.drop(1);
    await new Promise((r) => setTimeout(r, 20));
    await q.drained();
    expect(posts).toEqual([]);
  });
});

// ----------------------------------------------------------------------------- the page side

describe("page side (sheetPainter)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("one worker job per (look, sheet, size); a second request is a memory hit", async () => {
    const sent: { type: string; id?: number; key?: string }[] = [];
    class FakeWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage(m: { type: string; id?: number; key?: string }) {
        sent.push(m);
        if (m.type === "job") setTimeout(() => this.onmessage?.({ data: { id: m.id, stage: "final", bitmap: { width: 1, height: 1, close() {} }, ms: 3, cached: false } } as MessageEvent), 0);
      }
      terminate() {}
    }
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("OffscreenCanvas", class {});
    vi.stubGlobal("createImageBitmap", async () => ({}));
    const { requestSheet, paintStats } = await import("./sheetPainter");
    const look = LOOKS[0]!;
    const a = requestSheet("diorama/horse-loose-walk-s2.png", 10, 10, 5, 2, look, 0);
    await new Promise((r) => setTimeout(r, 5));
    expect(a.stage()).toBe("final");
    const b = requestSheet("diorama/horse-loose-walk-s2.png", 10, 10, 5, 2, JSON.parse(JSON.stringify(look)) as DioramaHorseLook, 0);
    expect(b.stage()).toBe("final");
    expect(b.image()).toBe(a.image());
    expect(sent.filter((m) => m.type === "job")).toHaveLength(1);
    expect(paintStats.memHits).toBe(1);
    a.release();
    b.release();
    // a different size is its own job
    requestSheet("diorama/horse-loose-walk-s2.png", 12, 10, 6, 2, look, 0).release();
    expect(sent.filter((m) => m.type === "job")).toHaveLength(2);
  });
});
