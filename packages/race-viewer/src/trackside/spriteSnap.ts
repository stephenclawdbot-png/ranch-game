/**
 * Steady pixel sprites (pure, shared by Trackside and the 3D view). Measured on recorded runs,
 * the horses "twitched" because every frame drew them a little differently:
 *
 *  - the scale (buffer px per strip texel) followed the easing zoom and the runner's drifting
 *    lane continuously, so nearest sampling re-picked which texel columns are doubled on every
 *    frame (a crawl across the body), and
 *  - the sprite's left edge was rounded to whole pixels while its scale changed, so the anchor
 *    (the horse's place on the track) wobbled by up to half a pixel against the camera.
 *
 * Now the scale is held while it stays within `SCALE_HOLD` of the ideal (and is pulled onto a
 * whole number of pixels per texel when within `SCALE_SNAP`), and the anchor lands on the whole
 * pixel nearest its true place, so a horse moving over the ground moves by whole pixels with
 * an unchanging picture of itself.
 */

/** Relative drift of the ideal scale before a held sprite scale follows it. */
export const SCALE_HOLD = 0.03;
/** Within this much of a whole number of pixels per texel, the sprite takes the whole number. */
export const SCALE_SNAP = 0.04;

/** The scale to draw at: `held` (the last one drawn, 0 = none) while close enough to the ideal. */
export function steadyScale(ideal: number, held: number): number {
  const n = Math.round(ideal);
  const want = n >= 1 && Math.abs(ideal - n) <= SCALE_SNAP * n ? n : ideal;
  if (held > 0 && Math.abs(want - held) <= SCALE_HOLD * held) return held;
  return want;
}

/** Top-left (buffer px) of a sprite whose anchor (texels at scale k) lands on the whole pixel nearest (ax, ay). */
export function snappedOrigin(ax: number, ay: number, anchorX: number, anchorY: number, k: number): [number, number] {
  return [Math.round(ax) - anchorX * k, Math.round(ay) - anchorY * k];
}
