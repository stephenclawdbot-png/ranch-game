/**
 * <CourseMap>: the overhead course as pixel art (SVG unit squares on a coarse grid, crisp
 * edges): the outline in its running direction, the infield, the winning post, the start for
 * this race's distance, the finish gradient (uphill amber, downhill blue) and, when given,
 * the runners as silks-coloured dots with the leader and the viewer's own horse marked.
 *
 * Static (racecard, wiki) or live (race HUD); no hooks, so it renders on the server too. Runner positions come only from the frames the
 * caller already holds: the map never knows more of a live race than the broadcast showed.
 */
import type { CSSProperties, ReactElement } from "react";
import type { CourseInfo } from "../course/geometry";
import { cellsPath, chevronCells, dilate, rasterCourse, runnerCell, startCell, type Cell, type CourseRaster } from "../course/raster";

export interface CourseMapRunner {
  id: string;
  /** Distance covered (m) in this race. */
  coveredM: number;
  /** Silks primary colour. */
  color: string;
  me?: boolean;
  leader?: boolean;
}

export interface CourseMapProps {
  course: CourseInfo;
  /** Race distance (m): marks where this race starts. Omit for the bare course. */
  distanceM?: number;
  runners?: readonly CourseMapRunner[];
  /** Grid cells across (pixel density). Default 64. */
  cells?: number;
  className?: string;
  style?: CSSProperties;
  /** Accessible label; defaults to a description of the course. */
  label?: string;
}

const C = {
  ink: "#0b0f0c",
  infield: "#1f4d35",
  infield2: "#245a3d",
  track: "#f3e7c9",
  up: "#e0902f",
  down: "#7fb6d9",
  post: "#d71920",
  postW: "#ffffff",
  start: "#7ee08a",
  arrow: "#d9a441",
  me: "#ffffff",
  lead: "#f2c86a",
};

const SHAPE_WORD: Record<CourseInfo["shape"], string> = { oval: "oval", pear: "pear-shaped", triangle: "triangular", horseshoe: "horseshoe" };

/** Accessible one-line description of a course. */
export function describeCourse(course: CourseInfo, distanceM?: number): string {
  const grad = course.finishGradientPermille > 0 ? ", uphill finish" : course.finishGradientPermille < 0 ? ", downhill finish" : "";
  const laps = distanceM ? `; this race starts ${Math.round(distanceM)} m before the winning post` : "";
  return `${course.name}: ${SHAPE_WORD[course.shape]} ${course.direction}-handed course, ${course.circumferenceM} m round, ${course.homeStraightM} m home straight${grad}${laps}`;
}

/** Bar across the track at a cell (perpendicular to the local direction). */
function barAcross(at: Cell, angle: number, half: number): Cell[] {
  const horizontal = Math.abs(Math.cos(angle)) >= Math.abs(Math.sin(angle));
  const out: Cell[] = [];
  for (let k = -half; k <= half; k++) out.push(horizontal ? [at[0], at[1] + k] : [at[0] + k, at[1]]);
  return out;
}

interface Statics {
  r: CourseRaster;
  ink: string;
  infield: string;
  infield2: string;
  plain: string;
  slope: string;
  postRed: string;
  postWhite: string;
  start: string;
  arrow: string;
}

// Rasterised maps are pure functions of (course, grid, distance): cached, so the HUD can
// redraw the dots ten times a second without re-rasterising (and no hooks: server-safe).
const cache = new Map<string, Statics>();

function staticsFor(course: CourseInfo, cells: number, distanceM: number | undefined): Statics {
  const key = `${course.name}|${course.shape}|${course.direction}|${course.circumferenceM}|${course.homeStraightM}|${course.bendTightness ?? ""}|${course.finishGradientPermille}|${cells}|${distanceM ?? 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = rasterCourse(course, cells);
  const g = r.geo;
  const grad = course.finishGradientPermille;
  const slopeFrom = g.postM - Math.min(course.homeStraightM, g.postM);
  const slope: Cell[] = [];
  const plain: Cell[] = [];
  r.track.forEach((c, i) => {
    const m = r.trackM[i]!;
    if (Math.abs(grad) >= 5 && m >= slopeFrom && m <= g.postM) slope.push(c);
    else plain.push(c);
  });
  const angleAt = (m: number) => {
    const a = r.cellAtM(m - 8);
    const b = r.cellAtM(m + 8);
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  const postBar = barAcross(r.cellAtM(g.postM), angleAt(g.postM), 2);
  const arrowM = g.postM + g.lapM * 0.5;
  const arrow = chevronCells(r.cellAtM(arrowM), angleAt(arrowM));
  let start: Cell[] = [];
  if (distanceM && distanceM > 0) {
    const sm = (((g.postM - distanceM) % g.lapM) + g.lapM) % g.lapM;
    start = barAcross(startCell(r, distanceM), angleAt(sm), 2);
  }
  const s: Statics = {
    r,
    ink: cellsPath(dilate([...r.track, ...postBar, ...start])),
    infield: cellsPath(r.infield.filter(([x, y]) => (x + y) % 2 === 0)),
    infield2: cellsPath(r.infield.filter(([x, y]) => (x + y) % 2 === 1)),
    plain: cellsPath(plain),
    slope: cellsPath(slope),
    postRed: cellsPath(postBar.filter((_, i) => i % 2 === 0)),
    postWhite: cellsPath(postBar.filter((_, i) => i % 2 === 1)),
    start: cellsPath(start),
    arrow: cellsPath(arrow),
  };
  if (cache.size > 64) cache.clear();
  cache.set(key, s);
  return s;
}

export function CourseMap({ course, distanceM, runners, cells = 64, className, style, label }: CourseMapProps) {
  const statics = staticsFor(course, cells, distanceM);
  const r = statics.r;
  let dots: ReactElement[] | null = null;
  if (runners?.length && distanceM) {
    // Draw order: the field, then the leader, then your own horse on top.
    const ordered = [...runners].sort((a, b) => Number(!!a.me) - Number(!!b.me) || Number(!!a.leader) - Number(!!b.leader));
    dots = ordered.map((d) => {
      // Grid-aligned 2x2 silks squares on the runner's track cell (crisp at any size); the
      // leader gets a brass frame, your own horse a white frame with an ink edge.
      const [x, y] = runnerCell(r, distanceM, d.coveredM);
      if (d.me)
        return (
          <g key={d.id} data-me="">
            <rect x={x - 2} y={y - 2} width={6} height={6} fill={C.ink} />
            <rect x={x - 1} y={y - 1} width={4} height={4} fill={C.me} />
            <rect x={x} y={y} width={2} height={2} fill={d.color} />
          </g>
        );
      if (d.leader)
        return (
          <g key={d.id} data-leader="">
            <rect x={x - 1} y={y - 1} width={4} height={4} fill={C.lead} />
            <rect x={x} y={y} width={2} height={2} fill={d.color} />
          </g>
        );
      return <rect key={d.id} x={x} y={y} width={2} height={2} fill={d.color} />;
    });
  }

  const grad = course.finishGradientPermille;
  return (
    <svg
      className={className}
      style={{ display: "block", imageRendering: "pixelated", ...style }}
      viewBox={`0 0 ${r.cols} ${r.rows}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label ?? describeCourse(course, distanceM)}
      data-course-map={course.name}
    >
      <path d={statics.infield} fill={C.infield} />
      <path d={statics.infield2} fill={C.infield2} />
      <path d={statics.ink} fill={C.ink} />
      <path d={statics.plain} fill={C.track} />
      {statics.slope && <path d={statics.slope} fill={grad > 0 ? C.up : C.down} />}
      <path d={statics.arrow} fill={C.arrow} />
      {statics.start && <path d={statics.start} fill={C.start} />}
      <path d={statics.postRed} fill={C.post} />
      <path d={statics.postWhite} fill={C.postW} />
      {dots}
    </svg>
  );
}
