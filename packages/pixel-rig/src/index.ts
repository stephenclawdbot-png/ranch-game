/**
 * @thoroughbred/pixel-rig: code-driven HD-2D pixel horses.
 * Contract consumed by @thoroughbred/race-viewer (see docs/art-direction.md, "Pixel rig pipeline").
 */
import type { WebGLRenderer, Texture, Vector3 } from "three";
import type { HorseAppearance } from "@thoroughbred/shared";

export interface HorseRigState {
  /** Gait phase 0..1 (one full stride), driven by distance travelled. */
  phase: number;
  /** Ground speed, m/s (affects stride extension, head nod, tail flow). */
  speedMs: number;
  /** 0..1 how hard the jockey is pushing (final-furlong drive). */
  drive: number;
  /** World-space direction *towards* the sun, normalised. */
  lightDir: Vector3;
  /** Seconds since start, for secondary motion (mane/tail). */
  time: number;
}

export interface HorseRig {
  /** Low-res, nearest-filtered colour texture of the current pose (transparent background). */
  readonly texture: Texture;
  /** Native pixel size of the texture. */
  readonly width: number;
  readonly height: number;
  /** Ground contact point in texture pixels (for billboard placement + shadow). */
  readonly anchor: { x: number; y: number };
  /** Render the current pose into `texture`. */
  update(renderer: WebGLRenderer, state: HorseRigState): void;
  dispose(): void;
}

export interface HorseRigFactory {
  /** Resolves when source art (if any) is loaded; falls back to code-generated parts if missing. */
  ready(): Promise<void>;
  create(appearance: HorseAppearance, opts?: { gate?: number }): HorseRig;
  dispose(): void;
}

import { PixelHorseRigFactory, type HorseRigFactoryOptions } from "./runtime";

/**
 * Create the rig factory. `artBaseUrl` (default "/art") is where `rig/horse-rig.json` and its
 * atlases live; if they are missing the factory keeps using code-generated parts.
 * Extra options (render-target size, lighting tweaks...) are documented in README.md.
 */
export function createHorseRigFactory(opts?: { artBaseUrl?: string } & HorseRigFactoryOptions): HorseRigFactory {
  return new PixelHorseRigFactory(opts);
}

export { PixelHorseRigFactory, PixelHorseRig, DEFAULT_LIGHTING } from "./runtime";
export type { HorseRigFactoryOptions, HorseRigStateExtras, RigLighting } from "./runtime";
export * from "./morph";
export * from "./ramp";
export * from "./rigdef";
export {
  GaitRig,
  IDLE,
  WALK,
  CANTER,
  GALLOP,
  LEGS,
  gaitForSpeed,
  sampleLeg,
  solveTwoBone,
  createSecondaryState,
} from "./gait";
export type { GaitPreset, LegId, LegSample, Pose, PoseInput, Skeleton, SkeletonPart, SecondaryState } from "./gait";
export { generateFallbackRig } from "./fallback";
