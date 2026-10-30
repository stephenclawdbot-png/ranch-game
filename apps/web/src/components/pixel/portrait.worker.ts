/**
 * Portrait worker: renders genetic 3/4 portraits off the main thread (fetch, decode,
 * recolour, PNG encode on an OffscreenCanvas). One message per horse; answers with the
 * blobs or an error, and the page keeps the painted portrait on an error.
 */
import type { HorseAppearance } from "@thoroughbred/shared";
import { renderGeneticPortrait, type PortraitAnim } from "./geneticPortraitRender";

export interface PortraitJob {
  id: number;
  appearance: HorseAppearance;
  thumb: boolean;
  anim: PortraitAnim | null;
}

/** The bits of the worker scope used here (the app compiles against the DOM lib). */
const ctx = self as unknown as { onmessage: ((e: MessageEvent<PortraitJob>) => void) | null; postMessage: (m: unknown) => void };

// One horse at a time, in arrival order, so the first portraits on the page swap in first
// instead of every horse finishing together.
let queue: Promise<void> = Promise.resolve();
ctx.onmessage = (e) => {
  const { id, appearance, thumb, anim } = e.data;
  queue = queue.then(async () => {
    try {
      const blobs = await renderGeneticPortrait(appearance, thumb, anim);
      ctx.postMessage({ id, ...blobs });
    } catch (err) {
      ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
  });
};
