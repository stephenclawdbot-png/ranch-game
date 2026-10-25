/**
 * Per-horse look knobs on top of the shared part library (node-safe):
 *
 *  - variant slots: head / mane / tail / build can each hold N alternative parts in the atlas;
 *  - bone morphs: continuous proportions (leg length, neck length, girth, height, head size)
 *    applied to the skeleton at create time. Joints move and parts scale with nearest
 *    sampling (rows/columns repeat or drop), so the result stays pixel-crisp;
 *  - a seed for procedural markings (marking-edge jitter, sabino patches, dapple/roan layout).
 *
 * Every knob defaults deterministically from a hash of the appearance, so the same horse always
 * looks the same while two horses with the same coat still differ slightly.
 */
import type { HorseAppearance } from "@thoroughbred/shared";
import type { Skeleton, SkeletonPart } from "./gait";
import type { RigDef, Vec2 } from "./rigdef";

export const VARIANT_SLOTS = ["head", "mane", "tail", "build"] as const;
export type VariantSlot = (typeof VARIANT_SLOTS)[number];
export type VariantSelection = Partial<Record<VariantSlot, number>>;

export interface Morph {
  /** Cannon + forearm/gaskin length (body rises to keep the hooves on the ground). 0.85..1.15 */
  legLength: number;
  /** Neck length (head and mane carried out with it). 0.85..1.2 */
  neckLength: number;
  /** Barrel depth: belly drops / rises under a fixed top line. 0.88..1.15 */
  girth: number;
  /** Overall size of the horse about its ground point (jockey keeps its size). 0.9..1.08 */
  height: number;
  /** Head scale about the poll. 0.9..1.12 */
  headSize: number;
}

export const NEUTRAL_MORPH: Morph = { legLength: 1, neckLength: 1, girth: 1, height: 1, headSize: 1 };

export const MORPH_RANGE: Record<keyof Morph, [number, number]> = {
  legLength: [0.85, 1.15],
  neckLength: [0.85, 1.2],
  girth: [0.88, 1.15],
  height: [0.9, 1.08],
  headSize: [0.9, 1.12],
};

export interface HorseLookOptions {
  /** Starting gate (1..16); reserved for the saddle-cloth number. */
  gate?: number;
  /** Variant index per slot (wraps around the number of variants in the atlas). */
  variants?: VariantSelection;
  /** Body proportions; missing keys come from the appearance hash. */
  morph?: Partial<Morph>;
  /** Seed for procedural markings / patterns. Default: hash of the appearance. */
  seed?: number;
  /** Sabino (irregular white belly / leg / face patches), 0..1. Default 0. */
  sabino?: number;
}

export interface ResolvedLook {
  variants: Record<VariantSlot, number>;
  morph: Morph;
  seed: number;
  sabino: number;
}

/** FNV-1a 32-bit over a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable hash of everything visible in an appearance. */
export function hashAppearance(a: HorseAppearance): number {
  return hashString(JSON.stringify([a.coat, a.face, a.legs, a.maneColor ?? "", a.silks.primary, a.silks.secondary, a.silks.pattern, a.silks.cap]));
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** Quantise morph factors to 1/32 so the same horse never shimmers between nearby values. */
const q32 = (v: number) => Math.round(v * 32) / 32;

/**
 * Resolve the look knobs for one horse. `variantCounts` is how many variants each slot has in
 * the loaded atlas (indices wrap, so a genotype can carry any integer).
 */
export function resolveLook(appearance: HorseAppearance, opts: HorseLookOptions, variantCounts: Partial<Record<VariantSlot, number>>): ResolvedLook {
  const seed = (opts.seed ?? hashAppearance(appearance)) >>> 0;
  const r = rng(seed ^ 0x9e3779b9);
  const variants = {} as Record<VariantSlot, number>;
  for (const slot of VARIANT_SLOTS) {
    const n = Math.max(1, variantCounts[slot] ?? 1);
    const want = opts.variants?.[slot] ?? Math.floor(r() * n);
    variants[slot] = ((Math.round(want) % n) + n) % n;
  }
  // Default proportions: a gentle +-4% spread so a field of horses is not a row of clones.
  const jitter = () => 1 + (r() + r() - 1) * 0.04;
  const morph = {} as Morph;
  for (const k of Object.keys(NEUTRAL_MORPH) as (keyof Morph)[]) {
    const [lo, hi] = MORPH_RANGE[k];
    morph[k] = clamp(q32(opts.morph?.[k] ?? jitter()), lo, hi);
  }
  return { variants, morph, seed, sabino: clamp(opts.sabino ?? 0, 0, 1) };
}

/** Number of variants per slot present in a rig definition. */
export function countVariants(def: RigDef): Record<VariantSlot, number> {
  const out = { head: 1, mane: 1, tail: 1, build: 1 } as Record<VariantSlot, number>;
  for (const p of def.parts) {
    if (p.slot && (VARIANT_SLOTS as readonly string[]).includes(p.slot)) {
      const s = p.slot as VariantSlot;
      out[s] = Math.max(out[s], (p.variant ?? 0) + 1);
    }
  }
  return out;
}

/**
 * The bone list shared by every horse of a rig definition: one bone per distinct part name
 * (variants of a slot share their bones), in draw order of first appearance, plus the rein.
 */
export function boneNames(def: RigDef): string[] {
  const names: string[] = [];
  for (const p of def.parts) if (!names.includes(p.name)) names.push(p.name);
  names.push("rein");
  return names;
}

/** Skeleton for one horse: bones from `boneNames`, pivots from the selected variants. */
export function selectSkeleton(def: RigDef, variants: Record<VariantSlot, number>): Skeleton {
  const parts: SkeletonPart[] = boneNames(def).map((name) => {
    if (name === "rein") return { name, pivot: def.joints.hand ?? [86, 29.5], parent: "jArmNear", side: "near" as const };
    const cands = def.parts.filter((p) => p.name === name);
    const pick =
      cands.find((p) => !p.slot || (p.variant ?? 0) === variants[p.slot as VariantSlot]) ??
      cands.find((p) => (p.variant ?? 0) === 0) ??
      cands[0]!;
    // far-side limbs read a touch slimmer (perspective + shadow)
    const slim = pick.side === "far" && /^(fore|hind)Far(Upper|Lower)$/.test(name);
    return { name, pivot: [...pick.pivot] as Vec2, parent: pick.parent, side: pick.side, copyOf: pick.copyOf, scale: (slim ? [0.8, 1] : [1, 1]) as Vec2 };
  });
  return { parts, joints: Object.fromEntries(Object.entries(def.joints).map(([k, v]) => [k, [...v] as Vec2])), groundY: def.groundY };
}

const isJockey = (n: string) => n.startsWith("j");
const JOCKEY_JOINTS = new Set(["jKnee", "jAnkle", "jShoulder", "jNeck", "saddle"]);

/**
 * Apply proportions to a skeleton (returns a new one). Joints move; parts gain a local
 * `scale` that the renderer applies with nearest sampling.
 */
export function morphSkeleton(skel: Skeleton, m: Morph): Skeleton {
  const parts = skel.parts.map((p) => ({ ...p, pivot: [...p.pivot] as Vec2, scale: [...(p.scale ?? [1, 1])] as Vec2 }));
  const joints = Object.fromEntries(Object.entries(skel.joints).map(([k, v]) => [k, [...v] as Vec2])) as Record<string, Vec2>;
  const P = (n: string) => parts.find((p) => p.name === n);
  type Pt = { get: () => Vec2; set: (v: Vec2) => void };
  const partPt = (n: string): Pt | null => {
    const p = P(n);
    return p ? { get: () => p.pivot, set: (v) => (p.pivot = v) } : null;
  };
  const jointPt = (n: string): Pt | null => (joints[n] ? { get: () => joints[n]!, set: (v) => (joints[n] = v) } : null);
  const each = (names: string[], jnames: string[], fn: (v: Vec2) => Vec2) => {
    for (const n of names) {
      const pt = partPt(n);
      if (pt) pt.set(fn(pt.get()));
    }
    for (const n of jnames) {
      const pt = jointPt(n);
      if (pt) pt.set(fn(pt.get()));
    }
  };
  const scalePart = (n: string, sx: number, sy: number) => {
    const p = P(n);
    if (p) p.scale = [p.scale[0] * sx, p.scale[1] * sy];
  };
  /** move every jockey bone / joint rigidly with the saddle under `fn` */
  const carryJockey = (fn: (v: Vec2) => Vec2) => {
    const s = joints.saddle ?? P("barrel")!.pivot;
    const s2 = fn(s);
    const d: Vec2 = [s2[0] - s[0], s2[1] - s[1]];
    const mv = (v: Vec2): Vec2 => [v[0] + d[0], v[1] + d[1]];
    each(
      parts.filter((p) => isJockey(p.name)).map((p) => p.name),
      [...JOCKEY_JOINTS],
      mv,
    );
  };
  const about = (c: Vec2, sx: number, sy: number) => (v: Vec2): Vec2 => [c[0] + (v[0] - c[0]) * sx, c[1] + (v[1] - c[1]) * sy];

  // 1. head size, about the poll (head pivot); the bit rides along.
  const head = P("head");
  if (head && m.headSize !== 1) {
    scalePart("head", m.headSize, m.headSize);
    each([], ["bit"], about(head.pivot, m.headSize, m.headSize));
  }
  // 2. neck length, about the neck base; head, mane and the rein contact ride along.
  const neck = P("neck");
  if (neck && m.neckLength !== 1) {
    const f = about([...neck.pivot] as Vec2, m.neckLength, m.neckLength);
    scalePart("neck", m.neckLength, m.neckLength);
    scalePart("mane", m.neckLength, m.neckLength);
    each(["head", "mane"], ["bit", "hand"], f);
  }
  // 3. girth: body masses stretch down from the top line; leg roots + stirrup follow.
  const barrel = P("barrel");
  if (barrel && m.girth !== 1) {
    const top = (joints.saddle?.[1] ?? barrel.pivot[1] - 9) - 1;
    const f = (v: Vec2): Vec2 => [v[0], top + (v[1] - top) * m.girth];
    for (const n of ["barrel", "chest", "hindquarter"]) scalePart(n, 1, m.girth);
    each(
      ["barrel", "chest", "hindquarter", ...parts.filter((p) => /Upper$/.test(p.name) && !isJockey(p.name)).map((p) => p.name)],
      ["jAnkle"],
      f,
    );
  }
  // 4. leg length: segments stretch from their roots; then the whole horse rises so the
  //    hooves stay on the ground line.
  if (m.legLength !== 1) {
    let lift = 0;
    let count = 0;
    for (const pre of ["foreNear", "foreFar", "hindNear", "hindFar"]) {
      const up = P(`${pre}Upper`);
      const lo = P(`${pre}Lower`);
      const hf = P(`${pre}Hoof`);
      if (!up || !lo || !hf) continue;
      const root = up.pivot;
      const f = about(root, 1, m.legLength);
      const before = hf.pivot[1];
      lo.pivot = f(lo.pivot);
      hf.pivot = f(hf.pivot);
      up.scale = [up.scale[0], up.scale[1] * m.legLength];
      lo.scale = [lo.scale[0], lo.scale[1] * m.legLength];
      lift += hf.pivot[1] - before;
      count++;
    }
    const dy = count ? lift / count : 0;
    for (const p of parts) if (p.name !== "rein") p.pivot = [p.pivot[0], p.pivot[1] - dy];
    for (const k of Object.keys(joints)) joints[k] = [joints[k]![0], joints[k]![1] - dy];
  }
  // 5. overall size about the ground point under the barrel; the jockey keeps its size.
  if (m.height !== 1 && barrel) {
    const c: Vec2 = [barrel.pivot[0], skel.groundY];
    const f = about(c, m.height, m.height);
    carryJockey(f);
    for (const p of parts) {
      if (isJockey(p.name) || p.name === "rein") continue;
      p.pivot = f(p.pivot);
      p.scale = [p.scale[0] * m.height, p.scale[1] * m.height];
    }
    each([], ["bit", "hand", "foreKnee", "hindHock", "foreFetlock", "hindFetlock"], f);
  }
  return { parts, joints, groundY: skel.groundY };
}
