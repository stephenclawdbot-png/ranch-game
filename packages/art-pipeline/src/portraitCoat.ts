/**
 * The 3/4 portrait in horse space (coat audit): where each pixel of the painted still
 * (roles.png, 128 x 128, head facing left, neck to the right) sits on the horse, so the portrait
 * samples the same coat layers (coatLayers.ts) as the race strips, the 3D view and the ranch, and
 * a horse's blaze, tobiano patches, spots, ticking or long mane are the same in every view.
 *
 *   - the head (left of the throat line): face space; t runs from the brow (y 36) to the nose
 *     (y 102), e is the distance from the face's centre line (the blaze's line, which the 3/4
 *     view shows near the face's left edge);
 *   - the neck and the mane: body space; v is the depth under the crest (the mane's lower edge),
 *     u runs down the crest from the poll (u = 3.05 H) to the withers (1.95 H).
 * One barrel depth H is 50 portrait pixels (the neck is about 0.9 H deep, as on the strips).
 * The breed head shapes and the idle loop are warps of this one still, so they read it too.
 */
import { GEO_REGION, type CoatGeometry } from "./coatGeometry";

export const PORTRAIT_GEO = {
  size: 128,
  H: 50,
  /** Face centre line x = c0 + c1 * y (the blaze in portrait-marks.png, least squares). */
  c0: 54.23,
  c1: -0.341,
  browY: 36,
  noseY: 102,
  /** Face-space e per pixel off the centre line (the 3/4 view shows the face front wider than a profile). */
  eScale: 0.7,
  /** Head zone: x + slope * y < cut. */
  headSlope: 0.35,
  headCut: 92,
  /** The crest from the poll down to the withers (portrait pixels) and the poll's body u (in H). */
  poll: [58, 18] as const,
  withers: [112, 117] as const,
  uPoll: 3.05,
  /** Body u the crest reaches at the withers end of the portrait (the strips' neck runs 3.05 -> 1.95 H). */
  uWithers: 1.95,
} as const;

/** roles.png role ids (portrait34 PORTRAIT_ROLES): coat 5, mane 6, muzzle 7, inner ear 8. */
const COAT = 5;
const MANE = 6;
const MUZZLE = 7;
const EAR = 8;

/** Coat geometry of the portrait still (one frame, 128 x 128) from its role map. */
export function portraitCoatGeometry(roles: ArrayLike<number>): CoatGeometry {
  const P = PORTRAIT_GEO;
  const S = P.size;
  const n = S * S;
  const region = new Uint8Array(n);
  const p1 = new Float32Array(n);
  const p2 = new Float32Array(n);
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const roleAt = (i: number) => Math.round(roles[i * 4]! / 28);
  // distance (4-neighbour BFS) of every pixel from the mane, and of mane pixels from the coat
  const distTo = (isSrc: (i: number) => boolean) => {
    const d = new Int32Array(n).fill(-1);
    const q = new Int32Array(n);
    let h = 0;
    let t = 0;
    for (let i = 0; i < n; i++)
      if (isSrc(i)) {
        d[i] = 0;
        q[t++] = i;
      }
    while (h < t) {
      const i = q[h++]!;
      const x = i % S;
      const y = (i / S) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < S - 1 ? i + 1 : -1, y > 0 ? i - S : -1, y < S - 1 ? i + S : -1]) {
        if (j < 0 || d[j] !== -1) continue;
        d[j] = d[i]! + 1;
        q[t++] = j;
      }
    }
    return d;
  };
  const fromMane = distTo((i) => roleAt(i) === MANE);
  const fromCoat = distTo((i) => roleAt(i) === COAT);
  const ax = P.withers[0] - P.poll[0];
  const ay = P.withers[1] - P.poll[1];
  const al = Math.hypot(ax, ay);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const role = roleAt(i);
      if (role !== COAT && role !== MANE && role !== MUZZLE && role !== EAR) continue;
      const along = ((x - P.poll[0]) * ax + (y - P.poll[1]) * ay) / al;
      // the portrait draws the neck longer than a side view: the crest from poll to withers spans
      // the strips' neck (uPoll -> uWithers) whatever its length in pixels
      u[i] = (P.uPoll - (along / al) * (P.uPoll - P.uWithers)) * P.H;
      v[i] = role === MANE ? -Math.max(0, fromCoat[i]!) : Math.max(0, fromMane[i]!);
      const head = x + P.headSlope * y < P.headCut;
      if (role === MANE) region[i] = GEO_REGION.mane;
      else if (head) {
        region[i] = GEO_REGION.face;
        p1[i] = Math.min(1, Math.max(0, (y - P.browY) / (P.noseY - P.browY)));
        p2[i] = Math.abs(x - (P.c0 + P.c1 * y)) * P.eScale;
      } else region[i] = GEO_REGION.body;
    }
  return { frames: 1, fw: S, fh: S, H: P.H, region, outside: new Uint8Array(n), p1, p2, u, v, src: new Int32Array(n).fill(-1), anchors: [{ rumpX: 0, back: 0, belly: 0 }] };
}
