/**
 * The 3D finish window: from 21 m out until the finale, the winner and every horse within a length
 * of it stay wholly inside the safe area (8 % side margins, clear of the HUD row and the bar) while
 * the camera hands over from the line shot to following the winner, on a phone and a desktop
 * stage, over several seeded races; and the camera only ever moves a little a frame (no snap).
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { fakeReplay } from "../dev/fakeReplay";
import { createReplaySampler, replayTiming } from "../sampleReplay";
import { FINISH_KEEP_WITHIN_M } from "./HD2DScene";
import { extents, inside, keepInSafeArea, safeArea, SOFT_STEP_M, type RunnerBox } from "./safeFrame";

const LANE_M = 1.25;

describe("3D finish: the winner and its company stay whole on screen (line shot to following the winner)", () => {
  for (const [W, H, label] of [
    [358, 320, "phone"],
    [1098, 615, "desktop"],
  ] as const)
    it(`${label}: every frame from 21 m to the finale, five races`, () => {
      const area = safeArea(W, H);
      for (const seed of [3, 7, 11, 19, 23]) {
        const replay = fakeReplay({ horses: 10, seed, distanceM: 1200, photoFinish: true });
        const L = replay.trackLengthMm / 1000;
        const sample = createReplaySampler(replay);
        const timing = replayTiming(replay);
        const winnerId = replay.result.finishOrder[0]!.horseId;
        const cam = new THREE.PerspectiveCamera(28, W / H, 0.5, 2000);
        const look = new THREE.Vector3(L, 0.9, -5);
        // the line shot: square to the line, 26 degrees up (three/shots.ts JUDGE_SHOT), as close as
        // the scene frames two leaders; then it follows the winner, lagging as an eased camera does
        const e = (26 * Math.PI) / 180;
        const D = 18;
        cam.position.set(L, 0.9 + Math.sin(e) * D, -5 + Math.cos(e) * D);
        cam.lookAt(look);
        const s = { v: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), from: new THREE.Vector3() };
        const dt = 1 / 30;
        let t21 = Infinity;
        let prev: THREE.Vector3 | null = null;
        let checked = 0;
        for (let t = timing.winnerTime - 4; t < timing.winnerTime + 3; t += dt) {
          const h = sample(t);
          const lead = Math.max(...h.map((x) => x.x / 1000));
          if (L - lead <= 21) t21 = Math.min(t21, t);
          const w = h.find((x) => x.horseId === winnerId)!;
          const wx = w.x / 1000;
          // after the line the shot turns to follow the winner, easing (half the gap a second)
          if (t > timing.winnerTime + 0.9) {
            const step = (wx + 4 - look.x) * (1 - Math.exp(-dt * 0.7));
            look.x += step;
            cam.position.x += step;
            cam.lookAt(look);
          }
          const box = (x: (typeof h)[number]): RunnerBox => ({ x: x.x / 1000, y: 0, z: -x.lane * LANE_M });
          // as the scene: horses within two lengths are brought in gently ahead of time
          if (L - lead <= 21 + 2 * FINISH_KEEP_WITHIN_M) keepInSafeArea(cam, look, h.filter((x) => Math.abs(x.x / 1000 - wx) <= 2 * FINISH_KEEP_WITHIN_M).map(box), area, s, SOFT_STEP_M);
          if (t < t21) continue;
          const keep = h.filter((x) => Math.abs(x.x / 1000 - wx) <= FINISH_KEEP_WITHIN_M).map(box);
          keepInSafeArea(cam, look, keep, area, s);
          const ex = extents(cam, keep, s.v);
          expect(inside(ex, area), `seed ${seed} ${label} t=${t.toFixed(2)} ${JSON.stringify(ex)}`).toBe(true);
          if (prev) expect(cam.position.distanceTo(prev), `seed ${seed} t=${t.toFixed(2)} camera step`).toBeLessThan(1.2);
          prev = cam.position.clone();
          checked++;
        }
        expect(checked).toBeGreaterThan(60);
      }
    });
});
