/**
 * Body build on the painted sprites (visual research V-04): a non-destructive geometric warp of
 * any keyed horse strip, per frame, from the coat geometry's own landmarks, so every view (the
 * Trackside shader, the 3D view, ranch and paddock, gallop sprite, photo finish and share cards)
 * draws the same build. Like the portrait's breed heads (portraitShape.ts), every output texel
 * points at the source texel it shows (whole texels, nearest, no filtering), so the recolour,
 * patterns, markings and long hair painted on the source ride with the body in every frame.
 *
 * The warp, per frame (whole texels, from the strip's barrel depth H). Nothing grows past the
 * painted horse's own frame (the strips have no room around them), so a build reshapes the horse
 * inside its outline:
 *   - legs (leg + height / 2): the legs stretch up into the barrel (longer legs, a higher belly
 *     line) or shorten under a deeper barrel; the back, the rider and the hooves stay where they are;
 *   - girth: between the hind and front legs the lower half of the barrel deepens (or lifts);
 *   - neck: the neck and head rise (a longer neck carries the head higher) or sink, from the crest
 *     to the face; the chest under the neck, the legs and the rider stay put; the bridle and reins
 *     move with the head. Head size shows on the 3/4 portrait (portraitShape.ts).
 * Layering: a near leg is drawn over the body, a far leg behind it; the rider and tack over the
 * neck. Old appearances (no `build`) and `?build=0` skip it entirely: the sprite as painted.
 */
import type { HorseAppearance } from "@thoroughbred/shared";
import { GEO_REGION, type CoatGeometry, type RoleGrid } from "./coatGeometry";

export type BodyBuild = NonNullable<HorseAppearance["build"]>;
export type HairStyle = NonNullable<HorseAppearance["hair"]>;

// ---------------------------------------------------------------------------
// The comparison switch (?build=0): the painted body and hair, as before builds
// ---------------------------------------------------------------------------

let switchOverride: boolean | null = null;
/** Force builds on or off (tests, harnesses); null = from the page URL (`?build=0` turns them off). */
export function setBuildSwitch(on: boolean | null): void {
  switchOverride = on;
}
/** Whether builds and per-horse hair are drawn (default on; `?build=0` in the page URL turns them off). */
export function buildsOn(): boolean {
  if (switchOverride !== null) return switchOverride;
  try {
    const loc = (globalThis as { location?: { search?: string } }).location;
    return !/[?&]build=0(&|$)/.test(loc?.search ?? "");
  } catch {
    return true;
  }
}

/** The build a view draws: the appearance's, unless absent, flat or switched off. */
export function bodyBuildOf(a: Pick<HorseAppearance, "build">): BodyBuild | null {
  const b = a.build;
  if (!b || !buildsOn()) return null;
  return b.height || b.leg || b.neck || b.girth || b.head ? b : null;
}

/** A feathered horse's mane and tail when its look carries no hair style (older looks, `?build=0`). */
export const FEATHER_HAIR: HairStyle = { mane: 3, tail: 2, thick: true, wave: true };

/** The hair a view draws: the appearance's (unless switched off), a feathered horse's long hair, or null (the painted mane and tail). */
export function hairStyleOf(a: Pick<HorseAppearance, "hair" | "feather">): HairStyle | null {
  if (a.hair && buildsOn()) return a.hair;
  return a.feather ? FEATHER_HAIR : null;
}

/** A short cache-key part for build and hair ("" when neither is drawn, so older keys stay as they were). */
export function lookShapeKey(a: Pick<HorseAppearance, "build" | "hair" | "feather">): string {
  const b = bodyBuildOf(a);
  const h = hairStyleOf(a);
  if (!b && !h) return "";
  return `|b${b ? [b.height, b.leg, b.neck, b.girth, b.head].join(",") : ""}|h${h ? [h.mane, h.tail, h.thick ? 1 : 0, h.wave ? 1 : 0].join(",") : ""}`;
}

// ---------------------------------------------------------------------------
// Landmarks per frame
// ---------------------------------------------------------------------------

export interface WarpFrame {
  /** 0 when the frame has no trunk (no warp). */
  ok: number;
  /** The seam between the trunk and the legs (the belly line: leg texels above it go with the body) and the ground (the lowest hoof row). */
  seam: number;
  ground: number;
  rumpX: number;
  /** Where the neck starts (the crest's first mane column) and the face's first column. */
  crest: number;
  /** The breast: the rightmost trunk column just above the legs (body texels right of it are the throat). */
  chest: number;
  face0: number;
  /** Where the tack and reins start to follow the head (right of the rider's cap). */
  other0: number;
  /** How much of the neck's lift this pose takes: 1 with the head up, 0 grazing (the muzzle stays on the grass), in between as the head lowers. */
  lift: number;
}

export interface WarpAnchors {
  H: number;
  frames: WarpFrame[];
  /** Free rows above the head and below the face, over every frame (the head never leaves its frame or meets the ground). */
  headUp: number;
  headDown: number;
}

/** Landmarks of every frame of a strip (from the shared coat geometry and the role grid). */
export function warpAnchors(geo: CoatGeometry, grid: RoleGrid): WarpAnchors {
  const { fw, fh, H } = geo;
  const frames: WarpFrame[] = [];
  let headUp = fh;
  let headDown = fh;
  for (let f = 0; f < geo.frames; f++) {
    const a = geo.anchors[f]!;
    let ground = 0;
    let legTop = fh;
    let face0 = fw;
    let faceBot = -1;
    let crest = fw;
    let cap1 = -1;
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        const role = grid.role(f, x, y);
        if (!role) continue;
        if (role === 5 && x > cap1) cap1 = x;
        const i = (f * fh + y) * fw + x;
        const r = geo.region[i]!;
        if (!r || geo.outside[i]) continue;
        if (y > ground) ground = y;
        if (r <= 4 && y < legTop) legTop = y;
        if (r === GEO_REGION.face) {
          face0 = Math.min(face0, x);
          faceBot = Math.max(faceBot, y);
        } else if (r === GEO_REGION.mane && x < crest) crest = x;
      }
    const seam = Math.max(legTop, Math.round(a.belly));
    const ok = a.rumpX > 0 && a.belly > 0 && faceBot >= 0 && legTop < fh && ground > seam + 4 ? 1 : 0;
    if (crest >= face0) crest = Math.round(a.rumpX + H * 2.3);
    crest = Math.min(crest, face0 - 4);
    let chest = 0;
    for (let y = Math.max(0, Math.round(seam - H * 0.3)); y < Math.min(fh, seam); y++)
      for (let x = 0; x < fw; x++) if (geo.region[(f * fh + y) * fw + x] === GEO_REGION.body && x > chest) chest = x;
    const lift = Math.max(0, Math.min(1, (ground - faceBot) / Math.max(1, ground - seam)));
    frames.push({ ok, seam, ground, rumpX: a.rumpX, crest, chest: Math.max(chest, crest), face0, other0: Math.max(crest, cap1 + 3), lift: Math.round(lift * 64) / 64 });
    if (!ok) continue;
    // the head's room: above any texel right of the face's first column, below the face to the ground
    let top = fh;
    for (let y = 0; y < fh && top === fh; y++)
      for (let x = face0; x < fw; x++)
        if (grid.role(f, x, y)) {
          top = y;
          break;
        }
    headUp = Math.min(headUp, top);
    headDown = Math.min(headDown, ground - faceBot);
  }
  return { H, frames, headUp: Math.max(0, headUp), headDown: Math.max(0, headDown) };
}

// ---------------------------------------------------------------------------
// Build -> texels
// ---------------------------------------------------------------------------

export interface BuildTexels {
  /** Legs longer (+) / shorter (-): the seam with the barrel moves up by L. */
  L: number;
  /** Barrel deeper (+) / shallower (-) between the legs. */
  G: number;
  /** Neck longer (+): the head rises by NK; shorter (-): it sinks. */
  NK: number;
}

/** Texels per build step, as a share of the barrel depth H. */
export const BUILD_UNITS = { leg: 0.08, girth: 0.08, neck: 0.1 } as const;

/** Whole texels for a build on a strip (the neck clamped to the room the head has in every frame). */
export function buildTexels(b: BodyBuild | null, an: Pick<WarpAnchors, "H" | "headUp" | "headDown">): BuildTexels {
  if (!b) return { L: 0, G: 0, NK: 0 };
  const H = an.H;
  const unit = (k: number) => Math.max(1, Math.round(H * k));
  const L = Math.round((b.leg + b.height * 0.5) * unit(BUILD_UNITS.leg));
  const G = b.girth * unit(BUILD_UNITS.girth);
  const NK = Math.max(-Math.max(0, an.headDown - 1), Math.min(Math.max(0, an.headUp - 1), MAX_LIFT, b.neck * unit(BUILD_UNITS.neck)));
  return { L, G, NK };
}

/** The most the head ever lifts (the shader searches this many rows). */
export const MAX_LIFT = 16;

export const isFlat = (t: BuildTexels) => !t.L && !t.G && !t.NK;

// ---------------------------------------------------------------------------
// The warp: output texel -> source texel
// ---------------------------------------------------------------------------

/** What a source texel is, for the warp's layering. */
export const WARP_CLASS = { empty: 0, nearLeg: 1, farLeg: 2, neck: 3, trunk: 4, other: 5, tail: 6 } as const;
/** Neck texels lie less than this many H under the top line (deeper is the chest, which stays). */
export const NECK_DEPTH = 0.8;

/** Girth weight of a column: 1 between the legs, 0 over them (r = rumpX). */
export function girthWeight(x: number, rumpX: number, H: number): number {
  const a = rumpX + H * 0.5;
  const b = rumpX + H * 0.9;
  const c = rumpX + H * 1.7;
  const d = rumpX + H * 2.1;
  if (x <= a || x >= d) return 0;
  if (x < b) return (x - a) / (b - a);
  if (x > c) return (d - x) / (d - c);
  return 1;
}

/** How far (rows) the head lifts a column: 0 at `start`, NK from the face on. */
export function neckLift(x: number, fr: WarpFrame, t: BuildTexels, start: number): number {
  const nk = Math.round(t.NK * fr.lift);
  if (!nk || x <= start) return 0;
  if (x >= fr.face0) return nk;
  return Math.round((nk * (x - start)) / Math.max(1, fr.face0 - start));
}

/** Output row -> source row for everything but the legs (the barrel's lower half takes the legs' and the girth's change; the head columns stay). */
export function bodySourceY(x: number, y: number, fr: WarpFrame, t: BuildTexels, H: number): number {
  if (x >= fr.face0) return y;
  const ym = fr.seam - Math.round(H / 2);
  if (y < ym) return y;
  const bot = bodyBottom(x, fr, t, H);
  if (y < bot) return ym + Math.floor(((y - ym + 0.5) * (fr.seam - ym)) / (bot - ym));
  return y;
}

/**
 * Where a squeeze maps two source rows to one output row, the other of the two (else the row
 * itself): a thin line on the skipped row is taken when the chosen row is empty there, so a squeeze
 * never cuts a strand or an outline into loose bits.
 */
export function squeezedRow(y: number, chosen: number, top: number, from: number, to: number): number {
  // output rows [top, top + to) show source rows [top', top' + from) (the caller's origins)
  if (from <= to) return chosen;
  const s0 = Math.floor(((y - top) * from) / to);
  const s1 = Math.ceil(((y - top + 1) * from) / to) - 1;
  return chosen === s0 ? s1 : s0;
}

/** The other source row a squeezed body row covers (bodySourceY), or the chosen one. */
export function bodySourceAlt(x: number, y: number, fr: WarpFrame, t: BuildTexels, H: number): number {
  const yy = bodySourceY(x, y, fr, t, H);
  if (x >= fr.face0) return yy;
  const ym = fr.seam - Math.round(H / 2);
  const bot = bodyBottom(x, fr, t, H);
  if (y < ym || y >= bot) return yy;
  return ym + squeezedRow(y, yy - ym, ym, fr.seam - ym, bot - ym);
}

/** The most of the barrel's lower half the legs and girth may squeeze away (the shader mirrors it). */
export const MAX_SQUEEZE = 0.3;
/** New loose fragments smaller than this (texels) that a warp leaves are dropped (CPU views). */
export const WARP_FRAGMENT = 48;

/** The output row the barrel ends at in a column (the seam, moved by the legs and the girth). */
export function bodyBottom(x: number, fr: WarpFrame, t: BuildTexels, H: number): number {
  if (x >= fr.face0) return fr.seam;
  const g = Math.round(t.G * girthWeight(x, fr.rumpX, H));
  const half = Math.round(H / 2);
  return Math.max(fr.seam - half + Math.ceil(half * (1 - MAX_SQUEEZE)), fr.seam - Math.min(Math.floor(half * MAX_SQUEEZE), t.L) + g);
}

/** Output row -> source row for the legs (seam -> ground stretched; null above the legs). */
export function legSourceY(x: number, y: number, fr: WarpFrame, t: BuildTexels, H: number): number | null {
  // the legs reach up to the belly (a deeper belly hangs over their tops)
  const legTop = x >= fr.face0 ? fr.seam : Math.min(fr.seam - Math.min(Math.floor(Math.round(H / 2) * MAX_SQUEEZE), t.L), bodyBottom(x, fr, t, H));
  if (y < legTop) return null;
  if (y > fr.ground) return y;
  const span = fr.ground - fr.seam + 1;
  const spanD = fr.ground - legTop + 1;
  return fr.seam + Math.floor(((y - legTop + 0.5) * span) / Math.max(1, spanD));
}

/** The other source row a squeezed leg row covers (legSourceY, shorter legs), or the chosen one. */
export function legSourceAlt(x: number, y: number, fr: WarpFrame, t: BuildTexels, H: number): number | null {
  const yb = legSourceY(x, y, fr, t, H);
  if (yb === null || y > fr.ground) return yb;
  const legTop = x >= fr.face0 ? fr.seam : Math.min(fr.seam - Math.min(Math.floor(Math.round(H / 2) * MAX_SQUEEZE), t.L), bodyBottom(x, fr, t, H));
  return fr.seam + squeezedRow(y, yb - fr.seam, legTop, fr.ground - fr.seam + 1, Math.max(1, fr.ground - legTop + 1));
}

/**
 * The source texel an output texel shows ([x, y], frame-local), or null (empty). `cls(x, y)` is
 * the class (WARP_CLASS) of a source texel (empty outside the frame). Shared by the CPU warp and
 * mirrored line for line in the Trackside shader.
 */
export function warpSource(x: number, y: number, fr: WarpFrame, t: BuildTexels, H: number, cls: (x: number, y: number) => number): [number, number] | null {
  if (!fr.ok) return cls(x, y) ? [x, y] : null;
  let yb = legSourceY(x, y, fr, t, H);
  if (yb !== null && !cls(x, yb)) yb = legSourceAlt(x, y, fr, t, H);
  const cb = yb === null ? 0 : (c => (c === WARP_CLASS.tail ? WARP_CLASS.trunk : c))(cls(x, yb));
  // a near leg, and the coat, tail, outlines and tack below the belly line, stretch with the legs
  if (cb === WARP_CLASS.nearLeg || cb === WARP_CLASS.other || cb === WARP_CLASS.trunk) return [x, yb!];
  // above the legs: the body's own rows (anything below the seam belongs to the legs' map; under
  // a raised belly, the barrel's old bottom rows are gone)
  const bot = bodyBottom(x, fr, t, H);
  const body = (yd: number, yy: number) => {
    let c = cls(x, yy);
    if (c === WARP_CLASS.tail) c = WARP_CLASS.trunk;
    if ((c === WARP_CLASS.other || c === WARP_CLASS.trunk) && yy >= fr.seam) return WARP_CLASS.empty;
    if ((c === WARP_CLASS.trunk || c === WARP_CLASS.other) && yd >= bot && yd < fr.seam) return WARP_CLASS.empty;
    return c;
  };
  const lo = neckLift(x, fr, t, fr.other0);
  let yn = bodySourceY(x, y + lo, fr, t, H);
  if (!body(y + lo, yn)) yn = bodySourceAlt(x, y + lo, fr, t, H);
  const cn = body(y + lo, yn);
  if (cn === WARP_CLASS.other || cn === WARP_CLASS.neck) return [x, yn];
  let ya = bodySourceY(x, y, fr, t, H);
  if (!body(y, ya)) ya = bodySourceAlt(x, y, fr, t, H);
  const ci = body(y, ya);
  if (ci === WARP_CLASS.trunk || (ci === WARP_CLASS.other && !lo)) return [x, ya];
  // where the neck moved away from, the chest under it shows
  if (ci === WARP_CLASS.neck && cn === WARP_CLASS.trunk) return [x, yn];
  // under a raised neck (not the head) the throat stretches down to where it was, so the neck
  // stays joined to the chest
  if (ci === WARP_CLASS.neck && x < fr.face0 && lo > 0)
    for (let k = lo - 1; k >= 0; k--) {
      const yk = bodySourceY(x, y + k, fr, t, H);
      if (body(y + k, yk) === WARP_CLASS.neck) return [x, yk];
    }
  if (cb === WARP_CLASS.farLeg) return [x, yb!];
  return null;
}

/**
 * The class of a source texel of a painted strip (CPU views): `opaque` from the painted pixels,
 * `hair` the long-hair kinds drawn into it (2 = mane / tail hair), the regions from the geometry.
 */
export function cpuWarpClass(geo: CoatGeometry, fr: WarpFrame, f: number, x: number, y: number, opaque: boolean, hair: number): number {
  if (!opaque) return WARP_CLASS.empty;
  const i = (f * geo.fh + y) * geo.fw + x;
  const r = geo.region[i]!;
  // the legs below the belly line (above it, the forearm and gaskin go with the body)
  if (r >= 1 && r <= 4 && y < fr.seam && !geo.outside[i]) return WARP_CLASS.trunk;
  if (r === GEO_REGION.frontNear || r === GEO_REGION.hindNear) return WARP_CLASS.nearLeg;
  if (r === GEO_REGION.frontFar || r === GEO_REGION.hindFar) return WARP_CLASS.farLeg;
  if (r === GEO_REGION.tail || (r === 0 && hair === 2 && x < fr.crest)) return WARP_CLASS.tail;
  if (r === GEO_REGION.face) return x >= fr.crest ? WARP_CLASS.neck : WARP_CLASS.trunk;
  // mane keys below the belly line are leg shading drawn in the mane keys: they go with the legs
  if (r === GEO_REGION.mane || (r === 0 && hair === 2)) return x >= fr.crest && y < fr.seam ? WARP_CLASS.neck : WARP_CLASS.trunk;
  if (r === 0 && hair !== 1 && x < fr.crest) {
    // ink touching the tail (corners included) is the tail's outline: it hangs with the tail
    const tailAt = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < geo.fw && yy < geo.fh && geo.region[(f * geo.fh + yy) * geo.fw + xx] === GEO_REGION.tail && !geo.outside[(f * geo.fh + yy) * geo.fw + xx];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && tailAt(x + dx, y + dy)) return WARP_CLASS.tail;
  }
  if (r === GEO_REGION.body) {
    if (x < fr.crest || y >= fr.seam) return WARP_CLASS.trunk;
    if (Math.round(geo.v[i]! * 4) / 4 < geo.H * NECK_DEPTH || x > fr.chest) return WARP_CLASS.neck;
    // a one-texel coat-keyed line in the air (the reins' highlight) goes with the tack
    const isBody = (yy: number) => yy >= 0 && yy < geo.fh && geo.region[(f * geo.fh + yy) * geo.fw + x] === GEO_REGION.body;
    return !isBody(y - 1) && !isBody(y + 1) ? WARP_CLASS.other : WARP_CLASS.trunk;
  }
  return WARP_CLASS.other;
}

/**
 * Warp a painted strip (RGBA, frames side by side, `frameW` apart) for a build: a new buffer.
 * `hair` (per frame-local texel, drawLongHair's kinds) marks the hair drawn into it.
 */
export function warpStrip(rgba: Uint8ClampedArray, width: number, frameW: number, geo: CoatGeometry, anchors: WarpAnchors, t: BuildTexels, hair: Uint8Array | null = null): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(rgba.length);
  if (isFlat(t)) {
    out.set(rgba);
    return out;
  }
  const { fw, fh, H } = geo;
  for (let f = 0; f < geo.frames; f++) {
    const fr = anchors.frames[f]!;
    const cls = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= fw || y >= fh) return WARP_CLASS.empty;
      const o = (y * width + f * frameW + x) * 4;
      return cpuWarpClass(geo, fr, f, x, y, rgba[o + 3]! >= 128, hair?.[(f * fh + y) * fw + x] ?? 0);
    };
    const from = new Int32Array(fw * fh).fill(-1);
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        const s = warpSource(x, y, fr, t, H, cls);
        if (!s) continue;
        const si = (s[1] * width + f * frameW + s[0]) * 4;
        const oi = (y * width + f * frameW + x) * 4;
        out[oi] = rgba[si]!;
        out[oi + 1] = rgba[si + 1]!;
        out[oi + 2] = rgba[si + 2]!;
        out[oi + 3] = rgba[si + 3]!;
        from[y * fw + x] = s[1] * fw + s[0];
      }
    dropNewFragments(rgba, out, width, frameW, f, fw, fh, from);
  }
  return out;
}

/** Per texel of one frame: the label of its 8-connected opaque component (0 = empty) and the main (largest) label. */
function components(rgba: ArrayLike<number>, width: number, frameW: number, f: number, fw: number, fh: number): { label: Int32Array; main: number; size: number[] } {
  const label = new Int32Array(fw * fh);
  const size: number[] = [0];
  const stack: number[] = [];
  const opaque = (i: number) => rgba[(((i / fw) | 0) * width + f * frameW + (i % fw)) * 4 + 3]! >= 128;
  let n = 0;
  for (let i = 0; i < fw * fh; i++) {
    if (label[i] || !opaque(i)) continue;
    label[i] = ++n;
    let s = 0;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      s++;
      const px = p % fw;
      const py = (p / fw) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const qx = px + dx;
          const qy = py + dy;
          if (qx < 0 || qy < 0 || qx >= fw || qy >= fh) continue;
          const q = qy * fw + qx;
          if (label[q] || !opaque(q)) continue;
          label[q] = n;
          stack.push(q);
        }
    }
    size.push(s);
  }
  let main = 0;
  for (let k = 1; k <= n; k++) if (size[k]! > (size[main] ?? 0)) main = k;
  return { label, main, size };
}

/**
 * A warp can cut a thin line (an outline crossing the squeezed rows, a strand at a joint) into a
 * loose fragment: any fragment smaller than WARP_FRAGMENT whose every texel came from the
 * painting's main mass is dropped, so no pixel floats free of the horse (fragments the painting
 * itself has, like a grass tuft, stay).
 */
function dropNewFragments(src: ArrayLike<number>, out: Uint8ClampedArray, width: number, frameW: number, f: number, fw: number, fh: number, from: Int32Array): void {
  const a = components(src, width, frameW, f, fw, fh);
  const b = components(out, width, frameW, f, fw, fh);
  const fromMain = new Uint8Array(b.size.length).fill(1);
  for (let i = 0; i < fw * fh; i++) {
    const k = b.label[i]!;
    if (!k || k === b.main) continue;
    if (from[i]! < 0 || a.label[from[i]!] !== a.main) fromMain[k] = 0;
  }
  for (let i = 0; i < fw * fh; i++) {
    const k = b.label[i]!;
    if (!k || k === b.main || !fromMain[k] || b.size[k]! >= WARP_FRAGMENT) continue;
    out[(((i / fw) | 0) * width + f * frameW + (i % fw)) * 4 + 3] = 0;
  }
}
