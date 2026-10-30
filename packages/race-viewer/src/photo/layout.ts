/**
 * Line-scan geometry (pure). A photo-finish camera images only the finish line, one
 * column per instant, so x is TIME: later columns sit further left and every horse faces
 * right with its nose at the column of its crossing. A horse's body passes the line over
 * (length / speed) seconds, so a faster horse is drawn narrower and a slower one wider.
 *
 * Units are native sprite pixels; the renderer scales by whole numbers only.
 */
import type { PhotoFinishModel } from "./model";

/** Opaque extent of the lunge frame, frame pixels. */
export interface SpriteMetrics {
  frameW: number;
  frameH: number;
  /** Rightmost opaque column (the nose). */
  noseX: number;
  /** Leftmost opaque column (the tail). */
  tailX: number;
  /** Top and bottom opaque rows. */
  top: number;
  bottom: number;
}

export interface LayoutOptions {
  /** Millimetres per sprite pixel at the winner's speed (the race-day strips are about 96 px/m). */
  mmPerPx?: number;
  /** Rows a horse moves down per lane nearer the camera. */
  laneDy?: number;
  /** Draw the mirror strip along the top (default true). */
  mirror?: boolean;
}

export interface RunnerPlacement {
  index: number;
  /** Output column of the nose (integer). */
  noseX: number;
  /** Sprite columns advanced per output column (speed / winner's speed). */
  step: number;
  /** Output width in columns. */
  width: number;
  /** Output row of the sprite's frame top (main image). */
  y: number;
  /** Output row of the mirror image's frame top (half height). */
  mirrorY: number;
  /** Draw order: lower first (far lanes first in the main image). */
  depth: number;
}

export interface Tick {
  x: number;
  us: number;
  major: boolean;
}

export interface PhotoLayout {
  width: number;
  height: number;
  /** Microseconds per output column. */
  usPerColumn: number;
  /** Column of the winner's nose. */
  winnerX: number;
  mirrorH: number;
  /** Row where the main (white line) image starts. */
  mainTop: number;
  /** Row of the track surface behind the hooves. */
  groundY: number;
  /** Row where the time scale starts. */
  scaleTop: number;
  placements: RunnerPlacement[];
  ticks: Tick[];
}

const PAD_AHEAD = 36;
const PAD_BEHIND = 20;
const SCALE_H = 20;
const RAIL_H = 5;
const MINOR_US = 10_000;
const MAJOR_US = 50_000;

export function xAtTime(l: Pick<PhotoLayout, "winnerX" | "usPerColumn">, winnerUs: number, us: number): number {
  return l.winnerX - (us - winnerUs) / l.usPerColumn;
}

export function photoLayout(model: PhotoFinishModel, sprite: SpriteMetrics, opts: LayoutOptions = {}): PhotoLayout {
  const mmPerPx = opts.mmPerPx ?? 10.5;
  const laneDy = opts.laneDy ?? 7;
  const runners = model.runners;
  const w = runners[0];
  const vWin = Math.max(1, w?.speedMmS ?? 16_000);
  const usPerColumn = (mmPerPx * 1_000_000) / vWin;
  const tWin = w?.crossingUs ?? 0;
  const bodyCols = sprite.noseX - sprite.tailX + 1;

  // Horizontal: noses relative to the winner (0), bodies trailing to the left.
  const rel = runners.map((r) => {
    const step = r.speedMmS / vWin;
    return { nose: -Math.round((r.crossingUs - tWin) / usPerColumn), step, width: Math.ceil(bodyCols / step) };
  });
  const minX = Math.min(0, ...rel.map((r) => r.nose - r.width + 1));
  const winnerX = PAD_BEHIND - minX;
  const width = winnerX + 1 + PAD_AHEAD;

  // Vertical: lanes, nearer (wider) lanes lower and in front.
  const lanes = runners.map((r) => r.laneMilli);
  const minLane = Math.min(0, ...lanes);
  const maxLane = Math.max(0, ...lanes);
  const laneSpread = Math.round(((maxLane - minLane) / 1000) * laneDy);
  const bodyH = sprite.bottom - sprite.top + 1;
  const mirror = opts.mirror ?? true;
  const mirrorH = mirror ? Math.ceil(bodyH / 2) + Math.ceil(laneSpread / 2) + 8 : 0;
  const mainTop = mirrorH + (mirror ? RAIL_H : 0);
  const headroom = 10;
  const groundY = mainTop + headroom + bodyH - 6; // hooves stand a little into the track band
  const mainBottom = mainTop + headroom + bodyH + laneSpread + 6;
  const scaleTop = mainBottom;
  const height = scaleTop + SCALE_H;

  const placements: RunnerPlacement[] = runners.map((r, i) => {
    const near = Math.round(((r.laneMilli - minLane) / 1000) * laneDy);
    const far = Math.round(((maxLane - r.laneMilli) / 1000) * laneDy);
    return {
      index: i,
      noseX: winnerX + rel[i]!.nose,
      step: rel[i]!.step,
      width: rel[i]!.width,
      y: mainTop + headroom + near - sprite.top,
      // The mirror faces the camera from the far side: far lanes are nearest it, so they sit lower and in front.
      mirrorY: 4 + Math.round(far / 2) - Math.floor(sprite.top / 2),
      depth: r.laneMilli * 64 + (runners.length - i),
    };
  });

  const ticks: Tick[] = [];
  const tFirst = tWin + (winnerX - (width - 1)) * usPerColumn;
  const tLast = tWin + winnerX * usPerColumn;
  for (let us = Math.ceil(tFirst / MINOR_US) * MINOR_US; us <= tLast; us += MINOR_US) {
    ticks.push({ x: Math.round(winnerX - (us - tWin) / usPerColumn), us, major: us % MAJOR_US === 0 });
  }

  return { width, height, usPerColumn, winnerX, mirrorH, mainTop, groundY, scaleTop, placements, ticks };
}

/** Race clock text for a tick: "1:12.35". */
export function formatPhotoTime(us: number): string {
  const cs = Math.floor(us / 10_000);
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${m}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

/**
 * Whole device pixels per native pixel nearest to filling the container (at least 1):
 * a little wider than the container scrolls rather than dropping to half size.
 * Returns the canvas scale and its CSS width.
 */
export function fitScale(nativeW: number, containerCssW: number, dpr: number, maxScale = 6): { scale: number; cssWidth: number } {
  const d = dpr > 0 ? dpr : 1;
  const scale = Math.max(1, Math.min(maxScale, Math.round((containerCssW * d) / nativeW)));
  return { scale, cssWidth: (nativeW * scale) / d };
}
