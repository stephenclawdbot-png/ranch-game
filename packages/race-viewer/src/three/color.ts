/** Tiny colour helpers shared by the pixel painters (pure). */
export type RGB = [number, number, number];

export function hexToRgb(h: string): RGB {
  const n = Number.parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  return `#${((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1)}`;
}

export function packRgb(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function mixHex(a: string, b: string, t: number): string {
  return rgbToHex(mixRgb(hexToRgb(a), hexToRgb(b), t).map(Math.round) as RGB);
}

/** Resample a dark->light ramp of stops to exactly `n` colours. */
export function resampleRamp(stops: string[], n: number): string[] {
  if (n <= 0) return [];
  if (stops.length === 1 || n === 1) return Array.from({ length: n }, (_, i) => stops[Math.min(i, stops.length - 1)]!);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const f = (i / (n - 1)) * (stops.length - 1);
    const k = Math.min(Math.floor(f), stops.length - 2);
    out.push(mixHex(stops[k]!, stops[k + 1]!, f - k));
  }
  return out;
}

/** dark->light ramp around one base colour (for silks). */
export function rampAround(base: string, n: number): string[] {
  return resampleRamp([mixHex(base, "#000000", 0.42), mixHex(base, "#000000", 0.2), base, mixHex(base, "#ffffff", 0.22)], n);
}

export function luminance(h: string): number {
  const [r, g, b] = hexToRgb(h);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Deterministic PRNG (mulberry32). */
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

/** 4x4 Bayer threshold in [0,1). */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function bayer(x: number, y: number): number {
  return (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;
}
