/**
 * Decodes precomputed horse sheets off the main thread (fetch, gunzip, planes, the downsampled
 * levels of detail) and hands the arrays back without copying. See sheetCodec.ts.
 */
import { decodeSheet, gunzipResponse, paletteFrom, sheetBuffers, type StripSet } from "./sheetCodec";

export interface SheetJob {
  id: number;
  /** Absolute URL of the gzipped container. */
  url: string;
  palette: number[];
}
export interface SheetDone {
  id: number;
  st: StripSet | null;
}

const ctx = self as unknown as { onmessage: ((e: MessageEvent<SheetJob>) => void) | null; postMessage: (m: SheetDone, transfer?: Transferable[]) => void };

ctx.onmessage = (e) => {
  const { id, url, palette } = e.data;
  void (async () => {
    let st: StripSet | null = null;
    try {
      const res = await fetch(url);
      if (res.ok) st = decodeSheet(await gunzipResponse(res), paletteFrom(palette));
    } catch {
      st = null;
    }
    ctx.postMessage({ id, st }, st ? sheetBuffers(st) : []);
  })();
};
