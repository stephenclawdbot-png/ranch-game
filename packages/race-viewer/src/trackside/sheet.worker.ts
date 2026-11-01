/**
 * Decodes precomputed horse sheets off the main thread (fetch, gunzip, planes, the downsampled
 * levels of detail) and hands the arrays back without copying. See sheetCodec.ts. It also
 * reads the coat-layer atlas (one byte per pixel: the red channel), the same as the page would.
 */
import { decodeSheet, gunzipResponse, paletteFrom, sheetBuffers, type StripSet } from "./sheetCodec";

export type SheetJob =
  | {
      kind?: "sheet";
      id: number;
      /** Absolute URL of the gzipped container. */
      url: string;
      palette: number[];
    }
  | { kind: "atlas"; id: number; url: string };

export interface SheetDone {
  id: number;
  st?: StripSet | null;
  /** Atlas jobs: the red channel and its size (null: decode it on the page). */
  atlas?: { data: Uint8Array; width: number; height: number } | null;
}

const ctx = self as unknown as { onmessage: ((e: MessageEvent<SheetJob>) => void) | null; postMessage: (m: SheetDone, transfer?: Transferable[]) => void };

async function atlasOf(url: string): Promise<SheetDone["atlas"]> {
  const OC = (globalThis as { OffscreenCanvas?: new (w: number, h: number) => OffscreenCanvas }).OffscreenCanvas;
  if (!OC || typeof createImageBitmap !== "function") return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  const bmp = await createImageBitmap(await res.blob());
  const c = new OC(bmp.width, bmp.height);
  const x = c.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  if (!x) return null;
  x.drawImage(bmp, 0, 0);
  const rgba = x.getImageData(0, 0, bmp.width, bmp.height).data;
  const data = new Uint8Array(bmp.width * bmp.height);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4]!;
  return { data, width: bmp.width, height: bmp.height };
}

ctx.onmessage = (e) => {
  const job = e.data;
  void (async () => {
    if (job.kind === "atlas") {
      const atlas = await atlasOf(job.url).catch(() => null);
      ctx.postMessage({ id: job.id, atlas }, atlas ? [atlas.data.buffer as ArrayBuffer] : []);
      return;
    }
    let st: StripSet | null = null;
    try {
      const res = await fetch(job.url);
      if (res.ok) st = decodeSheet(await gunzipResponse(res), paletteFrom(job.palette));
    } catch {
      st = null;
    }
    ctx.postMessage({ id: job.id, st }, st ? sheetBuffers(st) : []);
  })();
};
