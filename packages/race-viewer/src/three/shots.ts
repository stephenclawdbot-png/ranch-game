/**
 * Framing of two 3D shots the visual research (2026-11-01) asked to fix (pure numbers; the scene
 * fits each shot's box with them). Angles in degrees: `elev` above the track, `yaw` the camera's
 * swing about the vertical (0 = square side-on from the near side, + = ahead of the subject
 * looking back), `fill*` the share of the frame the shot's box may fill.
 */

/**
 * V-09, the stalls at the off: low and ahead of the doors, looking back across the stall fronts,
 * so each stall's runner shows through its open doors and the lanes spread across the frame (a
 * square side-on view stacks twelve stalls behind the near one). `elevPre` is added before the off.
 */
export const GATE_SHOT = { elev: 9, elevPre: 3, elevNarrow: 24, yaw: 50, fov: 24, fillX: 0.96, fillY: 0.86, composeShift: 0.08 } as const;

/**
 * V-10, the judge's shot at the line: square to the line (it stays a vertical stripe) and high
 * enough that neighbouring lanes separate on screen, so two leaders level at the line show both
 * noses instead of one horse drawn over the other. `reach`: runners within this of the line (m)
 * are in the shot (phones: only the battle at the line, so the noses are not a few pixels each).
 */
export const JUDGE_SHOT = { elev: 26, yaw: 0, fov: 28, fillX: 0.8, fillY: 0.66, composeShift: 0.04, reach: 5, reachPhone: 2.6 } as const;

/**
 * Vertical screen separation (px) of two points `laneGapM` apart across the track, seen by a
 * camera `elevDeg` above the track at distance `D` (m) with vertical field of view `vfovDeg` on a
 * stage `H` px tall. (Across-track depth shows on screen in proportion to sin(elevation).)
 */
export function laneSeparationPx(elevDeg: number, D: number, vfovDeg: number, H: number, laneGapM: number): number {
  const pxPerM = H / (2 * D * Math.tan((vfovDeg * Math.PI) / 360));
  return laneGapM * Math.sin((elevDeg * Math.PI) / 180) * pxPerM;
}
