/**
 * Coat + silks recolouring for keyed horse strips (pure; works on RGBA arrays, no DOM).
 *
 * The keyed strips (race/horse-gallop, diorama/horse-canter, diorama/horse-walk-jockey and
 * their 2:1 copies) all use the exact key colours listed in race/palette.json. Each key ramp is
 * swapped for the horse's ramp at the same shade index, so pixels stay hard-edged palette art.
 */
import { COAT_PALETTES, capPatternAt, jerseyPatternAt, paintRiderLook, prepareRider, resolveHorseColors, type CoatPalette } from "@thoroughbred/art-pipeline";
import type { Coat, HorseAppearance } from "@thoroughbred/shared";
import PALETTE from "../../../public/art/race/palette.json";

const KEYS = PALETTE as unknown as Record<"coat" | "mane" | "points" | "silksPrimary" | "silksSecondary" | "cap" | "hair", string[]>;

export interface DioramaHorseLook {
  coat: Coat;
  /** Silks body, sleeves and cap (hex). */
  silks?: [primary: string, secondary: string, cap: string];
  /** Full appearance (coat v2 layered colours); drives the palette when present. */
  appearance?: HorseAppearance;
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
  const p: CoatPalette = look.appearance ? resolveHorseColors(look.appearance) : (COAT_PALETTES[look.coat] ?? COAT_PALETTES.bay);
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
  const silks: [string, string, string] | undefined =
    look.silks ?? (look.appearance ? [look.appearance.silks.primary, look.appearance.silks.secondary, look.appearance.silks.cap] : undefined);
  if (silks) {
    targets.silksPrimary = around(silks[0], KEYS.silksPrimary.length);
    targets.silksSecondary = around(silks[1], KEYS.silksSecondary.length);
    targets.cap = around(silks[2], KEYS.cap.length);
  }
  // a woman rider's hair (the -f strips' lime keys): the jockey's hair colour
  if (KEYS.hair?.length) targets.hair = ramp((look.appearance?.rider?.hair ?? ["#1c110b", "#3d2618", "#66432c"]).map(hexToRgb), KEYS.hair.length);
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

export const lookKey = (l: DioramaHorseLook) =>
  `${l.coat}|${l.silks?.join(",") ?? ""}|${l.appearance ? JSON.stringify([l.appearance.colour, l.appearance.maneColor, l.appearance.dun, l.appearance.silks.pattern, l.appearance.rider ?? null]) : ""}`;

const packHex = (h: string) => {
  const [r, g, b] = hexToRgb(h);
  return pack(r, g, b);
};
const PRIMARY = KEYS.silksPrimary.map(packHex);
const CAP = KEYS.cap.map(packHex);
const SKIN_KEYS = ((PALETTE as unknown as { fixed: { skin: string[] } }).fixed.skin ?? []).map(packHex);
const FACE_KEYS = [...KEYS.coat, ...KEYS.mane, ...KEYS.points].map(packHex).concat(SKIN_KEYS);

/**
 * Recolour a keyed rider strip (frames side by side) for one runner: coat and silks as
 * recolorMap, plus what makes the rider theirs (jockey looks): the silks pattern on the jacket
 * (the 16x13 jersey grid the stable's silks icon uses, over the jacket's box per frame), the cap
 * pattern, and the jockey's skin and hair (art-pipeline riderLook). `facingLeft` for mirrored strips.
 */
export function applyRiderLook(data: Uint8ClampedArray, width: number, height: number, frameWidth: number, look: DioramaHorseLook, facingLeft = false): void {
  const a = look.appearance;
  const rider = a?.rider ? prepareRider(data, width, height, frameWidth, { cap: CAP, face: FACE_KEYS, skin: SKIN_KEYS }) : null;
  const pattern = a?.silks.pattern ?? "solid";
  const map = recolorMap(look);
  const sec = a ? around(a.silks.secondary, KEYS.silksPrimary.length).map((c) => pack(c[0], c[1], c[2])) : [];
  const capSec = a ? around(a.silks.secondary, KEYS.cap.length).map((c) => pack(c[0], c[1], c[2])) : [];
  const frames = Math.max(1, Math.floor(width / frameWidth));
  for (let f = 0; f < frames; f++) {
    const fx = f * frameWidth;
    const box = (keys: number[]) => {
      let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
      for (let y = 0; y < height; y++)
        for (let x = fx; x < fx + frameWidth; x++) {
          const i = (y * width + x) * 4;
          if (data[i + 3]! < 8 || !keys.includes(pack(data[i]!, data[i + 1]!, data[i + 2]!))) continue;
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
      return x1 < 0 ? null : ([x0, y0, x1, y1] as const);
    };
    const body = pattern !== "solid" ? box(PRIMARY) : null;
    const cap = pattern !== "solid" ? box(CAP) : null;
    for (let y = 0; y < height; y++) {
      for (let x = fx; x < fx + frameWidth; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3]! < 8) continue;
        const k = pack(data[i]!, data[i + 1]!, data[i + 2]!);
        let out = map.get(k);
        if (out === undefined) continue;
        const pi = body ? PRIMARY.indexOf(k) : -1;
        if (pi >= 0 && body) {
          // mirrored strips mirror the pattern too, so a sash still runs the same way on the jacket
          const u = facingLeft ? body[2] - x : x - body[0];
          if (jerseyPatternAt(pattern, Math.floor((u * 16) / (body[2] - body[0] + 1)), Math.floor(((y - body[1]) * 13) / (body[3] - body[1] + 1)))) out = sec[pi] ?? out;
        }
        const ci = cap ? CAP.indexOf(k) : -1;
        if (ci >= 0 && cap) {
          const u = (facingLeft ? cap[2] - x : x - cap[0]) / Math.max(1, cap[2] - cap[0]);
          if (capPatternAt(pattern, u, (y - cap[1]) / Math.max(1, cap[3] - cap[1]))) out = capSec[ci] ?? out;
        }
        data[i] = (out >> 16) & 255;
        data[i + 1] = (out >> 8) & 255;
        data[i + 2] = out & 255;
      }
    }
  }
  // women's strips carry their own hair (keyed above): no drawn ponytail on top
  if (rider && a?.rider) paintRiderLook(data, width, height, frameWidth, rider, a.rider.gender === "f" ? { ...a.rider, long: false } : a.rider, { facingLeft });
}
