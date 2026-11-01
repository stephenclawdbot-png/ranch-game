/**
 * The paint worker's queue (paint.worker.ts), with its inputs and outputs passed in so it runs
 * (and is tested) anywhere: decoded art in, finished pictures out, a cache in between.
 *
 * Order: a job's cache lookup first (a hit answers at once), then every waiting quick pass
 * (cheap, so no horse is ever blank), then the finished strips, most wanted first (`prio`: 0 on
 * screen, higher later), oldest first within a priority. One task at a time, yielding between
 * tasks so new jobs and priority changes are read in time.
 */
import type { CoatAtlas } from "@thoroughbred/art-pipeline";
import { jobFiles, paintSheet, paintSheetQuick, type Rgba, type SheetPaintJob } from "./sheetPaint";

export type PaintIn =
  | { type: "init"; version: string; cache: boolean; base?: string }
  | { type: "job"; id: number; key: string; quick: boolean; job: SheetPaintJob; prio: number }
  | { type: "prio"; id: number; prio: number }
  | { type: "drop"; id: number };

/**
 * `ms`: the painting time; `warm`: the sheet's look-independent data (geometry, hair field,
 * warp landmarks: built on its first paint in a session, then cached) was already built, so `ms`
 * is the per-look cost the device tier judges.
 */
export type PaintOut<B> = { id: number; stage: "quick" | "final"; bitmap: B; ms: number; cached: boolean; warm?: boolean } | { id: number; stage: "error"; error: string };

export interface PaintDeps<B, Blob> {
  pixels(src: string): Promise<Rgba>;
  atlas(): Promise<CoatAtlas | null>;
  /** A drawable picture of RGBA (transferred to the page). */
  picture(data: Uint8ClampedArray, w: number, h: number): Promise<B>;
  /** A cached record back to a picture (null if it is not the right size). */
  fromCache(blob: Blob, w: number, h: number): Promise<B | null>;
  /** RGBA to what the cache keeps (PNG). */
  encode(data: Uint8ClampedArray, w: number, h: number): Promise<Blob>;
  cache: { get(key: string): Promise<Blob | null>; put(key: string, v: Blob): Promise<void> } | null;
  post(m: PaintOut<B>): void;
  /** Run a function after pending messages (setTimeout 0). */
  later(fn: () => void): void;
  now(): number;
}

interface Task {
  id: number;
  key: string;
  job: SheetPaintJob;
  prio: number;
  seq: number;
  quick: boolean;
  /** False until the cache lookup missed. */
  ready: boolean;
}

export class PaintQueue<B, Blob> {
  private tasks = new Map<number, Task>();
  private seq = 0;
  private running = false;
  private puts = 0;
  private sheets = new Set<string>();
  /** Resolves when the queue is empty and idle (tests). */
  private idle: (() => void)[] = [];

  constructor(private readonly d: PaintDeps<B, Blob>) {}

  add(id: number, key: string, job: SheetPaintJob, prio: number, quick: boolean): void {
    const t: Task = { id, key, job, prio, seq: this.seq++, quick, ready: false };
    this.tasks.set(id, t);
    void this.lookup(t);
  }

  prio(id: number, prio: number): void {
    const t = this.tasks.get(id);
    if (t) t.prio = prio;
  }

  drop(id: number): void {
    this.tasks.delete(id);
  }

  get size(): number {
    return this.tasks.size;
  }

  /** Resolves once nothing is queued or running. */
  drained(): Promise<void> {
    if (!this.tasks.size && !this.running && !this.puts) return Promise.resolve();
    return new Promise((res) => this.idle.push(res));
  }

  private async lookup(t: Task) {
    const c = this.d.cache;
    if (c) {
      try {
        const blob = await c.get(t.key);
        if (blob && this.tasks.has(t.id)) {
          const pic = await this.d.fromCache(blob, t.job.w, t.job.h);
          if (pic) {
            this.tasks.delete(t.id);
            this.d.post({ id: t.id, stage: "final", bitmap: pic, ms: 0, cached: true });
            this.settle();
            return;
          }
        }
      } catch {
        /* paint it */
      }
    }
    t.ready = true;
    this.pump();
  }

  private next(): Task | null {
    let best: Task | null = null;
    for (const t of this.tasks.values()) {
      if (!t.ready) continue;
      if (!best) best = t;
      else if (t.quick !== best.quick) best = t.quick ? t : best;
      else if (t.prio !== best.prio) best = t.prio < best.prio ? t : best;
      else if (t.seq < best.seq) best = t;
    }
    return best;
  }

  private pump() {
    if (this.running) return;
    const t = this.next();
    if (!t) return this.settle();
    this.running = true;
    void this.run(t).finally(() => {
      this.running = false;
      // a macrotask between tasks: new messages are handled first
      this.d.later(() => this.pump());
    });
  }

  private settle() {
    if (this.tasks.size || this.running || this.puts) return;
    const w = this.idle;
    this.idle = [];
    w.forEach((r) => r());
  }

  private async run(t: Task) {
    const { job } = t;
    try {
      const files = jobFiles(job);
      const strip = await this.d.pixels(files.strip);
      if (t.quick) {
        t.quick = false; // the finished pass stays queued
        const t0 = this.d.now();
        const data = paintSheetQuick(job, strip);
        const ms = this.d.now() - t0;
        if (!this.tasks.has(t.id)) return;
        this.d.post({ id: t.id, stage: "quick", bitmap: await this.d.picture(data, job.w, job.h), ms, cached: false });
        return;
      }
      this.tasks.delete(t.id);
      const [full, atlas] = await Promise.all([files.full ? this.d.pixels(files.full).catch(() => null) : Promise.resolve(null), files.atlas ? this.d.atlas() : Promise.resolve(null)]);
      const sheet = full && files.full ? files.full : files.strip;
      const warm = this.sheets.has(sheet);
      this.sheets.add(sheet);
      const t0 = this.d.now();
      const data = paintSheet(job, strip, full, atlas);
      const ms = this.d.now() - t0;
      this.d.post({ id: t.id, stage: "final", bitmap: await this.d.picture(data, job.w, job.h), ms, cached: false, warm });
      const c = this.d.cache;
      if (c) {
        this.puts++;
        void this.d
          .encode(data, job.w, job.h)
          .then((b) => c.put(t.key, b))
          .catch(() => undefined)
          .finally(() => {
            this.puts--;
            this.settle();
          });
      }
    } catch (e) {
      this.tasks.delete(t.id);
      this.d.post({ id: t.id, stage: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }
}
