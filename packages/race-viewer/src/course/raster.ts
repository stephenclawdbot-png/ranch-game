/**
 * Course map rasteriser (pure): the overhead course drawn on a coarse pixel grid, so the map
 * reads as pixel art at any size (SVG unit squares with crisp edges). Cells are integer
 * [x, y] pairs in a grid `cols` wide.
 */
import { courseGeometry, pointAt, runnerArcM, startArcM, type CourseGeometry, type CourseInfo } from "./geometry";

export type Cell = [number, number];

export interface CourseRaster {
  geo: CourseGeometry;
  cols: number;
  rows: number;
  /** Track centre line, in running order from the home bend's exit (one cell per step, no gaps). */
  track: Cell[];
  /** Arc position (m) of each track cell. */
  trackM: number[];
  /** Cells inside the outline (the infield). */
  infield: Cell[];
  /** Grid cell for a map point. */
  cellOf(x: number, y: number): Cell;
  /** Grid cell for an arc position (m). */
  cellAtM(m: number): Cell;
}

const PAD = 3;

export function rasterCourse(course: CourseInfo, cols = 64): CourseRaster {
  const geo = courseGeometry(course);
  const inner = cols - PAD * 2 - 1;
  const rows = Math.ceil(geo.height * inner) + PAD * 2 + 1;
  const cellOf = (x: number, y: number): Cell => [Math.round(PAD + x * inner), Math.round(PAD + y * inner)];
  const cellAtM = (m: number): Cell => {
    const p = pointAt(geo, m);
    return cellOf(p.x, p.y);
  };
  // Walk the outline finely; keep each new cell, filling diagonal-only steps so the line is 4-connected-ish.
  const track: Cell[] = [];
  const trackM: number[] = [];
  const steps = Math.max(200, inner * 12);
  const seen = new Set<string>();
  for (let i = 0; i < steps; i++) {
    const m = (i / steps) * geo.lapM;
    const c = cellAtM(m);
    const k = `${c[0]},${c[1]}`;
    if (seen.has(k)) continue;
    seen.add(k);
    track.push(c);
    trackM.push(m);
  }
  // Infield: cell centres inside the outline polygon (even-odd rule).
  const poly = geo.points.map(([x, y]) => [PAD + x * inner, PAD + y * inner] as const);
  const infield: Cell[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i]!;
        const [xj, yj] = poly[j]!;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside && !seen.has(`${x},${y}`)) infield.push([x, y]);
    }
  }
  return { geo, cols, rows, track, trackM, infield, cellOf, cellAtM };
}

/** Cell of a runner who has covered `coveredM` of a `distanceM` race. */
export function runnerCell(r: CourseRaster, distanceM: number, coveredM: number): Cell {
  return r.cellAtM(runnerArcM(r.geo, distanceM, coveredM));
}

/** Cell of the start for a race of `distanceM`. */
export function startCell(r: CourseRaster, distanceM: number): Cell {
  return r.cellAtM(startArcM(r.geo, distanceM));
}

/** SVG path of unit squares, one per cell (dedup'd). */
export function cellsPath(cells: Iterable<Cell>): string {
  const seen = new Set<string>();
  let d = "";
  for (const [x, y] of cells) {
    const k = `${x},${y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    d += `M${x} ${y}h1v1h-1z`;
  }
  return d;
}

/** The 3x3 neighbourhood of every cell (a one-cell ink outline round a line). */
export function dilate(cells: Iterable<Cell>, r = 1): Cell[] {
  const out: Cell[] = [];
  for (const [x, y] of cells) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) out.push([x + dx, y + dy]);
  return out;
}

/** A small pixel chevron at `at` pointing along `angle` (radians, map space). */
export function chevronCells(at: Cell, angle: number): Cell[] {
  const dx = Math.round(Math.cos(angle));
  const dy = Math.round(Math.sin(angle));
  // perpendicular, quantised the same way
  const nx = -dy;
  const ny = dx;
  const out: Cell[] = [at];
  for (let k = 1; k <= 2; k++) {
    out.push([at[0] - dx * k + nx * k, at[1] - dy * k + ny * k]);
    out.push([at[0] - dx * k - nx * k, at[1] - dy * k - ny * k]);
  }
  return out;
}
