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

export declare function createHorseRigFactory(opts?: { artBaseUrl?: string }): HorseRigFactory;
