/**
 * The precomputed sheet container (pure, no imports but the palette-index code): see sheets.ts.
 * The page decodes it in a worker (sheet.worker.ts), or here when workers are unavailable.
 *
 * Container (one file per sheet, gzipped on disk):
 *   "PTS1" | u32 header length | header JSON | planes...
 * Only the first level of detail is stored (the others are its exact downsamples, rebuilt on
 * decode). RGBA arrays are split into channel planes, each stored the way gzip packs best.
 */
import type { WarpAnchors } from "@thoroughbred/art-pipeline";
import type { AnimId } from "../stage/motion";
import { downsampleFrames, newPalette, type IndexedFrames, type Palette } from "./indexed";

export interface StripSet {
  /** Levels of detail: lods[s - 1] is the s:1 copy (s = 1..4). */
  lods: IndexedFrames[];
  /** Per-frame silks box (source texels). */
  silk: Float32Array;
  /** Marking masks at lods[0] resolution (RGBA grid; R region, G param, B face edge). */
  mask: Uint8Array;
  /** Horse-space coordinates for the coat layers (strips.coatMasks): body u/v, and leg/face/tail params. */
  maskUv: Uint8Array;
  maskPq: Uint8Array;
  /** Barrel depth of this strip (texels at lods[0]): the coat layers' unit. */
  geoH: number;
  /** Source texels per metre (the idle strip is authored a little larger). */
  pxPerM: number;
  /** Body build landmarks per frame (art-pipeline bodyBuild), the same the CPU painter warps with. */
  warp: WarpAnchors;
}

/** Sheet ids in palette order: gallop, idle, then the race-day strips. */
export type SheetId = "gallop" | "idle" | Exclude<AnimId, "gallop" | "idle">;
/** Manifest facts of a sheet that the derived data depends on. */
export interface SheetEntry {
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  anchor: { x: number; y: number };
}
/** Rebuild a palette from its packed colours (index 0 = transparent). */
export function paletteFrom(colours: readonly number[]): Palette {
  const p = newPalette();
  for (let i = 1; i < colours.length; i++) {
    const c = colours[i]!;
    p.colours.push(c);
    p.lookup.set(c, i);
    p.luma.push(((c >> 16) & 255) * 0.299 + ((c >> 8) & 255) * 0.587 + (c & 255) * 0.114);
  }
  return p;
}
// ---------------------------------------------------------------------------------- codec

/** Bump when the container or the derived data's meaning changes. */
export const SHEET_FORMAT = 1;
const MAGIC = 0x31535450; // "PTS1" little-endian
/** Levels of detail rebuilt on decode (exact downsamples of the first: cheaper than shipping them). */
export const SHEET_LODS = 4;

interface SheetHeader {
  format: number;
  pxPerM: number;
  geoH: number;
  silk: number[];
  warp: WarpAnchors;
  lod: { frames: number; fw: number; fh: number; cols: number; width: number; height: number; anchor: { x: number; y: number }; normal: boolean };
}

/**
 * How each plane is stored (chosen by what gzip packs best): NONE raw, UP minus the texel above,
 * OPAQUE only the texels with a palette index, each minus the previous such texel (normals).
 */
const NONE = 0;
const UP = 1;
const OPAQUE = 2;
type Filter = typeof NONE | typeof UP | typeof OPAQUE;
const MASK_FILTERS: Filter[] = [NONE, NONE, NONE, NONE];
const UV_FILTERS: Filter[] = [NONE, NONE, UP, NONE];
const NORMAL_FILTERS: Filter[] = [OPAQUE, OPAQUE, OPAQUE];

interface PlaneSpec {
  data: Uint8Array;
  channels: number;
  filters: Filter[];
}

function planeSpecs(l: IndexedFrames, mask: Uint8Array, uv: Uint8Array, pq: Uint8Array): PlaneSpec[] {
  const out: PlaneSpec[] = [{ data: l.index, channels: 1, filters: [NONE] }];
  // normal alpha is not stored: it is 255 exactly where the texel has a palette index
  if (l.normal) out.push({ data: l.normal, channels: 4, filters: NORMAL_FILTERS });
  out.push({ data: mask, channels: 4, filters: MASK_FILTERS }, { data: uv, channels: 4, filters: UV_FILTERS }, { data: pq, channels: 4, filters: MASK_FILTERS });
  return out;
}

/** The uncompressed container of one sheet (its first level of detail; the others are rebuilt). */
export function encodeSheet(st: StripSet): Uint8Array {
  const l = st.lods[0]!;
  const header: SheetHeader = {
    format: SHEET_FORMAT,
    pxPerM: st.pxPerM,
    geoH: st.geoH,
    silk: Array.from(st.silk),
    warp: st.warp,
    lod: { frames: l.frames, fw: l.fw, fh: l.fh, cols: l.cols, width: l.width, height: l.height, anchor: { ...l.anchor }, normal: !!l.normal },
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const n = l.width * l.height;
  const opaque = l.index.reduce((s, k) => s + (k ? 1 : 0), 0);
  let size = 8 + json.length;
  for (const p of planeSpecs(l, st.mask, st.maskUv, st.maskPq)) for (const f of p.filters) size += f === OPAQUE ? opaque : n;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, json.length, true);
  out.set(json, 8);
  let o = 8 + json.length;
  const W = l.width;
  for (const { data, channels, filters } of planeSpecs(l, st.mask, st.maskUv, st.maskPq)) {
    filters.forEach((f, c) => {
      let prev = 0;
      for (let i = 0; i < n; i++) {
        const v = data[i * channels + c]!;
        if (f === NONE) out[o++] = v;
        else if (f === UP) out[o++] = (v - (i >= W ? data[(i - W) * channels + c]! : 0)) & 255;
        else if (l.index[i]) {
          out[o++] = (v - prev) & 255;
          prev = v;
        }
      }
    });
  }
  return out;
}

/** One sheet from its uncompressed container; null when it is not one (or another format). */
export function decodeSheet(bytes: Uint8Array, palette: Palette): StripSet | null {
  if (bytes.length < 8) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) return null;
  const hl = dv.getUint32(4, true);
  let header: SheetHeader;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hl))) as SheetHeader;
  } catch {
    return null;
  }
  if (header.format !== SHEET_FORMAT || !header.lod) return null;
  const h = header.lod;
  const n = h.width * h.height;
  const W = h.width;
  let o = 8 + hl;
  if (o + n > bytes.length) return null;
  const index = bytes.slice(o, o + n);
  o += n;
  // the opaque texels (where the OPAQUE planes have bytes), in scan order
  let count = 0;
  for (let i = 0; i < n; i++) if (index[i]) count++;
  const opaque = new Int32Array(count);
  for (let i = 0, j = 0; i < n; i++) if (index[i]) opaque[j++] = i;
  const take = (channels: number, filters: Filter[]): Uint8Array | null => {
    const out = new Uint8Array(n * channels);
    let p = o;
    for (let c = 0; c < filters.length; c++) {
      const f = filters[c]!;
      if (f === OPAQUE) {
        if (p + count > bytes.length) return null;
        let v = 0;
        for (let j = 0; j < count; j++) {
          v = (v + bytes[p + j]!) & 255;
          out[opaque[j]! * channels + c] = v;
        }
        p += count;
        continue;
      }
      if (p + n > bytes.length) return null;
      if (f === UP) {
        for (let i = 0; i < W && i < n; i++) out[i * channels + c] = bytes[p + i]!;
        for (let i = W; i < n; i++) out[i * channels + c] = (bytes[p + i]! + out[(i - W) * channels + c]!) & 255;
      } else for (let i = 0; i < n; i++) out[i * channels + c] = bytes[p + i]!;
      p += n;
    }
    o = p;
    return out;
  };
  let normal: Uint8Array | null = null;
  if (h.normal) {
    normal = take(4, NORMAL_FILTERS);
    if (!normal) return null;
    for (let j = 0; j < count; j++) normal[opaque[j]! * 4 + 3] = 255;
  }
  const mask = take(4, MASK_FILTERS);
  const maskUv = take(4, UV_FILTERS);
  const maskPq = take(4, MASK_FILTERS);
  if (!mask || !maskUv || !maskPq || o !== bytes.length) return null;
  const l1: IndexedFrames = { frames: h.frames, fw: h.fw, fh: h.fh, cols: h.cols, width: h.width, height: h.height, index, normal, anchor: { ...h.anchor }, s: 1 };
  const lods = [l1];
  for (let s = 2; s <= SHEET_LODS; s++) lods.push(downsampleFrames(l1, s, palette));
  return { lods, silk: Float32Array.from(header.silk), mask, maskUv, maskPq, geoH: header.geoH, pxPerM: header.pxPerM, warp: header.warp };
}

/** The precomputed sheets' index (race/sheets/index.json). */
export interface SheetIndex {
  format: number;
  /** Hash of everything the data was built from (sheet files, palette keys, manifest entries). */
  key: string;
  /** The shared palette (packed RGB; index 0 = transparent). */
  palette: number[];
  sheets: {
    id: SheetId;
    stem: string;
    /** File next to index.json (content-hashed name: immutable). */
    file: string;
    bytes: number;
    /** The manifest entry the data was built from (a mismatch means stale: build in the browser). */
    entry: SheetEntry;
    pxPerM: number;
  }[];
}

/** The sprite extents of a sheet without its pixels (first-level frame size, anchor, density). */
export function sheetFrame(entry: SheetEntry, width: number): { fw: number; fh: number; anchor: { x: number; y: number }; frames: number } {
  const fw = entry.frameWidth;
  const fh = entry.frameHeight;
  return { fw, fh, anchor: { x: Math.round(entry.anchor.x * fw), y: Math.round(entry.anchor.y * fh) }, frames: Math.max(1, Math.min(entry.frameCount, Math.floor(width / fw))) };
}

/** The body of a gzipped response, inflated by the browser (DecompressionStream). */
export async function gunzipResponse(res: Response): Promise<Uint8Array> {
  const DS = (globalThis as { DecompressionStream?: new (format: string) => TransformStream<Uint8Array, Uint8Array> }).DecompressionStream;
  if (!DS) throw new Error("no DecompressionStream");
  const body = res.body ?? new Blob([await res.arrayBuffer()]).stream();
  return new Uint8Array(await new Response(body.pipeThrough(new DS("gzip"))).arrayBuffer());
}

/** Every array buffer of a sheet once (to hand it between threads without copying). */
export function sheetBuffers(st: StripSet): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  const add = (a: Uint8Array | Float32Array | null) => {
    if (a && a.buffer instanceof ArrayBuffer) out.add(a.buffer);
  };
  for (const l of st.lods) {
    add(l.index);
    add(l.normal);
  }
  for (const a of [st.mask, st.maskUv, st.maskPq, st.silk]) add(a);
  return [...out];
}
