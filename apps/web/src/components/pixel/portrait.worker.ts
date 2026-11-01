/**
 * Portrait worker: renders genetic 3/4 portraits off the main thread (fetch, decode,
 * recolour, PNG encode on an OffscreenCanvas). One message per horse; answers with the
 * blobs or an error, and the page keeps the painted portrait on an error. Finished portraits
 * are kept in IndexedDB (lib/paintCache.ts) by their key, so a horse is rendered once per device.
 */
import type { HorseAppearance } from "@thoroughbred/shared";
import { setBuildSwitch } from "@thoroughbred/art-pipeline";
import { paintCache } from "@/lib/paintCache";
import { renderGeneticPortrait, type GeneticPortraitBlobs, type PortraitAnim } from "./geneticPortraitRender";

export interface PortraitJob {
  id: number;
  appearance: HorseAppearance;
  thumb: boolean;
  anim: PortraitAnim | null;
  /** Whether the page draws body builds (the head's size follows the build): a worker can't read the page's tier. */
  builds: boolean;
  /** The cache key (geneticPortraitKey) and version; no key = no cache. */
  key?: string;
  version?: string;
}

/** The bits of the worker scope used here (the app compiles against the DOM lib). */
const ctx = self as unknown as { onmessage: ((e: MessageEvent<PortraitJob>) => void) | null; postMessage: (m: unknown) => void };

// One horse at a time, in arrival order, so the first portraits on the page swap in first
// instead of every horse finishing together.
let queue: Promise<void> = Promise.resolve();
ctx.onmessage = (e) => {
  const { id, appearance, thumb, anim, builds, key, version } = e.data;
  // a cache hit answers at once, ahead of the queue
  const cache = key && version ? paintCache(`portrait|${version}`) : null;
  const hit = cache ? cache.then((c) => c.get<GeneticPortraitBlobs>(key!)).catch(() => null) : Promise.resolve(null);
  void hit.then((b) => {
    if (b?.strip) {
      ctx.postMessage({ id, ...b });
      return;
    }
    queue = queue.then(async () => {
      try {
        setBuildSwitch(builds);
        const blobs = await renderGeneticPortrait(appearance, thumb, anim);
        ctx.postMessage({ id, ...blobs });
        if (cache) void cache.then((c) => c.put(key!, blobs));
      } catch (err) {
        ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
      } finally {
        setBuildSwitch(null);
      }
    });
  });
};
