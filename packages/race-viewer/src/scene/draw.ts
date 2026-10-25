import type { Graphics } from "pixi.js";

export type Pt = readonly [number, number];

/** Closed Catmull-Rom spline through points, emitted as cubic Beziers. */
export function smoothClosed(g: Graphics, pts: readonly Pt[], tension = 1): Graphics {
  const n = pts.length;
  const k = tension / 6;
  g.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const p3 = pts[(i + 2) % n]!;
    g.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) * k,
      p1[1] + (p2[1] - p0[1]) * k,
      p2[0] - (p3[0] - p1[0]) * k,
      p2[1] - (p3[1] - p1[1]) * k,
      p2[0],
      p2[1],
    );
  }
  return g.closePath();
}

/** Open Catmull-Rom spline (for strokes). */
export function smoothOpen(g: Graphics, pts: readonly Pt[], tension = 1): Graphics {
  const n = pts.length;
  const k = tension / 6;
  g.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(i + 2, n - 1)]!;
    g.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) * k,
      p1[1] + (p2[1] - p0[1]) * k,
      p2[0] - (p3[0] - p1[0]) * k,
      p2[1] - (p3[1] - p1[1]) * k,
      p2[0],
      p2[1],
    );
  }
  return g;
}

export const translatePts = (pts: readonly Pt[], dx: number, dy: number): Pt[] => pts.map(([x, y]) => [x + dx, y + dy]);

export function hex(c: string): number {
  return Number.parseInt(c.replace("#", ""), 16);
}

/** Linear mix of two 0xRRGGBB colours. */
export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const gg = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (gg << 8) | bl;
}

export const darken = (c: number, t: number): number => mix(c, 0x000000, t);
export const lighten = (c: number, t: number): number => mix(c, 0xffffff, t);

export function cssColor(c: number, a = 1): string {
  return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Deterministic PRNG for procedural scenery. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
