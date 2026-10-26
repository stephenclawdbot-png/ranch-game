/**
 * Coat + silks recolouring for keyed horse strips (pure; works on RGBA arrays, no DOM).
 *
 * The keyed strips (race/horse-gallop, diorama/horse-canter, diorama/horse-walk-jockey and
 * their 2:1 copies) all use the exact key colours listed in race/palette.json. Each key ramp is
 * swapped for the horse's ramp at the same shade index, so pixels stay hard-edged palette art.
 */
import { COAT_PALETTES } from "@thoroughbred/art-pipeline";
import type { Coat } from "@thoroughbred/shared";
import PALETTE from "../../../public/art/race/palette.json";

const KEYS = PALETTE as unknown as Record<"coat" | "mane" | "points" | "silksPrimary" | "silksSecondary" | "cap", string[]>;

export interface DioramaHorseLook {
  coat: Coat;
  /** Silks body, sleeves and cap (hex). */
  silks?: [primary: string, secondary: string, cap: string];
}

type RGB = [number, number, number];

export function hexToRgb(h: string): RGB {
  const n = Number.parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const pack = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Resample dark->light stops to exactly n colours. */
export function ramp(stops: RGB[], n: number): RGB[] {
  if (n <= 0) return [];
  if (stops.length === 1 || n === 1) return Array.from({ length: n }, (_, i) => stops[Math.min(i, stops.length - 1)]!);
  const out: RGB[] = [];
  for (let i = 0; i < n; i++) {
    const f = (i / (n - 1)) * (stops.length - 1);
    const k = Math.min(Math.floor(f), stops.length - 2);
    out.push(mix(stops[k]!, stops[k + 1]!, f - k).map(Math.round) as RGB);
  }
  return out;
}

const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [255, 255, 255];
const around = (hex: string, n: number) => {
  const c = hexToRgb(hex);
  return ramp([mix(c, BLACK, 0.42), mix(c, BLACK, 0.2), c, mix(c, WHITE, 0.22)], n);
};

/** packed key rgb -> packed target rgb for one horse. */
export function recolorMap(look: DioramaHorseLook): Map<number, number> {
  const p = COAT_PALETTES[look.coat] ?? COAT_PALETTES.bay;
  const [shade, body, hi] = [hexToRgb(p.shade), hexToRgb(p.body), hexToRgb(p.highlight)];
  const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const mane = hexToRgb(p.mane);
  const blackPoints = lum(hexToRgb(p.points)) < lum(body) * 0.55;
  const pts = blackPoints ? hexToRgb(p.points) : body;
  const targets: Record<string, RGB[]> = {
    coat: ramp([mix(shade, BLACK, 0.35), shade, body, hi], KEYS.coat.length),
    mane: ramp([mix(mane, BLACK, 0.35), mane, mix(mane, WHITE, 0.18)], KEYS.mane.length),
    points: ramp([mix(pts, BLACK, 0.35), pts, mix(pts, WHITE, 0.12)], KEYS.points.length),
  };
  if (look.silks) {
    targets.silksPrimary = around(look.silks[0], KEYS.silksPrimary.length);
    targets.silksSecondary = around(look.silks[1], KEYS.silksSecondary.length);
    targets.cap = around(look.silks[2], KEYS.cap.length);
  }
  const map = new Map<number, number>();
  for (const role of Object.keys(targets) as (keyof typeof KEYS)[]) {
    const src = KEYS[role];
    src.forEach((h, i) => {
      const [r, g, b] = hexToRgb(h);
      const t = targets[role]![i]!;
      map.set(pack(r, g, b), pack(t[0], t[1], t[2]));
    });
  }
  return map;
}

/** Recolour RGBA pixels in place. */
export function applyRecolor(data: Uint8ClampedArray, map: Map<number, number>): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 8) continue;
    const out = map.get(pack(data[i]!, data[i + 1]!, data[i + 2]!));
    if (out === undefined) continue;
    data[i] = (out >> 16) & 255;
    data[i + 1] = (out >> 8) & 255;
    data[i + 2] = out & 255;
  }
}

export const lookKey = (l: DioramaHorseLook) => `${l.coat}|${l.silks?.join(",") ?? ""}`;
