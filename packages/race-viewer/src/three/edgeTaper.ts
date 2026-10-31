/**
 * Rounds off scenery art that was cut at the image edge (pure, no DOM). Trackside lays these
 * pieces edge to edge in a band, where the cut never shows; the 3D view stands each one alone,
 * so a cut edge read as a flat wall (dunes, flowers, a clipped tree crown). Each cut side gets a
 * stepped quarter-ellipse falloff: the art keeps its full outline inside, and the last few dozen
 * pixels slope down to the ground like a natural end.
 */

/** Scenery that is natural (sand, plants, trees): rounded. Buildings, lamps, walls and boards keep straight sides. */
export const ORGANIC_MID = /mid-(dunes|flowers|gorse|hawthorn|heather|huts|rowan|willow)\.png$/;

const OPAQUE = 128;

/** Opaque height of column x (rows from the bottom up to its topmost opaque pixel). */
function columnHeight(data: Uint8ClampedArray, w: number, h: number, x: number): number {
  for (let y = 0; y < h; y++) if (data[(y * w + x) * 4 + 3]! >= OPAQUE) return h - y;
  return 0;
}

/** In place on RGBA pixels: tapers each side whose edge column is opaque more than `minEdge` rows. */
export function taperCutEdges(data: Uint8ClampedArray, w: number, h: number, opts: { maxWidth?: number; minEdge?: number; step?: number } = {}): { left: boolean; right: boolean } {
  const maxWidth = opts.maxWidth ?? 48;
  const minEdge = opts.minEdge ?? 4;
  const step = Math.max(1, opts.step ?? 2);
  const out = { left: false, right: false };
  for (const side of ["left", "right"] as const) {
    const edgeX = side === "left" ? 0 : w - 1;
    const edgeH = columnHeight(data, w, h, edgeX);
    if (edgeH <= minEdge) continue;
    const t = Math.max(2, Math.min(maxWidth, Math.round(edgeH * 0.8), Math.floor(w / 4)));
    for (let d = 0; d < t; d++) {
      const x = side === "left" ? d : w - 1 - d;
      // Quarter ellipse from ~0 at the edge to the full column at distance t, in whole steps.
      const f = Math.sqrt(1 - (1 - (d + 0.5) / t) ** 2);
      const allowed = Math.floor((columnHeight(data, w, h, x) * f) / step) * step;
      for (let y = 0; y < h - allowed; y++) data[(y * w + x) * 4 + 3] = 0;
    }
    out[side] = true;
  }
  return out;
}
