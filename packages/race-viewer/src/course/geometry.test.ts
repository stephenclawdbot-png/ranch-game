import { describe, expect, it } from "vitest";
import { courseGeometry, pointAt, runnerArcM, startArcM, type CourseInfo } from "./geometry";
import { rasterCourse, runnerCell, startCell } from "./raster";
import { describeCourse } from "../hud/CourseMap";

// The six racecourses as game-core defines them (packages/game-core/src/courses.ts); the web
// app checks the real definitions against this geometry too (apps/web course-map test).
const COURSES: CourseInfo[] = [
  { name: "Ashcombe", direction: "right", shape: "oval", circumferenceM: 2400, homeStraightM: 500, bendTightness: 350, finishGradientPermille: 0, scenery: "parkland" },
  { name: "Kestrel Downs", direction: "left", shape: "triangle", circumferenceM: 1800, homeStraightM: 300, bendTightness: 850, finishGradientPermille: 0, scenery: "chalk_downs" },
  { name: "Saltmarsh", direction: "left", shape: "oval", circumferenceM: 2800, homeStraightM: 800, bendTightness: 200, finishGradientPermille: 0, scenery: "coastal" },
  { name: "Bellmont", direction: "left", shape: "oval", circumferenceM: 2000, homeStraightM: 450, bendTightness: 500, finishGradientPermille: 0, scenery: "city" },
  { name: "Larkspur", direction: "right", shape: "pear", circumferenceM: 2200, homeStraightM: 550, bendTightness: 400, finishGradientPermille: -10, scenery: "meadow" },
  { name: "Harrowgate", direction: "right", shape: "horseshoe", circumferenceM: 2600, homeStraightM: 400, bendTightness: 600, finishGradientPermille: 30, scenery: "moorland" },
];

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Signed area of the outline (y down: negative = anticlockwise on screen). */
function signedArea(pts: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

describe.each(COURSES)("course map geometry: $name ($shape)", (course) => {
  const g = courseGeometry(course);

  it("is a closed outline one lap long, fitted to width 1", () => {
    expect(g.points.length).toBeGreaterThan(40);
    expect(g.lapM).toBe(course.circumferenceM);
    // the last point joins the first with an ordinary step (no gap anywhere)
    const steps = g.points.map((p, i) => Math.hypot(g.points[(i + 1) % g.points.length]![0] - p[0], g.points[(i + 1) % g.points.length]![1] - p[1]));
    expect(Math.max(...steps)).toBeLessThan(0.05);
    for (let i = 1; i < g.cum.length; i++) expect(g.cum[i]!).toBeGreaterThan(g.cum[i - 1]!);
    expect(g.cum[g.cum.length - 1]!).toBeLessThan(g.lapM);
    // wraps: one lap on is the same point
    expect(dist(pointAt(g, 123), pointAt(g, 123 + g.lapM))).toBeLessThan(1e-9);
    const xs = g.points.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(0, 9);
    expect(Math.max(...xs)).toBeCloseTo(1, 9);
    expect(g.height).toBeGreaterThan(0.15);
  });

  it("puts the home straight along the bottom with the post near its end", () => {
    const post = pointAt(g, g.postM);
    const maxY = Math.max(...g.points.map((p) => p[1]));
    expect(post.y).toBeCloseTo(maxY, 2);
    // the run-in from the home bend's exit to the post matches the course's home straight
    expect(g.postM).toBeCloseTo(Math.min(course.homeStraightM, g.straightM * 0.97), 6);
    expect(g.postM).toBeLessThan(g.straightM);
    expect(g.straightM / g.lapM).toBeGreaterThan(Math.min(0.45, course.homeStraightM / course.circumferenceM) * 0.95);
  });

  it("runs the way the course turns (left-handed anticlockwise, right-handed clockwise)", () => {
    const a = pointAt(g, g.postM - 50);
    const b = pointAt(g, g.postM);
    // on the bottom straight a left-handed course runs left to right on the map
    if (course.direction === "left") expect(b.x).toBeGreaterThan(a.x);
    else expect(b.x).toBeLessThan(a.x);
    const area = signedArea(g.points);
    if (course.direction === "left") expect(area).toBeLessThan(0);
    else expect(area).toBeGreaterThan(0);
  });

  it.each([1000, 1600, 2400, 3200, 4000])("places the start %i m before the post, round the course", (d) => {
    const s = startArcM(g, d);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(g.lapM);
    // running forward from the start for the race distance lands on the post (whole laps allowed)
    expect(dist(pointAt(g, s + d), pointAt(g, g.postM))).toBeLessThan(1e-6);
    // a runner who has covered nothing is at the start; one who has covered it all, at the post
    expect(dist(pointAt(g, runnerArcM(g, d, 0)), pointAt(g, s))).toBeLessThan(1e-6);
    expect(dist(pointAt(g, runnerArcM(g, d, d)), pointAt(g, g.postM))).toBeLessThan(1e-6);
  });

  it("moves runner dots monotonically along the running direction as distance grows", () => {
    const d = 2400;
    let prev = -Infinity;
    let travelled = 0;
    let outline = 0;
    g.points.forEach((p, i) => {
      const q = g.points[(i + 1) % g.points.length]!;
      outline += Math.hypot(q[0] - p[0], q[1] - p[1]);
    });
    let last = pointAt(g, runnerArcM(g, d, 0));
    for (let x = 0; x <= d; x += 10) {
      const m = runnerArcM(g, d, x);
      expect(m).toBeGreaterThan(prev);
      prev = m;
      const p = pointAt(g, m);
      const step = dist(p, last);
      // 10 m of race is a short, bounded step on the map (never a jump across the course)
      expect(step).toBeLessThanOrEqual((10 / g.lapM) * outline * 1.0001);
      travelled += step;
      last = p;
    }
    // the dot's path length matches the distance run (as a share of the outline)
    expect(travelled / ((outline / g.lapM) * d)).toBeGreaterThan(0.97);
    expect(travelled / ((outline / g.lapM) * d)).toBeLessThan(1.0001);
  });

  it("rasterises to a connected pixel line with the post and start on it", () => {
    const r = rasterCourse(course, 56);
    expect(r.track.length).toBeGreaterThan(60);
    const on = new Set(r.track.map(([x, y]) => `${x},${y}`));
    for (let i = 0; i < r.track.length; i++) {
      const [x1, y1] = r.track[i]!;
      const [x2, y2] = r.track[(i + 1) % r.track.length]!;
      expect(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))).toBeLessThanOrEqual(1);
      expect(x1).toBeGreaterThanOrEqual(0);
      expect(x1).toBeLessThan(r.cols);
      expect(y1).toBeGreaterThanOrEqual(0);
      expect(y1).toBeLessThan(r.rows);
    }
    expect(on.has(r.cellAtM(r.geo.postM).join(","))).toBe(true);
    expect(on.has(startCell(r, 1600).join(","))).toBe(true);
    expect(on.has(runnerCell(r, 1600, 700).join(","))).toBe(true);
    expect(r.infield.length).toBeGreaterThan(20);
  });

  it("describes itself for screen readers", () => {
    expect(describeCourse(course, 1600)).toContain(`${course.direction}-handed`);
    if (course.finishGradientPermille > 0) expect(describeCourse(course)).toContain("uphill finish");
  });
});

describe("course map shapes differ", () => {
  it("each shape draws a different outline", () => {
    const sig = (c: CourseInfo) => {
      const g = courseGeometry(c);
      return Array.from({ length: 12 }, (_, i) => {
        const p = pointAt(g, (i / 12) * g.lapM);
        return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
      }).join(" ");
    };
    const oval = sig(COURSES[0]!);
    for (const c of COURSES.filter((x) => x.shape !== "oval")) expect(sig(c)).not.toBe(oval);
  });

  it("the horseshoe bends back on itself (its outline is not convex)", () => {
    const g = courseGeometry(COURSES[5]!);
    // a horizontal line through the arms crosses the outline four times (two arms, a gap between)
    const y = g.height * 0.25;
    let crossings = 0;
    for (let i = 0; i < g.points.length; i++) {
      const a = g.points[i]!;
      const b = g.points[(i + 1) % g.points.length]!;
      if ((a[1] - y) * (b[1] - y) < 0) crossings++;
    }
    expect(crossings).toBeGreaterThanOrEqual(4);
  });
});
