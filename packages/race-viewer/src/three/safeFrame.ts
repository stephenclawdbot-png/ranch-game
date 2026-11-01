/**
 * Keeping runners whole on screen in the 3D view (pure camera maths; three.js objects, no
 * renderer). Used for the phone close-up finish's group and, from the last strides until the
 * finale, for the winner and every horse within a length of it: when the eased camera would leave
 * one of them outside the safe area, the camera pans to centre them and dollies back from where it
 * is, a little each frame, so the move stays continuous (never a jump to another angle).
 */
import type * as THREE from "three";
import { GROUP_MARGIN } from "../trackside/layout";

/** NDC bounds a kept runner must stay inside: 8 % of the width each side, clear of the HUD row and the transport bar. */
export interface SafeArea {
  mx: number;
  top: number;
  bottom: number;
  /** A HUD panel over the stage (the course map, NDC box): kept runners stay left of it where they share its height. */
  avoid?: { x0: number; x1: number; y0: number; y1: number } | null;
}

/** A rectangle over the stage, CSS px from the stage's top left. */
export interface StageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The safe area of a W x H stage (CSS px). Phones: a 50 px HUD row and a 46 px bar; larger stages 8 % / 56 px. */
export function safeArea(W: number, H: number, avoid: StageRect | null = null): SafeArea {
  const phone = W <= 480;
  const topPx = phone ? 50 : Math.max(50, H * 0.08);
  const bottomPx = phone ? 46 : 56;
  const w = Math.max(1, W);
  const h = Math.max(1, H);
  return {
    mx: 1 - 2 * GROUP_MARGIN,
    top: 1 - (2 * topPx) / h,
    bottom: -1 + (2 * bottomPx) / h,
    avoid: avoid && avoid.w > 0 && avoid.h > 0 ? { x0: (avoid.x / w) * 2 - 1, x1: ((avoid.x + avoid.w) / w) * 2 - 1, y0: 1 - ((avoid.y + avoid.h) / h) * 2, y1: 1 - (avoid.y / h) * 2 } : null,
  };
}

/** The right bound for boxes spanning e.y0..e.y1: the margin, or the panel's left edge where they share its height. */
function rightBound(e: Extents, a: SafeArea): number {
  const p = a.avoid;
  return p && e.y1 > p.y0 && e.y0 < p.y1 ? Math.min(a.mx, p.x0 - 0.02) : a.mx;
}

/** A runner's world box: its sprite from tail to nose, ground to cap, in its lane. */
export interface RunnerBox {
  x: number;
  y: number;
  z: number;
}

/** Horse extent behind / ahead of its nose point and its height (m), generous to the sprite. */
export const BOX_TAIL_M = 2.7;
export const BOX_NOSE_M = 0.3;
export const BOX_HEIGHT_M = 2.6;

export interface Extents {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** The boxes' NDC extents with the camera as set. */
export function extents(cam: THREE.PerspectiveCamera, boxes: readonly RunnerBox[], v: THREE.Vector3): Extents {
  cam.updateMatrixWorld();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const b of boxes)
    for (const x of [b.x - BOX_TAIL_M, b.x + BOX_NOSE_M])
      for (const y of [b.y, b.y + BOX_HEIGHT_M]) {
        v.set(x, y, b.z).project(cam);
        if (v.z > 1) {
          // behind the camera: as wide as can be, so the camera backs off
          x0 = Math.min(x0, -3);
          x1 = Math.max(x1, 3);
          y0 = Math.min(y0, -3);
          y1 = Math.max(y1, 3);
          continue;
        }
        x0 = Math.min(x0, v.x);
        x1 = Math.max(x1, v.x);
        y0 = Math.min(y0, v.y);
        y1 = Math.max(y1, v.y);
      }
  return { x0, x1, y0, y1 };
}

export function inside(e: Extents, a: SafeArea): boolean {
  return e.x0 > e.x1 || (e.x0 >= -a.mx && e.x1 <= rightBound(e, a) && e.y1 <= a.top && e.y0 >= a.bottom);
}

/**
 * Move `cam` (looking at `look`, which moves with it) the least needed so every box is inside the
 * safe area: pan to centre the boxes, dolly back if they are too wide or tall. Returns whether it
 * moved. `s` are scratch vectors.
 */
export function keepInSafeArea(cam: THREE.PerspectiveCamera, look: THREE.Vector3, boxes: readonly RunnerBox[], area: SafeArea, s: { v: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3; from?: THREE.Vector3; lookFrom?: THREE.Vector3 }, maxStep = Infinity): boolean {
  if (!boxes.length) return false;
  let moved = false;
  const from = Number.isFinite(maxStep) ? (s.from ?? cam.position.clone()).copy(cam.position) : null;
  const lookFrom = from ? (s.lookFrom ?? look.clone()).copy(look) : null;
  for (let i = 0; i < 8; i++) {
    const e = extents(cam, boxes, s.v);
    if (inside(e, area)) break;
    moved = true;
    s.right.setFromMatrixColumn(cam.matrixWorld, 0);
    s.up.setFromMatrixColumn(cam.matrixWorld, 1);
    const dist = Math.max(1, cam.position.distanceTo(look));
    const halfH = dist * Math.tan((cam.fov * Math.PI) / 360);
    const halfW = halfH * cam.aspect;
    // only as far as needed on each axis: a group that fits is slid just inside the edge it crossed
    const right = rightBound(e, area);
    const span = Math.min(1.5, Math.max((e.x1 - e.x0) / (right + area.mx), (e.y1 - e.y0) / (area.top - area.bottom)) * 1.03);
    const fits = span <= 1;
    const dxN = fits ? (e.x1 > right ? e.x1 - right : e.x0 < -area.mx ? e.x0 + area.mx : 0) : (e.x0 + e.x1) / 2 - (right - area.mx) / 2;
    const dyN = fits ? (e.y1 > area.top ? e.y1 - area.top : e.y0 < area.bottom ? e.y0 - area.bottom : 0) : (e.y0 + e.y1) / 2 - (area.top + area.bottom) / 2;
    const dx = dxN * 1.02 * halfW;
    const dy = dyN * 1.02 * halfH;
    cam.position.addScaledVector(s.right, dx).addScaledVector(s.up, dy);
    look.addScaledVector(s.right, dx).addScaledVector(s.up, dy);
    if (!fits) cam.position.sub(look).multiplyScalar(span).add(look);
    cam.lookAt(look);
    cam.updateMatrixWorld();
  }
  // a soft keep (runners about to need it) moves the camera at most `maxStep` a frame
  if (moved && from && lookFrom) {
    const d = cam.position.distanceTo(from);
    if (d > maxStep) {
      const k = maxStep / d;
      cam.position.lerpVectors(from, cam.position, k);
      look.lerpVectors(lookFrom, look, k);
      cam.lookAt(look);
      cam.updateMatrixWorld();
    }
  }
  return moved;
}

/** Camera travel a frame (m) for runners kept softly (about to join the kept set). */
export const SOFT_STEP_M = 0.25;
