/**
 * Trackside view: framing and 2.5D lane layout (pure, no DOM, no three.js).
 *
 * The Trackside view is a side-on "diorama" camera: big pixel gallopers in front of a
 * painted dusk backdrop. Lanes recede like a long-lens shot: a far lane is drawn a little
 * smaller and higher than a near lane (a pinhole camera `D` metres from the inner rail and
 * `camH` metres up), and the horses are depth-sorted so near lanes overlap far lanes.
 *
 * Hard guarantee: `placeField` puts EVERY runner fully inside the stage (inside the HUD-safe
 * band), whatever zoom and centre the eased camera has reached. It first clamps the zoom so
 * the lanes fit vertically and one horse fits horizontally; when the field is still wider
 * than the frame it compresses the gaps between runners (big gaps first, order kept) so
 * stragglers stay on screen instead of dropping out. The camera springs normally keep the
 * field inside the linear zone, so compression only shows on very strung-out fields (zoom
 * clamped at the minimum readable size) and for a moment while the zoom is easing out.
 *
 * Units: metres along the track (x), lanes (0 = inner rail, nearest the camera), CSS px.
 */
import { Spring } from "../scene/camera";

/** Source texels per metre of the HD gallop strip (HD pixel standard v2). */
export const SRC_PX_PER_M = 96;
/** Scale falloff per lane: lane l is drawn at 1 / (1 + LANE_K * l) of lane 0. */
export const LANE_K = 0.03;
/** Lane width (m) used for ground texture depth only. */
export const LANE_W = 1.25;
/** Camera height (m) at close zoom; the camera cranes up as it zooms out (cap grows with crowding). */
export const CAM_H_MIN = 6;
export const CAM_H_MAX = 14;
/** Extra camera height available to big fields on narrow stages (still side-on, never aerial). */
const CAM_H_CROWD = 4;

/**
 * Crowding factor in [0, 1]: 1 on a narrow stage carrying a big field, 0 on wide stages
 * or fields of 8 or fewer. Scales how hard the layout spends the free vertical space to
 * keep runners apart (lane falloff, camera height, minimum readable size).
 */
export function crowding(W: number, runners: number): number {
  const narrow = Math.min(1, Math.max(0, (560 - W) / 160)); // 1 at <=400, 0 at >=560
  const big = Math.min(1, Math.max(0, (runners - 8) / 4)); // 1 at >=12
  return narrow * big;
}

/** Lane depth falloff for a crowding level: crowded fields recede faster (more height per lane). */
export function laneFalloff(cr: number): number {
  return LANE_K * (1 + 0.7 * cr); // up to ~0.07
}

export interface SpriteMetrics {
  /** Frame width (m) at lane 0. */
  lenM: number;
  /** Frame height (m). */
  heightM: number;
  /** Frame extent right of the anchor (nose side), m. */
  noseM: number;
  /** Frame extent left of the anchor (tail side), m. */
  tailM: number;
}

export function gallopMetrics(fw = 229, fh = 146, anchorX = 0.974): SpriteMetrics {
  const lenM = fw / SRC_PX_PER_M;
  return { lenM, heightM: fh / SRC_PX_PER_M, noseM: lenM * (1 - anchorX), tailM: lenM * anchorX };
}

export interface Insets {
  l: number;
  r: number;
  t: number;
  b: number;
}

/** HUD-safe insets for a stage (top HUD strip, minimap + controls at the bottom). */
export function safeInsets(W: number, H: number): Insets {
  const narrow = W < 560;
  const side = Math.max(6, Math.round(W * 0.02));
  let t = narrow ? 62 : 74;
  let b = narrow ? 82 : 96;
  // Short stages: give the field room (the HUD gradients are translucent).
  const minBand = Math.max(90, H * 0.42);
  const over = minBand - (H - t - b);
  if (over > 0) {
    const k = Math.max(0, (H - minBand) / (t + b));
    t = Math.round(t * k);
    b = Math.round(b * k);
  }
  return { l: side, r: side, t, b };
}

export const laneScale = (lane: number, k = LANE_K) => 1 / (1 + k * lane);

/**
 * Camera height for a zoom: low and close when zoomed in, craned up a little when wide so
 * the lanes the field occupies still spread over ~22 % of the stage (side-on, never aerial:
 * at most ~20 degrees down at the 40 m lens distance). Big fields on short narrow stages
 * (`crowding`) spread over much more of the free band and crane higher, so 12 runners stay
 * readable on a phone.
 */
export function camHeight(ppm: number, H: number, laneSpan: number, cr = 0): number {
  const k = laneFalloff(cr);
  // Short (phone) stages spread the lanes a little more: small horses overlap less.
  const share = H < 420 ? 0.3 + 0.15 * cr : 0.22;
  const cap = CAM_H_MAX + CAM_H_CROWD * cr;
  const want = (share * H) / Math.max(1e-6, ppm * (1 - laneScale(Math.max(3, laneSpan), k)));
  return Math.min(cap, Math.max(CAM_H_MIN, want));
}

export interface RunnerPos {
  x: number;
  lane: number;
}

export interface Placed {
  /** Screen x of the anchor (nose / ground contact), CSS px. */
  ax: number;
  /** Screen y of the feet. */
  feetY: number;
  /** Lane scale (1 at lane 0). */
  ls: number;
  /** CSS px per metre for this runner (ppm * ls). */
  pxPerM: number;
  /** Screen offset applied by compression/clamping (0 when the camera frames it linearly). */
  shift: number;
  rect: { x: number; y: number; w: number; h: number };
}

export interface FieldLayout {
  W: number;
  H: number;
  insets: Insets;
  /** Zoom actually used (CSS px per metre at lane 0), after the hard clamps. */
  ppm: number;
  cx: number;
  camH: number;
  /** Lane falloff used for this layout (grows with crowding; horses, ground and props all share it). */
  k: number;
  /** Feet line of lane 0. */
  y0: number;
  /** Horizon (y where lane depth -> infinity). */
  horizon: number;
  compressed: boolean;
  placed: Placed[];
  /** Runner anchors, sorted: linear camera x -> drawn x (for props on the same squeeze). */
  knots: { lin: number[]; out: number[] };
}

/**
 * Screen x of a world point at lane-0 linear position `linX`, following the same squeeze
 * as the runners (so the winning post and line stay true to who has crossed them).
 */
export function squeezeX(f: FieldLayout, linX: number): number {
  const { lin, out } = f.knots;
  const n = lin.length;
  if (!n) return linX;
  if (linX <= lin[0]!) return linX + (out[0]! - lin[0]!);
  if (linX >= lin[n - 1]!) return linX + (out[n - 1]! - lin[n - 1]!);
  let i = 1;
  while (i < n - 1 && lin[i]! < linX) i++;
  const a = lin[i - 1]!;
  const b = lin[i]!;
  const u = b > a ? (linX - a) / (b - a) : 0;
  return out[i - 1]! + (out[i]! - out[i - 1]!) * u;
}

export interface FieldInput {
  W: number;
  H: number;
  insets?: Insets;
  ppm: number;
  cx: number;
  sprite: SpriteMetrics;
  runners: readonly RunnerPos[];
  /** Far rail lane. */
  railLane: number;
  /** Eased lane span used for vertical framing (>= the actual max lane is enforced). */
  laneSpan?: number;
  /** Extra headroom above the far horse (marker), m. */
  headroomM?: number;
}

/** Lane-0 screen-y offset of lane l (positive = higher on screen). */
const rise = (ppm: number, camH: number, l: number, k = LANE_K) => ppm * camH * (1 - laneScale(l, k));

function verticalNeed(ppm: number, H: number, span: number, sprite: SpriteMetrics, lmax: number, lmin: number, head: number, cr = 0) {
  const k = laneFalloff(cr);
  const camH = camHeight(ppm, H, span, cr);
  const top = rise(ppm, camH, lmax, k) + (sprite.heightM + head) * ppm * laneScale(lmax, k);
  const bottom = Math.max(0, -rise(ppm, camH, lmin, k)) + 0.08 * ppm;
  return { camH, top, bottom };
}

/** Largest zoom (<= ppm) at which lanes [lmin, lmax] fit the safe band vertically. */
export function verticalFitPpm(ppm: number, H: number, insets: Insets, span: number, sprite: SpriteMetrics, lmax: number, lmin = 0, head = 0.3, cr = 0): number {
  const band = Math.max(1, H - insets.t - insets.b);
  const fits = (p: number) => {
    const v = verticalNeed(p, H, span, sprite, lmax, lmin, head, cr);
    return v.top + v.bottom <= band;
  };
  if (fits(ppm)) return ppm;
  // need(p) is increasing in p (camH * p is non-decreasing): bisect.
  let lo = 0;
  let hi = ppm;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return Math.max(1e-3, lo);
}

/** Place every runner on screen. See the module comment for the guarantee. */
export function placeField(inp: FieldInput): FieldLayout {
  const { W, H, sprite, runners } = inp;
  const insets = inp.insets ?? safeInsets(W, H);
  const n = runners.length;
  let lmax = inp.laneSpan ?? 0;
  let lmin = 0;
  for (const r of runners) {
    lmax = Math.max(lmax, r.lane);
    lmin = Math.min(lmin, r.lane);
  }
  lmin = Math.max(lmin, -0.9);
  const head = inp.headroomM ?? 0.3;
  const cr = crowding(W, n);
  const k = laneFalloff(cr);
  // Hard clamps: one horse fits across, the lanes fit down.
  const availW = Math.max(1, W - insets.l - insets.r);
  let ppm = Math.min(inp.ppm, (availW * 0.98) / (sprite.lenM * laneScale(lmin, k)));
  const span = inp.laneSpan ?? lmax;
  ppm = verticalFitPpm(ppm, H, insets, span, sprite, lmax, lmin, head, cr);
  const v = verticalNeed(ppm, H, span, sprite, lmax, lmin, head, cr);
  const band = Math.max(1, H - insets.t - insets.b);
  const slack = Math.max(0, band - v.top - v.bottom);
  // Sit the field low in the band (the backdrop gets the headroom, like the diorama).
  const y0 = insets.t + v.top + slack * 0.88;
  const horizon = y0 - ppm * v.camH;

  // Horizontal: linear camera mapping first.
  const ls = runners.map((r) => laneScale(Math.max(r.lane, lmin), k));
  const lin = runners.map((r, i) => W / 2 + (r.x - inp.cx) * ppm * ls[i]!);
  let maxTail = 0;
  let maxNose = 0;
  for (let i = 0; i < n; i++) {
    maxTail = Math.max(maxTail, sprite.tailM * ppm * ls[i]!);
    maxNose = Math.max(maxNose, sprite.noseM * ppm * ls[i]!);
  }
  const Lb = insets.l + maxTail;
  const Rb = W - insets.r - maxNose;
  const A = Math.max(0, Rb - Lb);
  const order = lin.map((_, i) => i).sort((a, b) => lin[a]! - lin[b]! || a - b);
  const out = lin.slice();
  let compressed = false;
  if (n > 0) {
    const p0 = lin[order[0]!]!;
    const p1 = lin[order[n - 1]!]!;
    const S = p1 - p0;
    // The leader keeps its camera position where it can (so the gap to the winning post is
    // true); the field slides in, or the gaps behind it are squeezed, to fit [Lb, leader].
    const R = Math.min(Math.max(p1, Lb + Math.min(S, 0.6 * A)), Rb);
    if (R - S >= Lb - 1e-9) {
      const shift = R - p1;
      for (let i = 0; i < n; i++) out[i] = lin[i]! + shift;
    } else {
      compressed = true;
      const span = Math.max(0, R - Lb);
      // Compress gaps above an equal share first (bunched horses keep their spacing).
      const g0 = span / Math.max(1, n - 1);
      let base = 0;
      let excess = 0;
      const gaps: number[] = [];
      for (let j = 0; j < n - 1; j++) {
        const g = lin[order[j + 1]!]! - lin[order[j]!]!;
        gaps.push(g);
        base += Math.min(g, g0);
        excess += Math.max(0, g - g0);
      }
      const lambda = base <= span && excess > 0 ? (span - base) / excess : 0;
      const shrink = base > span && base > 0 ? span / base : 1;
      let pos = Lb;
      out[order[0]!] = pos;
      for (let j = 0; j < n - 1; j++) {
        const g = gaps[j]!;
        pos += (Math.min(g, g0) + lambda * Math.max(0, g - g0)) * shrink;
        out[order[j + 1]!] = Math.min(pos, R);
      }
    }
  }
  const placed: Placed[] = runners.map((r, i) => {
    const l = Math.max(r.lane, lmin);
    const s = ls[i]!;
    const pxPerM = ppm * s;
    const feetY = y0 - rise(ppm, v.camH, l, k);
    const ax = out[i]!;
    const w = sprite.lenM * pxPerM;
    const h = sprite.heightM * pxPerM;
    return { ax, feetY, ls: s, pxPerM, shift: ax - lin[i]!, rect: { x: ax - sprite.tailM * pxPerM, y: feetY - h, w, h } };
  });
  // Knots on the lane-0 scale (props and the finish line are mapped through them).
  const knots = { lin: order.map((i) => W / 2 + (runners[i]!.x - inp.cx) * ppm), out: order.map((i) => W / 2 + (out[i]! - W / 2) / ls[i]!) };
  for (let j = 1; j < knots.lin.length; j++) {
    if (knots.lin[j]! < knots.lin[j - 1]!) knots.lin[j] = knots.lin[j - 1]!;
    if (knots.out[j]! < knots.out[j - 1]!) knots.out[j] = knots.out[j - 1]!;
  }
  return { W, H, insets, ppm, cx: inp.cx, camH: v.camH, k, y0, horizon, compressed, placed, knots };
}

/** Screen y of the ground at lane l for a layout. */
export function laneY(f: FieldLayout, l: number): number {
  return f.y0 - rise(f.ppm, f.camH, l, f.k);
}

// ---------------------------------------------------------------------------- camera

/**
 * Pixel-perfect zoom ladder: device px per SOURCE texel = m / s, where s is the sprite
 * level of detail (1..4: exact downsampled copies) and m an integer device-px size. When
 * the camera rests on a ladder value, the near lane is drawn at an exact integer scale.
 */
export const ZOOM_LADDER: readonly number[] = (() => {
  const set = new Set<number>();
  for (let s = 1; s <= 4; s++) for (let m = 1; m <= 16; m++) set.add(Math.round((m / s) * 1e6) / 1e6);
  return [...set].sort((a, b) => a - b);
})();

export function ladderBelow(q: number): number | null {
  let best: number | null = null;
  for (const v of ZOOM_LADDER) if (v <= q + 1e-9) best = v;
  return best;
}

export interface CameraRunner {
  x: number;
  lane: number;
  /** m/s */
  speed: number;
}

export interface CameraInput {
  W: number;
  H: number;
  /** Device pixels per CSS px of the drawing buffer. */
  dpr: number;
  sprite: SpriteMetrics;
  runners: readonly CameraRunner[];
  railLane: number;
  /** Finish line (m); the post is brought into frame as the leader reaches it. */
  finishX: number;
  /** Seconds of look-ahead (velocity extrapolation; never reads future frames). */
  lookahead?: number;
}

export interface CameraTarget {
  ppm: number;
  /** Fit before the ladder (CSS px per metre). */
  ppmFit: number;
  cx: number;
  laneSpan: number;
  /** Mean speed of the field, m/s (spring feed-forward). */
  speed: number;
}

/** Minimum readable horse length and the close-up cap (CSS px). */
export function sizeLimits(W: number, runners = 8): { minLen: number; maxLen: number } {
  const minLen = Math.min(180, Math.max(84, W * 0.14));
  // Big fields on narrow stages may fall back to a smaller horse, still on the ladder.
  const crowded = Math.max(44, Math.round(minLen * (1 - 0.25 * crowding(W, runners))));
  return { minLen: crowded, maxLen: Math.min(520, W * 0.34) };
}

/** Where the camera wants to be: the zoom that fits the field and the centre of the field. */
export function cameraTarget(c: CameraInput): CameraTarget {
  const { W, H, sprite } = c;
  const insets = safeInsets(W, H);
  const la = c.lookahead ?? 1.2;
  let xmin = Infinity;
  let xmax = -Infinity;
  let lmax = 0;
  let speed = 0;
  for (const r of c.runners) speed += r.speed;
  const mean = speed / Math.max(1, c.runners.length);
  speed = 0;
  for (const r of c.runners) {
    // Look ahead on the spread only (relative to the field): the centre spring already
    // feeds the field's speed forward.
    const ahead = r.x + (r.speed - mean) * la;
    xmin = Math.min(xmin, r.x, ahead);
    xmax = Math.max(xmax, r.x, ahead);
    lmax = Math.max(lmax, r.lane);
    speed += r.speed;
  }
  if (!c.runners.length) {
    xmin = xmax = 0;
  }
  speed /= Math.max(1, c.runners.length);
  const availW = Math.max(1, W - insets.l - insets.r);
  const { minLen, maxLen } = sizeLimits(W, c.runners.length);
  const cr = crowding(W, c.runners.length);
  const ppmMin = minLen / sprite.lenM;
  const ppmMax = maxLen / sprite.lenM;
  let boxR = xmax + sprite.noseM;
  const boxL = xmin - sprite.tailM;
  const ppmV = verticalFitPpm(ppmMax, H, insets, lmax + 0.6, sprite, lmax + 0.6, 0, 0.3, cr);
  const fit = (bR: number) => Math.min(Math.max(Math.min((availW * 0.9) / Math.max(sprite.lenM, bR - boxL), ppmMax), ppmMin), ppmV);
  let ppmFit = fit(boxR);
  // Ease the winning post in as the leader closes on it (within ~30 % of the frame).
  const toPost = c.finishX - xmax;
  if (toPost > 0 && toPost * ppmFit < availW * 0.3) {
    boxR = Math.max(boxR, c.finishX + 0.8);
    ppmFit = fit(boxR);
  }
  // Centre of the box; when it can't fit even at the minimum size, keep the leaders framed
  // and let the stragglers compress against the left edge.
  let cx = (boxL + boxR) / 2;
  const half = availW / 2 / ppmFit;
  if (boxR - boxL > 2 * half) cx = boxR - half;
  return { ppm: ppmFit, ppmFit, cx, laneSpan: lmax + 0.6, speed };
}

/**
 * Stateful eased camera: the zoom rests on the pixel-perfect ladder (with hysteresis) and
 * eases between rungs with a critically damped spring in log space; the centre follows with
 * a spring that feeds forward the field's speed (no lag, no cuts).
 */
export class TracksideCamera {
  private z = new Spring(Math.log(100), 2.4);
  private c = new Spring(0, 3);
  private lane = new Spring(0, 1.6);
  private q: number | null = null;
  ppm = 100;
  cx = 0;
  laneSpan = 0;
  target: CameraTarget | null = null;

  /** Ladder rung for a fit (device px per source texel), with hysteresis. */
  private rung(qFit: number, qMin: number): number {
    const below = ladderBelow(qFit * 0.97);
    if (this.q === null || this.q > qFit) {
      this.q = below !== null && below >= qMin ? below : qFit;
    } else if (below !== null && below > this.q && below <= qFit * 0.9) {
      this.q = below;
    }
    return this.q;
  }

  update(input: CameraInput, dt: number, snap: boolean): void {
    const t = cameraTarget(input);
    this.target = t;
    const toQ = input.dpr / SRC_PX_PER_M;
    const qMin = (sizeLimits(input.W, input.runners.length).minLen / input.sprite.lenM) * toQ;
    const q = this.rung(t.ppmFit * toQ, Math.min(qMin, t.ppmFit * toQ));
    const ppmT = q / toQ;
    if (snap) {
      this.z.snap(Math.log(ppmT));
      this.c.snap(t.cx, t.speed);
      this.lane.snap(t.laneSpan);
    } else {
      // Zoom out a touch faster than in (the field spreading must not wait on the lens).
      this.z.omega = Math.log(ppmT) < this.z.x ? 3.2 : 2.2;
      this.z.step(Math.log(ppmT), dt);
      this.c.step(t.cx, dt, t.speed);
      this.lane.step(t.laneSpan, dt);
    }
    this.ppm = Math.exp(this.z.x);
    this.cx = this.c.x;
    this.laneSpan = Math.max(0, this.lane.x);
  }

  reset(): void {
    this.q = null;
  }
}
