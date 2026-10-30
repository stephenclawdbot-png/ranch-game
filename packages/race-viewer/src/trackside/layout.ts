/**
 * Trackside view: framing and 2.5D lane layout (pure, no DOM, no three.js).
 *
 * The Trackside view is a side-on "diorama" camera: big pixel gallopers in front of a
 * painted dusk backdrop. Lanes recede like a long-lens shot: a far lane is drawn a little
 * smaller and higher than a near lane (a pinhole camera `D` metres from the inner rail and
 * `camH` metres up), and the horses are depth-sorted so near lanes overlap far lanes.
 *
 * Hard guarantee: in the default whole-field framing, `placeField` puts EVERY runner fully
 * inside the stage (inside the HUD-safe band), whatever zoom and centre the eased camera has
 * reached. It first clamps the zoom so the lanes fit vertically and one horse fits
 * horizontally; when the field is still wider than the frame it compresses the gaps between
 * runners (big gaps first, `squeezeGaps`; bunched horses keep their true spacing) so
 * stragglers stay on screen instead of dropping out. The camera springs normally keep the
 * field inside the linear zone, so compression only shows on strung-out fields (zoom clamped
 * at the minimum readable size, `sizeLimits`) and for a moment while the zoom is easing out.
 *
 * Honest compression: the views must agree on distances (the 3D view, the progress strip,
 * the course map and the standings' "+NL" all draw true gaps). So the running order on screen
 * is always the true order (by track position, never swapped by perspective), and every
 * visibly squeezed gap is reported in `FieldLayout.gaps` with its true length; the scene
 * marks it with a haze cut and a "8L" chip (gapMarks.ts).
 *
 * "Follow mine" mode (`FieldInput.follow` / `CameraInput.followIndex`) drops that guarantee
 * on purpose: the camera locks the marked runner at ~40 % from the left at the close-up
 * zoom and everyone else is free to leave the frame; the followed runner itself stays put
 * by construction.
 *
 * Units: metres along the track (x), lanes (0 = inner rail, nearest the camera), CSS px.
 */
import { HORSE_LENGTH_MM } from "@thoroughbred/shared";
import { Spring } from "../scene/camera";
import { lengthsLabel } from "../timeline";

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
  /**
   * The gaps between runners next to each other in the running order (by true x, trailing
   * runner first), with how much each is squeezed on screen. `strength > 0` marks a gap the
   * view has visibly shortened: the scene draws a true-length chip ("8L") there.
   */
  gaps: FieldGap[];
  /** Runner anchors, sorted: linear camera x -> drawn x (for props on the same squeeze). */
  knots: { lin: number[]; out: number[] };
}

/** One gap of the running order (see `FieldLayout.gaps`). */
export interface FieldGap {
  /** Runner index of the trailing runner. */
  behind: number;
  /** Runner index of the runner ahead of it. */
  ahead: number;
  /** True gap on the track (m): ahead.x - behind.x. */
  trueM: number;
  /** Drawn / true on-screen length (1 = true to scale, < 1 = squeezed). */
  squeeze: number;
  /** Marker strength 0..1 (continuous, so the chip fades in and out with the squeeze). */
  strength: number;
  /** Screen x (CSS px) of the visible gap's middle: between the trailing nose and the tail ahead. */
  x: number;
}

/** Metres per horse length: the same definition as the standings' "+NL" gaps (shared HORSE_LENGTH_MM). */
export const LENGTH_M = HORSE_LENGTH_MM / 1000;

/**
 * Squeezed gaps keep this share of their length beyond the cap (see `placeField`): bigger
 * gaps still draw bigger, the chip carries the true length.
 */
export const GAP_KEEP = 0.15;

const smooth01 = (v: number) => {
  const t = Math.min(1, Math.max(0, v));
  return t * t * (3 - 2 * t);
};

/** A gap is "squeezed" (marked) once it is drawn below this share of its length... */
export const MARK_SQUEEZE = 0.85;
/** ...and hides more than this many lengths. */
export const MARK_HIDDEN_L = 1;

/**
 * Gap-marker strength for a gap of `trueM` metres drawn at `squeeze` of its true length.
 * Zero unless the gap is shortened by more than 15 % AND by more than a length (so bunched
 * horses nudged by a few centimetres never get a chip); full at 30 % and 2 lengths.
 * Continuous in both, so markers fade in and out smoothly as compression starts and stops.
 */
export function gapMarkerStrength(trueM: number, squeeze: number): number {
  const hiddenL = (trueM * (1 - squeeze)) / LENGTH_M;
  return smooth01((MARK_SQUEEZE - squeeze) / 0.15) * smooth01(hiddenL - MARK_HIDDEN_L);
}

/** Chip text for a gap: true lengths, rounded exactly like the standings' "+NL" (no plus sign). */
export function gapLabel(trueM: number): string {
  return lengthsLabel(trueM * 1000).replace(/^\+/, "");
}

/**
 * Drawn lengths for gaps `g` (px, >= 0) that must fit `span` px: gaps up to a cap `T` keep
 * their true length, longer gaps keep `T + keep * (g - T)` (big gaps first; bunched horses
 * keep their true spacing). `T` is solved so the drawn gaps fill `span` exactly; when even
 * T = 0 does not fit, every gap scales by the same factor. Continuous in the inputs, so the
 * squeeze eases with the field instead of popping.
 */
export function squeezeGaps(g: readonly number[], span: number, keep = GAP_KEEP): number[] {
  let total = 0;
  let gmax = 0;
  for (const v of g) {
    total += v;
    gmax = Math.max(gmax, v);
  }
  if (total <= span) return g.slice();
  if (keep * total >= span) {
    const s = total > 0 ? Math.max(0, span) / total : 0;
    return g.map((v) => v * s);
  }
  const f = (T: number) => {
    let s = 0;
    for (const v of g) s += v <= T ? v : T + keep * (v - T);
    return s;
  };
  let lo = 0;
  let hi = gmax;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > span) hi = mid;
    else lo = mid;
  }
  const T = lo;
  return g.map((v) => (v <= T ? v : T + keep * (v - T)));
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
  /**
   * Follow-cam: index of the runner to lock on. Horizontal fitting/compression is skipped:
   * runners land by the pure linear camera mapping and may leave the frame. Vertical
   * framing is unchanged. Ignored when out of range.
   */
  follow?: number | null;
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

/** Place every runner on screen. See the module comment for the guarantee (whole-field
 * framing; with `follow` only the followed runner stays on screen). */
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
  // The running order: true track position (what the standings, progress strip and course
  // map show), trailing runner first. Perspective alone could swap two near-level runners in
  // different lanes at the edge of the frame; the whole-field layout never draws a runner
  // behind one it is ahead of.
  const order = lin.map((_, i) => i).sort((a, b) => runners[a]!.x - runners[b]!.x || lin[a]! - lin[b]! || b - a);
  const gpx: number[] = [];
  for (let j = 0; j < n - 1; j++) gpx.push(Math.max(0, lin[order[j + 1]!]! - lin[order[j]!]!));
  const drawn = gpx.slice();
  const out = lin.slice();
  let compressed = false;
  const followIdx = inp.follow != null && inp.follow >= 0 && inp.follow < n ? inp.follow : null;
  if (followIdx !== null) {
    // Follow-cam: no fitting/compression — the linear mapping stands, so runners other than
    // the followed one may leave the frame by design (the whole-field guarantee above does
    // not apply in this mode). Gaps are reported unsqueezed.
  } else if (n > 0) {
    let p1 = -Infinity;
    for (const v of lin) p1 = Math.max(p1, v);
    // Drawn extent with the running order enforced (a runner swapped by perspective is drawn
    // level with the one behind it instead).
    const S = p1 - lin[order[0]!]!;
    // The leader keeps its camera position where it can (so the gap to the winning post is
    // true); the field slides in, or the gaps behind it are squeezed, to fit [Lb, leader].
    const R = Math.min(Math.max(p1, Lb + Math.min(S, 0.6 * A)), Rb);
    if (R - S >= Lb - 1e-9) {
      const shift = R - p1;
      let prev = -Infinity;
      for (const i of order) {
        out[i] = Math.max(lin[i]! + shift, prev);
        prev = out[i]!;
      }
      for (let j = 0; j < n - 1; j++) drawn[j] = out[order[j + 1]!]! - out[order[j]!]!;
    } else {
      compressed = true;
      // Big gaps first: bunched horses keep their true spacing (squeezeGaps).
      const d = squeezeGaps(gpx, Math.max(0, R - Lb));
      let pos = Lb;
      out[order[0]!] = pos;
      for (let j = 0; j < n - 1; j++) {
        pos = Math.min(pos + d[j]!, R);
        out[order[j + 1]!] = pos;
        drawn[j] = d[j]!;
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
  const gaps: FieldGap[] = [];
  for (let j = 0; j < n - 1; j++) {
    const a = order[j]!;
    const b = order[j + 1]!;
    const trueM = runners[b]!.x - runners[a]!.x;
    const squeeze = gpx[j]! > 1e-6 ? Math.min(1, Math.max(0, drawn[j]! / gpx[j]!)) : 1;
    const nose = placed[a]!.ax;
    const tail = placed[b]!.rect.x;
    gaps.push({ behind: a, ahead: b, trueM, squeeze, strength: followIdx !== null ? 0 : gapMarkerStrength(trueM, squeeze), x: nose + Math.max(0, tail - nose) / 2 });
  }
  return { W, H, insets, ppm, cx: inp.cx, camH: v.camH, k, y0, horizon, compressed, placed, gaps, knots };
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
  /**
   * Follow-cam: index of the runner to lock on ("Follow mine"). The camera centres that
   * runner at ~40 % of the stage width at the close-up zoom; everyone else may leave the
   * frame. Null/absent (or out of range) = whole field.
   */
  followIndex?: number | null;
}

export interface CameraTarget {
  ppm: number;
  /** Fit before the ladder (CSS px per metre). */
  ppmFit: number;
  cx: number;
  laneSpan: number;
  /** Mean speed of the field, m/s (spring feed-forward). */
  speed: number;
  /** The followed runner in follow-cam mode (null = whole field). */
  follow?: CameraRunner | null;
}

/**
 * Smallest horse the whole-field shot may zoom out to (CSS px of horse length): desktop
 * min(120, ~9.3 % of the stage width), phones 56. A third below the original 180 / 84, so a
 * strung-out field is shown at (or much nearer) its true spacing instead of squeezed; the
 * pixel art still lands at >= ~0.5 CSS px per source texel (>= 1 device px on HiDPI), on
 * an exact downsampled level of detail.
 */
export const WIDE_MIN_LEN = { desktop: 120, phone: 56, share: 0.14 * (2 / 3) } as const;

/** Minimum readable horse length and the close-up cap (CSS px). */
export function sizeLimits(W: number, runners = 8): { minLen: number; maxLen: number } {
  const minLen = Math.min(WIDE_MIN_LEN.desktop, Math.max(WIDE_MIN_LEN.phone, W * WIDE_MIN_LEN.share));
  // Big fields on narrow stages may fall back to a smaller horse, still on the ladder.
  const crowded = Math.max(44, Math.round(minLen * (1 - 0.25 * crowding(W, runners))));
  return { minLen: crowded, maxLen: Math.min(520, W * 0.34) };
}

/** Fraction of the stage width where the followed runner's sprite centre sits. */
export const FOLLOW_AT = 0.4;

/**
 * Where the camera wants to be: the zoom that fits the field and the centre of the field —
 * or, with `followIndex`, the close-up lock on that runner (see `followTarget`).
 */
export function cameraTarget(c: CameraInput): CameraTarget {
  const me = c.followIndex != null && c.followIndex >= 0 && c.followIndex < c.runners.length ? c.runners[c.followIndex]! : null;
  if (me) return followTarget(c, me);
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
 * Camera centre (m) that puts the followed runner's sprite centre at `FOLLOW_AT` of the
 * stage width, for a given zoom. Used with the actual ladder zoom so the runner sits
 * exactly on the 40 % line once the springs settle. `k` must match placeField's lane
 * falloff for the anchor to be exact.
 */
export function followCx(W: number, sprite: SpriteMetrics, me: { x: number; lane: number }, ppm: number, k = LANE_K): number {
  const ppml = Math.max(1e-6, ppm * laneScale(me.lane, k));
  return me.x + ((1 - 2 * FOLLOW_AT) * W * 0.5) / ppml + (sprite.lenM / 2 - sprite.tailM);
}

/**
 * Follow-cam target ("Follow mine"): the close-up zoom (the `maxLen` cap, only pulled down
 * when the field's lanes genuinely can't fit the stage height) and the centre from
 * `followCx`. Feed-forward is the runner's own speed, so the lock doesn't lag. The winning
 * post needs no special case: the camera rides with the runner, so the post eases in from
 * the right as the followed runner closes on it.
 */
export function followTarget(c: CameraInput, me: CameraRunner): CameraTarget {
  const { W, H, sprite } = c;
  const insets = safeInsets(W, H);
  let lmax = 0;
  for (const r of c.runners) lmax = Math.max(lmax, r.lane);
  const cr = crowding(W, c.runners.length);
  let ppmFit = sizeLimits(W, c.runners.length).maxLen / sprite.lenM;
  ppmFit = Math.min(ppmFit, verticalFitPpm(ppmFit, H, insets, lmax + 0.6, sprite, lmax + 0.6, 0, 0.3, cr));
  return { ppm: ppmFit, ppmFit, cx: followCx(W, sprite, me, ppmFit, laneFalloff(cr)), laneSpan: lmax + 0.6, speed: me.speed, follow: me };
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
  /** Last follow-cam state; a mode switch re-seats the zoom rung (hysteresis re-arms). */
  private followOn = false;
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
    const fo = t.follow ?? null;
    if ((fo !== null) !== this.followOn) {
      // Mode switch: the rung must jump to the new fit (whole-field zoom can sit far below
      // the close-up rungs, and the zoom-in hysteresis alone would never reach them). The
      // springs still ease between the old and new values, so there's no cut.
      this.q = null;
      this.followOn = fo !== null;
    }
    const toQ = input.dpr / SRC_PX_PER_M;
    const qMin = (sizeLimits(input.W, input.runners.length).minLen / input.sprite.lenM) * toQ;
    const q = this.rung(t.ppmFit * toQ, Math.min(qMin, t.ppmFit * toQ));
    const ppmT = q / toQ;
    // Follow mode re-anchors at the real ladder zoom so the runner lands exactly on the
    // FOLLOW_AT line; whole-field mode takes the target centre as is.
    const cxT = fo ? followCx(input.W, input.sprite, fo, ppmT, laneFalloff(crowding(input.W, input.runners.length))) : t.cx;
    const speedT = fo ? fo.speed : t.speed;
    if (snap) {
      this.z.snap(Math.log(ppmT));
      this.c.snap(cxT, speedT);
      this.lane.snap(t.laneSpan);
    } else {
      // Zoom out a touch faster than in (the field spreading must not wait on the lens).
      this.z.omega = Math.log(ppmT) < this.z.x ? 3.2 : 2.2;
      this.z.step(Math.log(ppmT), dt);
      this.c.step(cxT, dt, speedT);
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
