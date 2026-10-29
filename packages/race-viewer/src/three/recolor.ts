/**
 * Per-horse recolouring of a keyed sprite strip (pure; works on RGBA arrays).
 *
 * The source strip (PixelLab or the code-drawn placeholder) uses exact key colours
 * listed in a palette file: { coat: [dark..light], mane: [...], silksPrimary: [...],
 * silksSecondary: [...], cap: [...] } (+ optional points / hoof). Each key ramp is
 * swapped for the horse's own ramp, preserving the shade index, and the silks
 * pattern is painted over the primary-key pixels.
 */
import { resolveHorseColors } from "@thoroughbred/art-pipeline";
import type { HorseAppearance, SilkPattern } from "@thoroughbred/shared";
import { hexToRgb, luminance, mixHex, packRgb, rampAround, resampleRamp } from "./color";

export interface KeyPalette {
  coat: string[];
  mane?: string[];
  silksPrimary?: string[];
  silksSecondary?: string[];
  cap?: string[];
  /** Lower legs; follow the coat's points colour. */
  points?: string[];
  hoof?: string[];
}

export function parseKeyPalette(v: unknown): KeyPalette | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const ramp = (k: string) => {
    const a = o[k];
    return Array.isArray(a) && a.every((c) => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c)) ? (a as string[]) : undefined;
  };
  const coat = ramp("coat");
  if (!coat || coat.length === 0) return null;
  return { coat, mane: ramp("mane"), silksPrimary: ramp("silksPrimary"), silksSecondary: ramp("silksSecondary"), cap: ramp("cap"), points: ramp("points"), hoof: ramp("hoof") };
}

type Role = "coat" | "mane" | "silksPrimary" | "silksSecondary" | "cap" | "points" | "hoof";

export interface RecolorPlan {
  /** packed source rgb -> packed target rgb */
  map: Map<number, number>;
  /** packed source rgb of silksPrimary keys -> shade index */
  primaryIndex: Map<number, number>;
  secondaryRamp: number[];
  pattern: SilkPattern;
}

/** Target ramps for one horse, matched in length to the key ramps. */
export function targetRamps(keys: KeyPalette, appearance: HorseAppearance): Record<Role, string[]> {
  const c = resolveHorseColors(appearance);
  const n = (k?: string[]) => k?.length ?? 0;
  const coat = resampleRamp([mixHex(c.shade, "#000000", 0.35), c.shade, c.body, c.highlight], n(keys.coat));
  const maneBase = c.mane;
  const mane = resampleRamp([mixHex(maneBase, "#000000", 0.35), maneBase, mixHex(maneBase, "#ffffff", 0.18)], n(keys.mane));
  const blackPoints = luminance(c.points) < luminance(c.body) * 0.55;
  const pointsBase = blackPoints ? c.points : c.body;
  const points = resampleRamp([mixHex(pointsBase, "#000000", 0.35), pointsBase, mixHex(pointsBase, "#ffffff", 0.12)], n(keys.points));
  const hoof = resampleRamp([mixHex(c.hoof, "#000000", 0.3), c.hoof], n(keys.hoof));
  return {
    coat,
    mane,
    points,
    hoof,
    silksPrimary: rampAround(c.silks.primary, n(keys.silksPrimary)),
    silksSecondary: rampAround(c.silks.secondary, n(keys.silksSecondary)),
    cap: rampAround(c.silks.cap, n(keys.cap)),
  };
}

export function buildRecolorPlan(keys: KeyPalette, appearance: HorseAppearance): RecolorPlan {
  const targets = targetRamps(keys, appearance);
  const map = new Map<number, number>();
  const primaryIndex = new Map<number, number>();
  const roles: Role[] = ["coat", "mane", "points", "hoof", "silksPrimary", "silksSecondary", "cap"];
  for (const role of roles) {
    const src = keys[role];
    if (!src) continue;
    src.forEach((h, i) => {
      const [r, g, b] = hexToRgb(h);
      const [tr, tg, tb] = hexToRgb(targets[role][i] ?? h);
      map.set(packRgb(r, g, b), packRgb(tr, tg, tb));
      if (role === "silksPrimary") primaryIndex.set(packRgb(r, g, b), i);
    });
  }
  const sec = targets.silksSecondary.length ? targets.silksSecondary : rampAround(appearance.silks.secondary, Math.max(1, keys.silksPrimary?.length ?? 1));
  // Secondary ramp must cover every primary shade index for the pattern.
  const secondaryRamp = resampleRamp(sec, Math.max(1, keys.silksPrimary?.length ?? sec.length)).map((h) => {
    const [r, g, b] = hexToRgb(h);
    return packRgb(r, g, b);
  });
  return { map, primaryIndex, secondaryRamp, pattern: appearance.silks.pattern };
}

/** Is local point (u, v) in [0,1]^2 of the silks bounding box painted in the secondary colour? */
export function patternHit(pattern: SilkPattern, u: number, v: number, px: number, py: number): boolean {
  switch (pattern) {
    case "hoops":
      return Math.floor(px / 3) % 2 === 1;
    case "stripes":
      return Math.floor(py / 2) % 2 === 1;
    case "quartered":
      return u < 0.5 !== v < 0.5;
    case "sash": {
      const d = u - v * 0.8;
      return d > 0.15 && d < 0.45;
    }
    case "chevron":
      return Math.floor((px + Math.abs(v - 0.5) * 10) / 3) % 2 === 1;
    case "diamonds":
      return (Math.abs((px % 6) - 3) + Math.abs((py % 6) - 3)) <= 1.5;
    case "stars":
      return px % 5 === 2 && py % 4 === 1;
    default:
      return false;
  }
}

/**
 * Recolour an RGBA strip in place. `frameWidth` lets the silks pattern be laid out
 * per frame (bounding box of the primary-key pixels in each frame).
 */
export function applyRecolor(data: Uint8ClampedArray, width: number, height: number, frameWidth: number, plan: RecolorPlan): void {
  const frames = Math.max(1, Math.floor(width / frameWidth));
  for (let f = 0; f < frames; f++) {
    const x0 = f * frameWidth;
    // Silks bounding box in this frame.
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    if (plan.pattern !== "solid" && plan.primaryIndex.size) {
      for (let y = 0; y < height; y++) {
        for (let x = x0; x < x0 + frameWidth; x++) {
          const i = (y * width + x) * 4;
          if (data[i + 3]! < 8) continue;
          if (plan.primaryIndex.has(packRgb(data[i]!, data[i + 1]!, data[i + 2]!))) {
            if (x < bx0) bx0 = x;
            if (x > bx1) bx1 = x;
            if (y < by0) by0 = y;
            if (y > by1) by1 = y;
          }
        }
      }
    }
    const bw = Math.max(1, bx1 - bx0 + 1);
    const bh = Math.max(1, by1 - by0 + 1);
    for (let y = 0; y < height; y++) {
      for (let x = x0; x < x0 + frameWidth; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3]! < 8) continue;
        const key = packRgb(data[i]!, data[i + 1]!, data[i + 2]!);
        let out = plan.map.get(key);
        if (out === undefined) continue;
        const pi = plan.primaryIndex.get(key);
        if (pi !== undefined && plan.pattern !== "solid" && bx1 >= bx0) {
          const u = (x - bx0) / bw;
          const v = (y - by0) / bh;
          if (patternHit(plan.pattern, u, v, x - bx0, y - by0)) out = plan.secondaryRamp[pi] ?? out;
        }
        data[i] = (out >> 16) & 255;
        data[i + 1] = (out >> 8) & 255;
        data[i + 2] = out & 255;
      }
    }
  }
}

/** Stable cache key for an appearance's recolour result. */
export function appearanceKey(a: HorseAppearance): string {
  const s = a.silks;
  return [a.coat, a.colour ? JSON.stringify(a.colour) : "", a.maneColor ?? "", s.primary, s.secondary, s.cap, s.pattern].join("|");
}
