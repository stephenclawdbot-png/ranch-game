/**
 * Per-horse recolouring of a keyed sprite strip (pure; works on RGBA arrays).
 *
 * The source strip (PixelLab or the code-drawn placeholder) uses exact key colours
 * listed in a palette file: { coat: [dark..light], mane: [...], silksPrimary: [...],
 * silksSecondary: [...], cap: [...] } (+ optional points / hoof). Each key ramp is
 * swapped for the horse's own ramp, preserving the shade index, and the silks
 * pattern is painted over the primary-key pixels.
 */
import { capPatternAt, paintRiderLook, prepareRider, resolveHorseColors } from "@thoroughbred/art-pipeline";
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
  /** The rider's skin keys (palette fixed.skin): faces are repainted per jockey. */
  skin?: string[];
  /** Women riders' hair (the -f strips' lime keys): the jockey's hair colour. */
  hair?: string[];
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
  const fixed = o.fixed && typeof o.fixed === "object" ? (o.fixed as Record<string, unknown>) : null;
  const skin = Array.isArray(fixed?.skin) && (fixed!.skin as unknown[]).every((c) => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c)) ? (fixed!.skin as string[]) : undefined;
  return { coat, mane: ramp("mane"), silksPrimary: ramp("silksPrimary"), silksSecondary: ramp("silksSecondary"), cap: ramp("cap"), points: ramp("points"), hoof: ramp("hoof"), skin, hair: ramp("hair") };
}

type Role = "coat" | "mane" | "silksPrimary" | "silksSecondary" | "cap" | "points" | "hoof" | "hair";

export interface RecolorPlan {
  /** packed source rgb -> packed target rgb */
  map: Map<number, number>;
  /** packed source rgb of silksPrimary keys -> shade index */
  primaryIndex: Map<number, number>;
  secondaryRamp: number[];
  pattern: SilkPattern;
  /** packed source rgb of cap keys -> shade index, and the cap pattern's secondary colours. */
  capIndex: Map<number, number>;
  capSecondary: number[];
  /** The rider's look (named jockeys): face and hair repainted after the recolour. */
  rider: HorseAppearance["rider"] | null;
  /** Packed keys a rider face may be drawn with (coat, mane, points, fixed skin). */
  riderFaceKeys: number[];
  /** The sprite's own skin keys (dark -> light). */
  riderSkinKeys: number[];
  capKeys: number[];
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
    // a woman rider's hair (the -f strips): the jockey's hair, else a dark brown
    hair: resampleRamp(appearance.rider ? [...appearance.rider.hair] : ["#1c110b", "#3d2618", "#66432c"], n(keys.hair)),
  };
}

export function buildRecolorPlan(keys: KeyPalette, appearance: HorseAppearance): RecolorPlan {
  const targets = targetRamps(keys, appearance);
  const map = new Map<number, number>();
  const primaryIndex = new Map<number, number>();
  const roles: Role[] = ["coat", "mane", "points", "hoof", "silksPrimary", "silksSecondary", "cap", "hair"];
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
  const capIndex = new Map<number, number>();
  const capKeys: number[] = [];
  (keys.cap ?? []).forEach((h, i) => {
    const [r, g, b] = hexToRgb(h);
    capIndex.set(packRgb(r, g, b), i);
    capKeys.push(packRgb(r, g, b));
  });
  const capSecondary = rampAround(appearance.silks.secondary, Math.max(1, keys.cap?.length ?? 1)).map((h) => {
    const [r, g, b] = hexToRgb(h);
    return packRgb(r, g, b);
  });
  const riderFaceKeys = [...(keys.coat ?? []), ...(keys.mane ?? []), ...(keys.points ?? []), ...(keys.skin ?? [])].map((h) => {
    const [r, g, b] = hexToRgb(h);
    return packRgb(r, g, b);
  });
  const riderSkinKeys = (keys.skin ?? []).map((h) => {
    const [r, g, b] = hexToRgb(h);
    return packRgb(r, g, b);
  });
  return { map, primaryIndex, secondaryRamp, pattern: appearance.silks.pattern, capIndex, capSecondary, rider: appearance.rider ?? null, riderFaceKeys, riderSkinKeys, capKeys };
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
  // the rider's face is found on the keyed source, before the coat recolour takes its keys
  const rider = plan.rider && plan.capKeys.length ? prepareRider(data, width, height, frameWidth, { cap: plan.capKeys, face: plan.riderFaceKeys, skin: plan.riderSkinKeys }) : null;
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
    const cap = rider?.caps[f] ?? (plan.pattern !== "solid" ? capBox(data, width, height, x0, frameWidth, plan.capIndex) : null);
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
        const ci = cap && plan.pattern !== "solid" ? plan.capIndex.get(key) : undefined;
        if (ci !== undefined && cap) {
          const u = (x - cap[0]) / Math.max(1, cap[2] - cap[0]);
          const v = (y - cap[1]) / Math.max(1, cap[3] - cap[1]);
          if (capPatternAt(plan.pattern, u, v)) out = plan.capSecondary[ci] ?? out;
        }
        data[i] = (out >> 16) & 255;
        data[i + 1] = (out >> 8) & 255;
        data[i + 2] = out & 255;
      }
    }
  }
  // women's strips carry their own hair (keyed above): no drawn ponytail on top
  if (rider && plan.rider) paintRiderLook(data, width, height, frameWidth, rider, plan.rider.gender === "f" ? { ...plan.rider, long: false } : plan.rider);
}

/** The cap's box in one frame (strip coordinates), or null. */
function capBox(data: Uint8ClampedArray, width: number, height: number, x0: number, frameWidth: number, capIndex: Map<number, number>): [number, number, number, number] | null {
  let a = Infinity,
    b = Infinity,
    c = -1,
    d = -1;
  for (let y = 0; y < height; y++) {
    for (let x = x0; x < x0 + frameWidth; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3]! < 8 || !capIndex.has(packRgb(data[i]!, data[i + 1]!, data[i + 2]!))) continue;
      if (x < a) a = x;
      if (x > c) c = x;
      if (y < b) b = y;
      if (y > d) d = y;
    }
  }
  return c < 0 ? null : [a, b, c, d];
}

/** Stable cache key for an appearance's recolour result. */
export function appearanceKey(a: HorseAppearance): string {
  const s = a.silks;
  return [a.coat, a.colour ? JSON.stringify(a.colour) : "", a.maneColor ?? "", s.primary, s.secondary, s.cap, s.pattern, a.rider ? JSON.stringify(a.rider) : "", a.face ?? "", (a.legs ?? []).join(","), a.dun ? "d" : "", a.feather ? "fe" : ""].join("|");
}
