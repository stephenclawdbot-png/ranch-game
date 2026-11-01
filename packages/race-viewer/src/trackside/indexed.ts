/**
 * Palette-index strips (pure array code, no imports): the shared palette, a keyed strip turned
 * into palette indices, and its exact downsampled levels of detail. Split out of strips.ts so
 * the sheet decoder (and its worker) needs nothing else.
 */
export const MAX_COLOURS = 63;

export interface Palette {
  /** packed rgb per index; index 0 = transparent. */
  colours: number[];
  lookup: Map<number, number>;
  /** Rec.601 luma per index (tie-breaks: darker wins, keeps outlines). */
  luma: number[];
}

export function newPalette(): Palette {
  return { colours: [0], lookup: new Map(), luma: [0] };
}

/** Index of a colour, adding it (returns -1 when the palette is full). */
export function indexOf(p: Palette, packed: number): number {
  let i = p.lookup.get(packed);
  if (i !== undefined) return i;
  if (p.colours.length > MAX_COLOURS) return -1;
  i = p.colours.length;
  p.colours.push(packed);
  p.lookup.set(packed, i);
  p.luma.push(((packed >> 16) & 255) * 0.299 + ((packed >> 8) & 255) * 0.587 + (packed & 255) * 0.114);
  return i;
}

export interface IndexedFrames {
  frames: number;
  fw: number;
  fh: number;
  /** Frame grid: columns per texture row. */
  cols: number;
  /** Texture size. */
  width: number;
  height: number;
  /** Palette index per texel (row-major, row 0 = top). */
  index: Uint8Array;
  /** Tangent-space normal per texel (RGBA) or null. */
  normal: Uint8Array | null;
  /** Ground anchor in this level's texels (frame-local). */
  anchor: { x: number; y: number };
  /** Source texels per texel of this level. */
  s: number;
}

/** Texel origin of frame f. */
export function frameOrigin(f: IndexedFrames, i: number): [number, number] {
  return [(i % f.cols) * f.fw, Math.floor(i / f.cols) * f.fh];
}

export function gridFor(frames: number, fw: number, fh: number, maxW: number) {
  const cols = Math.max(1, Math.min(frames, Math.floor(maxW / fw)));
  const rows = Math.ceil(frames / cols);
  return { cols, width: cols * fw, height: rows * fh };
}

/**
 * Index a horizontal RGBA strip (frames side by side). Opaque texels (alpha >= 128) take a
 * palette index; returns null when the strip has more colours than the LUT holds.
 */
export function indexStrip(
  rgba: Uint8ClampedArray | Uint8Array,
  stripW: number,
  fh: number,
  frames: number,
  palette: Palette,
  anchor: { x: number; y: number },
  normalRgba: Uint8ClampedArray | Uint8Array | null,
  maxW = 2048,
): IndexedFrames | null {
  const fw = Math.floor(stripW / frames);
  const g = gridFor(frames, fw, fh, maxW);
  const index = new Uint8Array(g.width * g.height);
  const normal = normalRgba ? new Uint8Array(g.width * g.height * 4) : null;
  for (let f = 0; f < frames; f++) {
    const ox = (f % g.cols) * fw;
    const oy = Math.floor(f / g.cols) * fh;
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const si = (y * stripW + f * fw + x) * 4;
        const di = (oy + y) * g.width + ox + x;
        if (rgba[si + 3]! < 128) continue;
        const k = indexOf(palette, (rgba[si]! << 16) | (rgba[si + 1]! << 8) | rgba[si + 2]!);
        if (k < 0) return null;
        index[di] = k;
        if (normal && normalRgba) {
          normal[di * 4] = normalRgba[si]!;
          normal[di * 4 + 1] = normalRgba[si + 1]!;
          normal[di * 4 + 2] = normalRgba[si + 2]!;
          normal[di * 4 + 3] = 255;
        }
      }
    }
  }
  return { frames, fw, fh, cols: g.cols, width: g.width, height: g.height, index, normal, anchor: { ...anchor }, s: 1 };
}

/**
 * Exact s:1 downsample per frame. A block is opaque when >= 45 % of it is; its colour is the
 * most frequent index (ties: the darker colour), normals are averaged.
 */
export function downsampleFrames(src: IndexedFrames, s: number, palette: Palette, maxW = 2048): IndexedFrames {
  const fw = Math.ceil(src.fw / s);
  const fh = Math.ceil(src.fh / s);
  const g = gridFor(src.frames, fw, fh, maxW);
  const index = new Uint8Array(g.width * g.height);
  const normal = src.normal ? new Uint8Array(g.width * g.height * 4) : null;
  const counts = new Uint16Array(256);
  const seen: number[] = [];
  for (let f = 0; f < src.frames; f++) {
    const [sx0, sy0] = frameOrigin(src, f);
    const dx0 = (f % g.cols) * fw;
    const dy0 = Math.floor(f / g.cols) * fh;
    for (let by = 0; by < fh; by++) {
      for (let bx = 0; bx < fw; bx++) {
        let opaque = 0;
        let total = 0;
        let nx = 0;
        let ny = 0;
        let nz = 0;
        seen.length = 0;
        for (let yy = 0; yy < s; yy++) {
          const y = by * s + yy;
          if (y >= src.fh) continue;
          for (let xx = 0; xx < s; xx++) {
            const x = bx * s + xx;
            if (x >= src.fw) continue;
            total++;
            const si = (sy0 + y) * src.width + sx0 + x;
            const k = src.index[si]!;
            if (!k) continue;
            opaque++;
            if (counts[k] === 0) seen.push(k);
            counts[k]!++;
            if (src.normal) {
              nx += src.normal[si * 4]! / 127.5 - 1;
              ny += src.normal[si * 4 + 1]! / 127.5 - 1;
              nz += src.normal[si * 4 + 2]! / 127.5 - 1;
            }
          }
        }
        let best = 0;
        let bestN = 0;
        for (const k of seen) {
          const c = counts[k]!;
          if (c > bestN || (c === bestN && palette.luma[k]! < palette.luma[best]!)) {
            best = k;
            bestN = c;
          }
          counts[k] = 0;
        }
        if (!total || opaque / total < 0.45) continue;
        const di = (dy0 + by) * g.width + dx0 + bx;
        index[di] = best;
        if (normal) {
          const len = Math.hypot(nx, ny, nz) || 1;
          normal[di * 4] = Math.round((nx / len + 1) * 127.5);
          normal[di * 4 + 1] = Math.round((ny / len + 1) * 127.5);
          normal[di * 4 + 2] = Math.round((nz / len + 1) * 127.5);
          normal[di * 4 + 3] = 255;
        }
      }
    }
  }
  return { frames: src.frames, fw, fh, cols: g.cols, width: g.width, height: g.height, index, normal, anchor: { x: src.anchor.x / s, y: src.anchor.y / s }, s: src.s * s };
}

