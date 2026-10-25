import type { Container, Texture } from "pixi.js";
import type { ReplayHorse } from "@thoroughbred/shared";
import type { LegId } from "./gait";

/** Everything a horse renderer needs to pose one frame. */
export interface HorsePose {
  /** Stride phase 0..1, driven by distance travelled. */
  phase: number;
  /** Current stride length (m); the stance sweep matches it so hooves never slide. */
  strideM: number;
  /** 0 = standing, 1 = full gallop. */
  gallop: number;
  /** 0..1 jockey drive (arms pumping in the final furlong when kicking). */
  drive: number;
  /** Seconds, for idle motion (tail swish, ear flicks). */
  time: number;
  speedMs: number;
}

export interface HorseVisual {
  /** Root container. Origin = nose tip at ground level; units = centimetres. */
  readonly view: Container;
  update(pose: HorsePose): void;
  /** Hoof ground x (cm, relative to the nose) of a leg after the last update. */
  hoofX(leg: LegId): number;
  /** Body rise (cm) after the last update, for the contact shadow. */
  readonly rise: number;
  destroy(): void;
}

export interface HorseVisualOptions {
  /** Silks texture already generated for this horse (pattern on primary/secondary). */
  silksTexture: Texture;
  quality: "high" | "low";
}

export interface HorseRenderer {
  readonly kind: "procedural" | "atlas";
  create(horse: ReplayHorse, opts: HorseVisualOptions): HorseVisual;
  destroy(): void;
}
