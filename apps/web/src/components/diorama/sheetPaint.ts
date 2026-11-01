/**
 * One keyed horse strip painted for a look (pure: RGBA in, RGBA out, no DOM), the job the paint
 * worker runs (paint.worker.ts) and, where no worker can run, the main thread. It is the
 * diorama engine's former in-place painting, unchanged: a player's horse is painted on the
 * full-size sheet and reduced like the N:1 copies were made; anything else is painted on the
 * strip itself. `quick` is the cheap first pass shown until the full one is ready: the coat,
 * silks and rider recoloured on the drawn strip, no coat layers, build or long hair.
 */
import { withBuildSwitch, type CoatAtlas } from "@thoroughbred/art-pipeline";
import { applyRiderLook, downsampleSheet, fullSheetOf, lookKey, paintHorseSheet, type DioramaHorseLook } from "./recolor";

/** Bump when the painter's output changes for the same inputs (cached strips are thrown away). */
export const SHEET_PAINT_VERSION = 1;

export interface SheetPaintJob {
  /** The strip drawn (under /art), maybe an N:1 copy. */
  src: string;
  /** Its size and frame layout. */
  w: number;
  h: number;
  fw: number;
  frames: number;
  look: DioramaHorseLook;
  /** Whether this device draws body builds and per-horse hair (art-pipeline buildsOn). */
  builds: boolean;
}

export interface Rgba {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

/** The files a job reads: the strip, the full-size sheet it was reduced from (a player's horse), the coat-layer atlas. */
export function jobFiles(job: SheetPaintJob): { strip: string; full: string | null; atlas: boolean } {
  const atlas = !!job.look.appearance;
  return { strip: job.src, full: atlas ? (fullSheetOf(job.src)?.src ?? null) : null, atlas };
}

/** Cache key of a job's finished strip (everything that changes its pixels). */
export function sheetKey(job: SheetPaintJob, quick = false): string {
  return withBuildSwitch(job.builds, () => `v${SHEET_PAINT_VERSION}|${job.src}|${job.w}x${job.h}/${job.frames}|${lookKey(job.look)}|${quick ? "q" : job.builds ? "b1" : "b0"}`);
}

/** The cheap first pass: recolour, silks and rider on the drawn strip. */
export function paintSheetQuick(job: SheetPaintJob, strip: Rgba): Uint8ClampedArray {
  const data = new Uint8ClampedArray(strip.data);
  applyRiderLook(data, job.w, job.h, job.fw, job.look, false);
  return data;
}

/**
 * The finished strip (job.w x job.h RGBA): exactly what the engine used to paint on the main
 * thread for the same inputs. `full` is the full-size sheet's pixels when jobFiles named one,
 * `atlas` the decoded coat-layer atlas (null when it could not load).
 */
export function paintSheet(job: SheetPaintJob, strip: Rgba, full: Rgba | null, atlas: CoatAtlas | null): Uint8ClampedArray {
  return withBuildSwitch(job.builds, () => {
    const f = job.look.appearance && atlas ? fullSheetOf(job.src) : null;
    if (f && full) {
      const fd = new Uint8ClampedArray(full.data);
      // the cloth's number survives a 2:1 reduction (2-texel cells), not a smaller copy
      paintHorseSheet(fd, full.w, full.h, Math.floor(full.w / job.frames), job.look, atlas, f.src, f.n <= 2);
      const small = downsampleSheet(fd, full.w, full.h, job.frames, f.n);
      const out = new Uint8ClampedArray(job.w * job.h * 4);
      for (let y = 0; y < Math.min(small.height, job.h); y++) out.set(small.data.subarray(y * small.width * 4, y * small.width * 4 + Math.min(small.width, job.w) * 4), y * job.w * 4);
      return out;
    }
    const d = new Uint8ClampedArray(strip.data);
    paintHorseSheet(d, job.w, job.h, job.fw, job.look, atlas, job.src);
    return d;
  });
}
