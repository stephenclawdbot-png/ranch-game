/**
 * Course map geometry (pure, no DOM): the overhead outline of a racecourse built from its
 * shared definition (`Course` in @thoroughbred/game-core courses.ts), and where the winning
 * post, the race start and each runner sit on it.
 *
 * The race itself is simulated and drawn as a straight line of `distanceM`; the map only
 * wraps that line round the course: a runner who has covered `x` metres of a `D` metre race
 * is `D - x` metres before the post, measured backwards along the running direction (so a
 * race longer than a lap simply starts further round, passing the post on the way).
 *
 * Outlines are "belts" round a few bend circles (a stadium oval, a pear, a rounded triangle,
 * a horseshoe whose top bends back on itself), stretched until the home straight takes the
 * course's share of the lap, then rotated so the home straight runs along the bottom.
 * Left-handed courses run anticlockwise on the map (bottom straight left to right),
 * right-handed ones are mirrored (clockwise). Units: the outline is fitted to width 1
 * (y down, like SVG); distances along it are course metres.
 */

export type CourseShapeId = "oval" | "pear" | "triangle" | "horseshoe";
export type CourseSceneryId = "parkland" | "chalk_downs" | "coastal" | "city" | "meadow" | "moorland";

/**
 * What the viewer needs from a course: a structural subset of game-core's `Course`, so the
 * web app passes `courseByName(track)` straight in (the viewer doesn't depend on game-core).
 */
export interface CourseInfo {
  name: string;
  /** One line for the racecard. */
  character?: string;
  direction: "left" | "right";
  shape: CourseShapeId;
  circumferenceM: number;
  homeStraightM: number;
  /** 0..1000, optional (tighter bends draw smaller radii). */
  bendTightness?: number;
  /** Permille rise of the final stretch (positive = uphill finish). */
  finishGradientPermille: number;
  scenery: CourseSceneryId;
}

export interface CourseGeometry {
  /** Dense closed outline in running order (the last point joins the first), y down, width 1. */
  points: [number, number][];
  /** Arc length at each point, course metres (cum[0] = 0). */
  cum: number[];
  width: number;
  height: number;
  lapM: number;
  /** Arc position of the winning post (m from points[0], i.e. from the home bend's exit). */
  postM: number;
  /** Length of the home straight drawn on the map (m), ending past the post. */
  straightM: number;
  direction: "left" | "right";
}

type V = [number, number];
interface Circle {
  c: V;
  /** Signed radius: positive = convex bend (centre inside), negative = the outline bends back round it. */
  r: number;
}

const TAU = Math.PI * 2;
const mod = (a: number, m: number) => ((a % m) + m) % m;

/** Outward normal of the common tangent from circle a to circle b (circles kept on the left, anticlockwise). */
function tangentNormal(a: Circle, b: Circle): V {
  const dx = b.c[0] - a.c[0];
  const dy = b.c[1] - a.c[1];
  const L = Math.hypot(dx, dy);
  const tx = dx / L;
  const ty = dy / L;
  const cos = Math.max(-1, Math.min(1, (a.r - b.r) / L));
  const sin = -Math.sqrt(Math.max(0, 1 - cos * cos));
  // n = cos * t + sin * leftPerp(t), leftPerp = (-ty, tx)
  return [cos * tx - sin * ty, cos * ty + sin * tx];
}

interface Belt {
  pts: V[];
  /** Index range [straightFrom, straightTo] of the home straight (circle 0 -> circle 1). */
  straightLen: number;
  perimeter: number;
}

/** Belt round the circles (math coords, y up), starting at the exit of circle 0 onto the home straight. */
function belt(circles: Circle[], arcStep = 0.06): Belt {
  const n = circles.length;
  const normals: V[] = circles.map((c, i) => tangentNormal(c, circles[(i + 1) % n]!));
  const pts: V[] = [];
  let perimeter = 0;
  let straightLen = 0;
  for (let i = 0; i < n; i++) {
    const a = circles[i]!;
    const b = circles[(i + 1) % n]!;
    const nn = normals[i]!;
    const p0: V = [a.c[0] + a.r * nn[0], a.c[1] + a.r * nn[1]];
    const p1: V = [b.c[0] + b.r * nn[0], b.c[1] + b.r * nn[1]];
    const seg = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    if (i === 0) straightLen = seg;
    perimeter += seg;
    // straight p0 -> p1, sampled so arc-length lookups stay accurate
    const steps = Math.max(1, Math.ceil(seg / 0.1));
    for (let k = 0; k < steps; k++) pts.push([p0[0] + ((p1[0] - p0[0]) * k) / steps, p0[1] + ((p1[1] - p0[1]) * k) / steps]);
    // arc round b from p1 to the start of the next straight
    const nOut = normals[(i + 1) % n]!;
    const q: V = [b.c[0] + b.r * nOut[0], b.c[1] + b.r * nOut[1]];
    const phiIn = Math.atan2(p1[1] - b.c[1], p1[0] - b.c[0]);
    const phiOut = Math.atan2(q[1] - b.c[1], q[0] - b.c[0]);
    const sweep = b.r >= 0 ? mod(phiOut - phiIn, TAU) : -mod(phiIn - phiOut, TAU);
    const R = Math.abs(b.r);
    perimeter += Math.abs(sweep) * R;
    const arcSteps = Math.max(1, Math.ceil(Math.abs(sweep) / arcStep));
    for (let k = 0; k < arcSteps; k++) {
      const ph = phiIn + (sweep * k) / arcSteps;
      pts.push([b.c[0] + R * Math.cos(ph), b.c[1] + R * Math.sin(ph)]);
    }
  }
  return { pts, straightLen, perimeter };
}

/** Bend circles for a shape at stretch `s` (bend radius 1 unless noted). */
function circlesFor(shape: CourseShapeId, s: number, bendR: number): Circle[] {
  switch (shape) {
    case "oval":
      return [
        { c: [0, bendR], r: bendR },
        { c: [s, bendR], r: bendR },
      ];
    case "pear": {
      // a wide sweeping bend at the far end, a tighter one after the home straight
      const big = bendR * 1.7;
      return [
        { c: [0, big], r: big },
        { c: [s, bendR], r: bendR },
      ];
    }
    case "triangle":
      return [
        { c: [0, bendR], r: bendR },
        { c: [s, bendR], r: bendR },
        { c: [s * 0.42, bendR + s * 0.78], r: bendR },
      ];
    case "horseshoe": {
      const h = s * 0.95;
      const rho = Math.max(0.35, s * 0.16);
      return [
        { c: [0, bendR], r: bendR },
        { c: [s, bendR], r: bendR },
        { c: [s, bendR + h], r: bendR },
        { c: [s / 2, bendR + h * 0.42 + rho], r: -rho },
        { c: [0, bendR + h], r: bendR },
      ];
    }
  }
}

function minStretch(shape: CourseShapeId, bendR: number): number {
  // keep the belt well-formed: concave notch clear of the top bends, straights positive
  return shape === "horseshoe" ? bendR * 5.2 : shape === "pear" ? bendR * 1.2 : bendR * 0.6;
}

/** Bend radius from tightness (tight bends = smaller radius relative to the straights). */
function bendRadius(t: number | undefined): number {
  const k = Math.min(1000, Math.max(0, t ?? 450)) / 1000;
  return 1.35 - 0.75 * k;
}

/**
 * Overhead outline of a course. The home straight's share of the lap matches
 * `homeStraightM / circumferenceM` (with a short run past the post), where the shape allows.
 */
export function courseGeometry(course: CourseInfo): CourseGeometry {
  const lapM = Math.max(1, course.circumferenceM);
  const bendR = bendRadius(course.bendTightness);
  const runIn = Math.min(0.6, Math.max(0.03, course.homeStraightM / lapM));
  const target = Math.min(0.45, runIn / 0.9); // the post sits 90 % of the way along the straight
  const frac = (s: number) => {
    const b = belt(circlesFor(course.shape, s, bendR), 0.2);
    return b.straightLen / b.perimeter;
  };
  let lo = minStretch(course.shape, bendR);
  let hi = 80;
  if (frac(lo) >= target) hi = lo;
  else if (frac(hi) <= target) lo = hi;
  else {
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (frac(mid) < target) lo = mid;
      else hi = mid;
    }
  }
  const b = belt(circlesFor(course.shape, (lo + hi) / 2, bendR));
  // Rotate so the home straight (pts[0] -> its end) runs along +x, then flip to y-down.
  const p0 = b.pts[0]!;
  let k = 1;
  while (k < b.pts.length - 1 && Math.hypot(b.pts[k]![0] - p0[0], b.pts[k]![1] - p0[1]) < b.straightLen * 0.5) k++;
  const ang = Math.atan2(b.pts[k]![1] - p0[1], b.pts[k]![0] - p0[0]);
  const ca = Math.cos(-ang);
  const sa = Math.sin(-ang);
  const mirror = course.direction === "right" ? -1 : 1;
  let pts: V[] = b.pts.map(([x, y]) => {
    const rx = (x - p0[0]) * ca - (y - p0[1]) * sa;
    const ry = (x - p0[0]) * sa + (y - p0[1]) * ca;
    return [rx * mirror, -ry];
  });
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const span = Math.max(1e-6, maxX - minX);
  pts = pts.map(([x, y]) => [(x - minX) / span, (y - minY) / span]);
  const cum: number[] = [0];
  let len = 0;
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1]!;
    const c = pts[i % pts.length]!;
    len += Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (i < pts.length) cum.push(len);
  }
  const mPerUnit = lapM / len;
  const straightM = (b.straightLen / b.perimeter) * lapM;
  return {
    points: pts,
    cum: cum.map((c) => c * mPerUnit),
    width: 1,
    height: (maxY - minY) / span,
    lapM,
    postM: Math.min(straightM * 0.97, course.homeStraightM),
    straightM,
    direction: course.direction,
  };
}

/** Point (map units) at arc position `m` (course metres from points[0], any value: wraps per lap). */
export function pointAt(g: CourseGeometry, m: number): { x: number; y: number; angle: number } {
  const s = mod(m, g.lapM);
  const n = g.points.length;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.cum[mid]! <= s) lo = mid;
    else hi = mid - 1;
  }
  const a = g.points[lo]!;
  const b = g.points[(lo + 1) % n]!;
  const segEnd = lo + 1 < n ? g.cum[lo + 1]! : g.lapM;
  const t = segEnd > g.cum[lo]! ? (s - g.cum[lo]!) / (segEnd - g.cum[lo]!) : 0;
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

/**
 * Unwrapped arc position of a runner who has covered `coveredM` of a `distanceM` race
 * (before the start: the start; past the post: carries on round). Increases with distance.
 */
export function runnerArcM(g: CourseGeometry, distanceM: number, coveredM: number): number {
  return g.postM - distanceM + Math.max(0, coveredM);
}

/** Arc position of the start for a race of `distanceM` (wrapped into one lap). */
export function startArcM(g: CourseGeometry, distanceM: number): number {
  return mod(g.postM - distanceM, g.lapM);
}

/** Whole laps (and a bit) a race of this distance covers: 1.4 = one lap and 40 %. */
export function lapsOf(g: CourseGeometry, distanceM: number): number {
  return distanceM / g.lapM;
}
