/**
 * The runner's body build and mane / tail on the palette-index strips (Trackside and the 3D
 * view share the horse shader): per-runner uniforms, and per draw the frame's build landmarks
 * (art-pipeline bodyBuild.ts) and the runner's build in whole texels of that strip. The CPU
 * painter (every other view) warps with the same landmarks and numbers.
 */
import type * as THREE from "three";
import type { HorseAppearance } from "@thoroughbred/shared";
import { bodyBuildOf, buildTexels, hairLevels, hairStyleOf, isFlat, type BuildTexels } from "@thoroughbred/art-pipeline";
import type { StripSet } from "./art";

/**
 * Whether race views warp bodies on the GPU (shaders.ts BODY_SHAPE). Off by default: the warp
 * shader reset Windows graphics drivers (Direct3D) and the browser then blocked WebGL for the
 * site. `?build=gpu` turns it on for testing. Builds still show in every CPU-painted view.
 */
export function gpuBodyShape(): boolean {
  const loc = (globalThis as { location?: { search?: string } }).location;
  return /[?&]build=gpu(&|$)/.test(loc?.search ?? "");
}

/** Uniform defaults (no build, no hair style): the strip as painted. */
export function shapeUniforms(three: typeof THREE, a: HorseAppearance): Record<string, THREE.IUniform> {
  const h = hairStyleOf(a);
  const lv = h ? hairLevels(h) : null;
  return {
    uWarpA: { value: new three.Vector4(0, 0, 0, 0) },
    uWarpB: { value: new three.Vector4(0, 0, 0, 1) },
    uWarpC: { value: new three.Vector4(1, 1, 0, 0) },
    uBuild: { value: new three.Vector4(0, 0, 0, 0) },
    uHair: { value: new three.Vector4(lv?.mane ?? 0, lv?.tail ?? 0, lv?.thick ? 1 : 0, h?.wave ? 1 : 0) },
    uHairOn: { value: h ? 1 : 0 },
  };
}

/** One runner's build in texels per strip (cached). */
export class RunnerShape {
  private cache = new Map<StripSet, BuildTexels>();
  constructor(private readonly appearance: HorseAppearance) {}

  texels(st: StripSet): BuildTexels {
    let t = this.cache.get(st);
    if (!t) {
      t = buildTexels(bodyBuildOf(this.appearance), st.warp);
      this.cache.set(st, t);
    }
    return t;
  }

  /** Set the per-draw build uniforms for a strip frame. */
  apply(u: Record<string, THREE.IUniform>, st: StripSet, frame: number): void {
    const t = this.texels(st);
    const fr = st.warp.frames[frame];
    const on = !!fr && !isFlat(t);
    const l0 = st.lods[0]!;
    (u.uBuild!.value as THREE.Vector4).set(t.L, t.G, t.NK, on ? 1 : 0);
    if (!fr) return;
    (u.uWarpA!.value as THREE.Vector4).set(fr.ok, fr.seam, fr.ground, fr.rumpX);
    (u.uWarpB!.value as THREE.Vector4).set(fr.crest, fr.face0, fr.other0, st.warp.H);
    (u.uWarpC!.value as THREE.Vector4).set(l0.fw, l0.fh, fr.chest, fr.lift);
  }
}
