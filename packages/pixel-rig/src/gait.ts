/**
 * Code-driven skeletal gait for the pixel rig (pure math, node-safe, deterministic).
 *
 * Space: source pixels, x right (the horse faces +x), y DOWN. Angles are in radians; a positive
 * angle turns clockwise on screen (x' = c x - s y, y' = s x + c y).
 *
 * Leg naming: the horse's right side faces the viewer, so the near legs are the right legs
 * (RF = foreNear, RH = hindNear) and the far legs are the left legs (LF, LH). The gallop is a
 * right-lead transverse gallop: LH -> RH -> LF -> RF, then one gathered suspension.
 */
import type { Vec2 } from "./rigdef";

export type LegId = "LH" | "RH" | "LF" | "RF";
export const LEGS: readonly LegId[] = ["LH", "RH", "LF", "RF"];

export interface GaitPreset {
  /** Stride fraction at which each hoof touches down. */
  touchdown: Record<LegId, number>;
  /** Fraction of the stride each hoof is on the ground. */
  duty: number;
  /** Half the hoof sweep relative to the body [hind, fore], px. */
  reach: [number, number];
  /** Peak hoof lift in swing [hind, fore], px. */
  lift: [number, number];
  /** Vertical body bob amplitude, px. */
  bob: number;
  /** Fore/aft rock, px of vertical offset per px from the barrel pivot (~radians). */
  pitch: number;
  /** Neck angle offset (+ = head lower / further forward) and nod amplitude, rad. */
  neckBase: number;
  neckNod: number;
  /** Head angle relative to the neck (- = nose up / out). */
  headBase: number;
  /** Tail lift (+ = streams back), rad, and swing amplitude. */
  tailBase: number;
  tailSwing: number;
  /** How far the body is lowered in the gait (px). */
  crouch: number;
  /** Standing offsets of each hoof (px, + forward) so the legs do not stack up when still. */
  stand?: Partial<Record<LegId, number>>;
}

export const IDLE: GaitPreset = {
  touchdown: { LH: 0, RH: 0, LF: 0, RF: 0 },
  duty: 1,
  reach: [0, 0],
  lift: [0, 0],
  bob: 0,
  pitch: 0,
  neckBase: 0,
  neckNod: 0,
  headBase: 0,
  tailBase: 0.05,
  tailSwing: 0.05,
  crouch: 0,
  stand: { LF: -2, RF: 1, LH: 3, RH: -1 },
};

export const WALK: GaitPreset = {
  touchdown: { LH: 0, LF: 0.25, RH: 0.5, RF: 0.75 },
  duty: 0.62,
  reach: [4.5, 4.5],
  lift: [3, 4],
  bob: 0.6,
  pitch: 0.008,
  neckBase: 0.05,
  neckNod: 0.06,
  headBase: 0,
  tailBase: 0.1,
  tailSwing: 0.08,
  crouch: 0,
};

export const CANTER: GaitPreset = {
  touchdown: { LH: 0, RH: 0.27, LF: 0.27, RF: 0.5 },
  duty: 0.4,
  reach: [8, 8],
  lift: [7, 10],
  bob: 1.4,
  pitch: 0.035,
  neckBase: 0.12,
  neckNod: 0.1,
  headBase: -0.1,
  tailBase: 0.65,
  tailSwing: 0.16,
  crouch: 1,
};

export const GALLOP: GaitPreset = {
  touchdown: { LH: 0, RH: 0.11, LF: 0.33, RF: 0.44 },
  duty: 0.27,
  reach: [11, 10],
  lift: [9, 13],
  bob: 1.6,
  pitch: 0.05,
  neckBase: 0.24,
  neckNod: 0.11,
  headBase: -0.2,
  tailBase: 0.95,
  tailSwing: 0.14,
  crouch: 2,
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const fract = (x: number) => x - Math.floor(x);

function mixPreset(a: GaitPreset, b: GaitPreset, t: number): GaitPreset {
  const m = (x: number, y: number) => lerp(x, y, t);
  return {
    touchdown: { LH: m(a.touchdown.LH, b.touchdown.LH), RH: m(a.touchdown.RH, b.touchdown.RH), LF: m(a.touchdown.LF, b.touchdown.LF), RF: m(a.touchdown.RF, b.touchdown.RF) },
    duty: m(a.duty, b.duty),
    reach: [m(a.reach[0], b.reach[0]), m(a.reach[1], b.reach[1])],
    lift: [m(a.lift[0], b.lift[0]), m(a.lift[1], b.lift[1])],
    bob: m(a.bob, b.bob),
    pitch: m(a.pitch, b.pitch),
    neckBase: m(a.neckBase, b.neckBase),
    neckNod: m(a.neckNod, b.neckNod),
    headBase: m(a.headBase, b.headBase),
    tailBase: m(a.tailBase, b.tailBase),
    tailSwing: m(a.tailSwing, b.tailSwing),
    crouch: m(a.crouch, b.crouch),
    stand: Object.fromEntries(LEGS.map((l) => [l, m(a.stand?.[l] ?? 0, b.stand?.[l] ?? 0)])),
  };
}

/** Gait parameters for a ground speed (m/s): idle -> walk -> canter -> gallop, stride extends with speed. */
export function gaitForSpeed(speedMs: number): GaitPreset {
  const v = Math.max(0, speedMs);
  if (v < 0.35) return IDLE;
  if (v < 1.2) return mixPreset(IDLE, WALK, smoothstep(0.35, 1.2, v));
  if (v < 3) return WALK;
  if (v < 6) return mixPreset(WALK, CANTER, smoothstep(3, 6, v));
  if (v < 9) return CANTER;
  if (v < 13) return mixPreset(CANTER, GALLOP, smoothstep(9, 13, v));
  // Full gallop: stride lengthens and the stance shortens as speed climbs.
  const e = clamp((v - 13) / 6, 0, 1);
  return {
    ...GALLOP,
    reach: [GALLOP.reach[0] * (1 + 0.12 * e), GALLOP.reach[1] * (1 + 0.12 * e)],
    duty: GALLOP.duty - 0.03 * e,
    neckBase: GALLOP.neckBase + 0.05 * e,
  };
}

/**
 * Strides per second for a ground speed (m/s): walk ~0.9 Hz, canter ~1.8 Hz, racing gallop
 * ~2.3-2.4 Hz. Viewers advance `phase += strideFrequency(speed) * dt` (or distance / stride).
 */
export function strideFrequency(speedMs: number): number {
  const v = Math.max(0, speedMs);
  if (v < 2) return 0.9;
  if (v < 8) return lerp(0.9, 1.8, (v - 2) / 6);
  return lerp(1.8, 2.4, clamp((v - 8) / 10, 0, 1));
}

/** Stride length (m) implied by `strideFrequency`. */
export function strideLength(speedMs: number): number {
  return Math.max(0.5, speedMs / strideFrequency(speedMs));
}

export interface LegSample {
  /** true while the hoof is on the ground. */
  stance: boolean;
  /** 0..1 progress through the current stance or swing. */
  t: number;
  /** Hoof offset from its neutral spot: x (+ forward), y (- = lifted), px. */
  x: number;
  y: number;
}

/** Where a hoof is at stride `phase` (0..1). Periodic with period 1. */
export function sampleLeg(g: GaitPreset, leg: LegId, phase: number): LegSample {
  const fore = leg === "LF" || leg === "RF" ? 1 : 0;
  const reach = g.reach[fore];
  const lift = g.lift[fore];
  const u = fract(phase - g.touchdown[leg]);
  if (u < g.duty || g.duty >= 1) {
    const s = g.duty >= 1 ? 0.5 : u / g.duty;
    return { stance: true, t: s, x: reach * (1 - 2 * s) + (g.stand?.[leg] ?? 0), y: 0 };
  }
  const w = (u - g.duty) / (1 - g.duty);
  // Swing: the hoof folds up behind first (fore legs tuck hard), then reaches forward and drops.
  const over = reach * 0.22;
  const fwd = smoothstep(fore ? 0.18 : 0.08, 0.82, w);
  const x = -reach + (2 * reach + over) * fwd - over * smoothstep(0.82, 1, w) + (g.stand?.[leg] ?? 0);
  const peak = fore ? 0.38 : 0.45;
  const k = Math.log(0.5) / Math.log(peak);
  const y = -lift * Math.sin(Math.PI * Math.pow(w, k));
  return { stance: false, t: w, x, y };
}

/** Two-bone IK in the plane. Returns the middle joint. `bend` +1 / -1 picks the side. */
export function solveTwoBone(a: Vec2, target: Vec2, l1: number, l2: number, bend: 1 | -1): { mid: Vec2; end: Vec2 } {
  const dx = target[0] - a[0];
  const dy = target[1] - a[1];
  const dRaw = Math.hypot(dx, dy) || 1e-6;
  const d = clamp(dRaw, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const ux = dx / dRaw;
  const uy = dy / dRaw;
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const ang = Math.acos(cosA) * bend;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const mx = a[0] + (ux * c - uy * s) * l1;
  const my = a[1] + (ux * s + uy * c) * l1;
  return { mid: [mx, my], end: [a[0] + ux * d, a[1] + uy * d] };
}

// ---------------------------------------------------------------------------------------------
// Skeleton + pose
// ---------------------------------------------------------------------------------------------

export interface SkeletonPart {
  name: string;
  pivot: Vec2;
  parent: string | null;
  side: "near" | "far";
  copyOf?: string;
  /** Local part scale from bone morphs (default [1, 1]). */
  scale?: Vec2;
}

export interface Skeleton {
  /** Source pixels per base pixel: gait distances (reach, lift, bob...) scale with it. */
  unit?: number;
  parts: SkeletonPart[];
  joints: Record<string, Vec2>;
  groundY: number;
}

/** Per-part world transform: 2x2 matrix (y-down) + translation of the part's pivot. */
export interface Pose {
  /** [m00, m01, m10, m11, tx, ty] per part, in skeleton part order. */
  m: Float32Array;
}

/** Spring state for secondary motion (mane, tail, jockey). One per rig instance. */
export interface SecondaryState {
  lastTime: number;
  tail: number;
  tailV: number;
  tip: number;
  tipV: number;
  mane: number;
  maneV: number;
}

export function createSecondaryState(): SecondaryState {
  return { lastTime: Number.NaN, tail: 0, tailV: 0, tip: 0, tipV: 0, mane: 0, maneV: 0 };
}

export interface PoseInput {
  phase: number;
  speedMs: number;
  drive: number;
  time: number;
}

export interface PoseOptions {
  /** Snap translations to whole pixels and quantise angles (pixel integrity). Default true. */
  snap?: boolean;
  /** Angle quantum in radians (default 2*pi/96, 3.75 deg). */
  angleStep?: number;
}

type Leg = {
  id: LegId;
  upper: number;
  lower: number;
  hoof: number;
  fore: boolean;
  l1: number;
  l2: number;
  rest1: number;
  rest2: number;
  /** rest offset of the shoulder/stifle from the body part pivot */
  rootOff: Vec2;
  body: "chest" | "hindquarter";
  /** neutral coronet position relative to the root joint, at rest */
  neutral: Vec2;
};

/** Precomputed rest data for a skeleton; build once, reuse every frame. */
export class GaitRig {
  readonly n: number;
  readonly index: Map<string, number>;
  private readonly piv: Vec2[];
  private readonly legs: Leg[];
  private readonly j: Record<string, Vec2>;
  private readonly fracs: Vec2[];
  /** parts that may rotate (others only translate, so big body parts never shimmer) */
  private readonly rotates: boolean[];

  constructor(readonly skel: Skeleton) {
    this.n = skel.parts.length;
    this.index = new Map(skel.parts.map((p, i) => [p.name, i]));
    this.piv = skel.parts.map((p) => p.pivot);
    this.j = skel.joints;
    this.fracs = skel.parts.map((p) => [p.pivot[0] - Math.floor(p.pivot[0]), p.pivot[1] - Math.floor(p.pivot[1])]);
    const still = new Set(["barrel", "chest", "hindquarter"]);
    this.rotates = skel.parts.map((p) => !still.has(p.name));
    const mk = (id: LegId, pre: string, fore: boolean): Leg => {
      const u = this.req(`${pre}Upper`);
      const l = this.req(`${pre}Lower`);
      const h = this.req(`${pre}Hoof`);
      const a = this.piv[u]!;
      const b = this.piv[l]!;
      const c = this.piv[h]!;
      const body = fore ? "chest" : "hindquarter";
      const bp = this.piv[this.req(body)]!;
      return {
        id,
        upper: u,
        lower: l,
        hoof: h,
        fore,
        l1: Math.hypot(b[0] - a[0], b[1] - a[1]),
        l2: Math.hypot(c[0] - b[0], c[1] - b[1]),
        rest1: Math.atan2(b[1] - a[1], b[0] - a[0]),
        rest2: Math.atan2(c[1] - b[1], c[0] - b[0]),
        rootOff: [a[0] - bp[0], a[1] - bp[1]],
        body,
        neutral: [c[0] - a[0] + (fore ? 0.5 : 2), c[1] - a[1]],
      };
    };
    this.legs = [mk("RF", "foreNear", true), mk("LF", "foreFar", true), mk("RH", "hindNear", false), mk("LH", "hindFar", false)];
  }

  private req(name: string): number {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`pixel-rig: skeleton is missing part "${name}"`);
    return i;
  }

  private opt(name: string): number {
    return this.index.get(name) ?? -1;
  }

  createPose(): Pose {
    return { m: new Float32Array(this.n * 6) };
  }

  /**
   * Compute every part's world transform for one moment. Writes into `pose` and returns it.
   * Deterministic for a given input sequence (secondary springs integrate `time`).
   */
  compute(input: PoseInput, sec: SecondaryState, pose: Pose = this.createPose(), opts: PoseOptions = {}): Pose {
    const snap = opts.snap ?? true;
    const U = this.skel.unit ?? 1;
    const step = opts.angleStep ?? (2 * Math.PI) / (96 * U);
    const g = gaitForSpeed(input.speedMs);
    const phase = fract(input.phase);
    const drive = clamp(input.drive, 0, 1);
    const TAU = Math.PI * 2;
    const speedK = clamp(input.speedMs / 16, 0, 1.2);
    const moving = g.duty < 1;

    // --- body: bob + rock applied as translations (no rotation of the big masses) ----------
    const breathe = moving ? 0 : 0.5 * U * Math.sin(input.time * 1.7);
    const bob = moving ? (-g.bob * Math.cos(TAU * (phase - 0.82)) + g.crouch) * U : breathe * 0.6;
    const pitch = g.pitch * Math.cos(TAU * (phase - 0.5)); // + = forehand down
    const surge = moving ? 0.5 * g.bob * U * Math.sin(TAU * (phase - 0.3)) : 0;

    const M = pose.m;
    const set = (i: number, ang: number, tx: number, ty: number, sx: number, sy: number) => {
      if (i < 0) return;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const o = i * 6;
      M[o] = c * sx;
      M[o + 1] = -s * sy;
      M[o + 2] = s * sx;
      M[o + 3] = c * sy;
      M[o + 4] = tx;
      M[o + 5] = ty;
    };
    const wpos: Vec2[] = new Array(this.n);
    const wang: number[] = new Array(this.n).fill(0);
    const place = (i: number, ang: number, x: number, y: number) => {
      wpos[i] = [x, y];
      wang[i] = ang;
    };
    /** world point of a rest-space point carried by part i */
    const carry = (i: number, p: Vec2): Vec2 => {
      const a = wang[i]!;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const pv = this.piv[i]!;
      const w = wpos[i]!;
      const dx = p[0] - pv[0];
      const dy = p[1] - pv[1];
      return [w[0] + c * dx - s * dy, w[1] + s * dx + c * dy];
    };

    const iBarrel = this.req("barrel");
    const bp = this.piv[iBarrel]!;
    place(iBarrel, 0, bp[0] + surge, bp[1] + bob);
    for (const name of ["chest", "hindquarter"] as const) {
      const i = this.req(name);
      const p = this.piv[i]!;
      const dx = p[0] - bp[0];
      place(i, 0, p[0] + surge, p[1] + bob + pitch * dx + (name === "chest" ? -0.2 * g.crouch * U : 0));
    }

    // --- neck / head / mane ------------------------------------------------------------------
    const iChest = this.req("chest");
    const iNeck = this.req("neck");
    const nod = moving ? g.neckNod * Math.cos(TAU * (phase - 0.55)) : 0.04 * Math.sin(input.time * 0.9);
    const neckAng = g.neckBase + nod + pitch * 0.5;
    place(iNeck, neckAng, ...carry(iChest, this.piv[iNeck]!));
    const iHead = this.req("head");
    const headAng = neckAng + g.headBase - nod * 0.55 + (moving ? 0 : 0.03 * Math.sin(input.time * 0.6 + 1));
    place(iHead, headAng, ...carry(iNeck, this.piv[iHead]!));

    // --- secondary springs (tail, mane) ------------------------------------------------------
    const prevTime = sec.lastTime;
    let dt = Number.isFinite(prevTime) ? input.time - prevTime : 0;
    if (!(dt > 0) || dt > 0.1) dt = dt > 0.1 ? 0.1 : 0;
    sec.lastTime = input.time;
    const spring = (x: number, v: number, target: number, k: number, damp: number): [number, number] => {
      // semi-implicit Euler in sub-steps for stability
      const n = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / n;
      for (let s = 0; s < n; s++) {
        v += (k * (target - x) - damp * v) * h;
        x += v * h;
      }
      return [x, v];
    };
    const tailTarget =
      g.tailBase +
      g.tailSwing * Math.sin(TAU * (phase - 0.1)) +
      (moving ? 0.05 * speedK * Math.sin(input.time * 11.3) : 0.12 * Math.sin(input.time * 0.8) * Math.sin(input.time * 0.37));
    if (!Number.isFinite(prevTime)) {
      sec.tail = tailTarget;
      sec.tailV = sec.tip = sec.tipV = sec.mane = sec.maneV = 0;
    }
    [sec.tail, sec.tailV] = spring(sec.tail, sec.tailV, tailTarget, 140, 14);
    // the tip lags the dock (wave) and droops a little under its own weight
    const tipTarget = (tailTarget - sec.tail) * 1.8 - (moving ? 0.12 * speedK : 0) + (moving ? 0.08 * speedK * Math.sin(input.time * 17 + 1) : 0);
    [sec.tip, sec.tipV] = spring(sec.tip, sec.tipV, tipTarget, 90, 9);
    const maneTarget = moving ? -0.12 * speedK - nod * 0.6 + 0.04 * speedK * Math.sin(input.time * 19) : 0;
    [sec.mane, sec.maneV] = spring(sec.mane, sec.maneV, maneTarget, 160, 12);

    const iHq = this.req("hindquarter");
    const iTail = this.req("tail");
    const tailAng = sec.tail + pitch;
    place(iTail, tailAng, ...carry(iHq, this.piv[iTail]!));
    const iTip = this.opt("tailTip");
    if (iTip >= 0) place(iTip, tailAng + sec.tip, ...carry(iTail, this.piv[iTip]!));
    const iMane = this.req("mane");
    place(iMane, neckAng + sec.mane, ...carry(iNeck, this.piv[iMane]!));

    // --- legs (IK on the hoof path) ----------------------------------------------------------
    const ground = this.skel.groundY;
    for (const leg of this.legs) {
      const body = this.req(leg.body);
      const root = carry(body, [this.piv[body]![0] + leg.rootOff[0], this.piv[body]![1] + leg.rootOff[1]]);
      const smp0 = sampleLeg(g, leg.id, phase);
      const smp = { ...smp0, x: smp0.x * U, y: smp0.y * U };
      const rest = this.piv[leg.hoof]!;
      // Hoof target: stance on the ground line, swing along the lifted path.
      const coronetH = ground - rest[1];
      const tx = root[0] + leg.neutral[0] + smp.x;
      const ty = smp.stance ? ground - coronetH : Math.min(ground - coronetH, ground - coronetH + smp.y);
      const { mid, end } = solveTwoBone(root, [tx, ty], leg.l1, leg.l2, leg.fore ? -1 : 1);
      const a1 = Math.atan2(mid[1] - root[1], mid[0] - root[0]) - leg.rest1;
      const a2 = Math.atan2(end[1] - mid[1], end[0] - mid[0]) - leg.rest2;
      place(leg.upper, a1, root[0], root[1]);
      place(leg.lower, a2, mid[0], mid[1]);
      // Hoof: flat while planted, flexes with the cannon (plus a flick) in the air.
      const air = smp.stance ? 0 : smoothstep(0, 0.12, smp.t) * (1 - smoothstep(0.78, 0.98, smp.t));
      const flick = (leg.fore ? 0.9 : 0.5) * Math.sin(Math.PI * Math.min(1, smp.t * 1.4)) * air;
      const hoofAng = lerp(0, a2 + flick, air);
      place(leg.hoof, hoofAng, end[0], end[1]);
    }

    // --- jockey -----------------------------------------------------------------------------
    const iThigh = this.req("jThigh");
    const iShin = this.req("jShin");
    const iTorso = this.req("jTorso");
    const hipRest = this.piv[iThigh]!;
    const ankle = carry(iBarrel, this.j.jAnkle!);
    const absorb = moving ? 0.8 : 0;
    const pump = drive * (moving ? 1 : 0);
    const hip: Vec2 = [
      hipRest[0] + surge * 0.4 + U * (-0.6 * pump + 0.6 * pump * Math.sin(TAU * (phase - 0.55))),
      hipRest[1] + bob * (1 - absorb) + U * (0.7 * g.crouch + 1.3 * pump),
    ];
    const kneeRest = this.j.jKnee!;
    const t1 = Math.hypot(kneeRest[0] - hipRest[0], kneeRest[1] - hipRest[1]);
    const t2 = Math.hypot(this.j.jAnkle![0] - kneeRest[0], this.j.jAnkle![1] - kneeRest[1]);
    const leg = solveTwoBone(hip, ankle, t1, t2, -1);
    const rt1 = Math.atan2(kneeRest[1] - hipRest[1], kneeRest[0] - hipRest[0]);
    const rt2 = Math.atan2(this.j.jAnkle![1] - kneeRest[1], this.j.jAnkle![0] - kneeRest[0]);
    place(iThigh, Math.atan2(leg.mid[1] - hip[1], leg.mid[0] - hip[0]) - rt1, hip[0], hip[1]);
    place(iShin, Math.atan2(leg.end[1] - leg.mid[1], leg.end[0] - leg.mid[0]) - rt2, leg.mid[0], leg.mid[1]);
    const torsoAng = 0.07 * pump + (moving ? 0.03 * speedK * Math.sin(TAU * (phase - 0.65)) : 0);
    const tp = this.piv[iTorso]!;
    place(iTorso, torsoAng, tp[0] - hipRest[0] + hip[0], tp[1] - hipRest[1] + hip[1]);
    const iJHead = this.req("jHead");
    place(iJHead, -torsoAng * 0.7, ...carry(iTorso, this.piv[iJHead]!));
    // Hands ride the horse's neck (so the arms follow the nod); driving pushes them forward.
    const handRest = this.j.hand!;
    const shRest = this.j.jShoulder!;
    const push = pump * (0.5 + 0.5 * Math.cos(TAU * (phase - 0.55)));
    for (const name of ["jArmNear", "jArmFar"] as const) {
      const i = this.req(name);
      const off: Vec2 = [this.piv[i]![0] - this.piv[this.req("jArmNear")]![0], this.piv[i]![1] - this.piv[this.req("jArmNear")]![1]];
      const sh = carry(iTorso, [shRest[0] + off[0], shRest[1] + off[1]]);
      const hand0 = carry(iNeck, [handRest[0] + off[0], handRest[1] + off[1]]);
      const hand: Vec2 = [hand0[0] + 2.2 * push * U, hand0[1] + 0.8 * push * U];
      const restAng = Math.atan2(handRest[1] - shRest[1], handRest[0] - shRest[0]);
      const ang = Math.atan2(hand[1] - sh[1], hand[0] - sh[0]) - restAng;
      // the arm's own pivot sits at the shoulder
      place(i, ang, ...carry(iTorso, this.piv[i]!));
    }

    // --- rein (optional code-drawn part): from the near hand to the bit -----------------------
    const iRein = this.opt("rein");
    let reinLen = 1;
    if (iRein >= 0) {
      const arm = this.req("jArmNear");
      const a = carry(arm, handRest);
      const b = carry(iHead, this.j.bit!);
      reinLen = Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]));
      place(iRein, Math.atan2(b[1] - a[1], b[0] - a[0]), a[0], a[1]);
    }

    // --- far-side copies of the body parts carry nothing else; write matrices ----------------
    for (let i = 0; i < this.n; i++) {
      const w = wpos[i];
      if (!w) {
        // parts the gait does not know about follow their parent rigidly
        const p = this.skel.parts[i]!;
        const pi = p.parent ? this.index.get(p.parent) : undefined;
        if (pi !== undefined && wpos[pi]) place(i, wang[pi]!, ...carry(pi, this.piv[i]!));
        else place(i, 0, this.piv[i]![0], this.piv[i]![1]);
      }
      let ang = wang[i]!;
      let [x, y] = wpos[i]!;
      if (!this.rotates[i]) ang = 0;
      if (snap) {
        if (i !== iRein) ang = Math.round(ang / step) * step;
        const f = this.fracs[i]!;
        x = Math.round(x - f[0]) + f[0];
        y = Math.round(y - f[1]) + f[1];
      }
      const sc = this.skel.parts[i]!.scale ?? [1, 1];
      set(i, ang, x, y, i === iRein ? reinLen : sc[0], i === iRein ? 1 : sc[1]);
    }
    return pose;
  }
}
