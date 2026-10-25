/**
 * Sprite-sheet horse renderer (stub until PixelLab / manual art is approved).
 *
 * Uses an approved `horse.body.gallop` manifest entry: a horizontal strip of
 * `frameCount` frames, anchored at the nose tip on the ground. The frame is
 * chosen from the stride phase, so the sheet stays in sync with ground speed.
 * While the sheet loads (or if it fails) it shows the procedural horse.
 */
import { AnimatedSprite, Assets, Container, Rectangle, Texture } from "pixi.js";
import type { AssetEntry } from "@thoroughbred/art-pipeline";
import type { ReplayHorse } from "@thoroughbred/shared";
import type { HorsePose, HorseRenderer, HorseVisual, HorseVisualOptions } from "./HorseRenderer";
import type { LegId } from "./gait";
import { ProceduralHorseRenderer } from "./ProceduralHorseRenderer";

/** Centimetres covered by one frame width (nose-to-tail plus margin). */
const FRAME_WORLD_CM = 320;

class AtlasHorse implements HorseVisual {
  readonly view = new Container();
  private sprite: AnimatedSprite | null = null;
  private fallback: HorseVisual;
  rise = 0;

  constructor(entry: AssetEntry, frames: Promise<Texture[]>, fallback: HorseVisual) {
    this.fallback = fallback;
    this.view.addChild(fallback.view);
    frames
      .then((textures) => {
        if (this.view.destroyed || textures.length === 0) return;
        const s = new AnimatedSprite({ textures, autoPlay: false });
        s.anchor.set(entry.anchor.x, entry.anchor.y);
        s.scale.set(FRAME_WORLD_CM / entry.frameWidth);
        this.sprite = s;
        this.view.removeChild(fallback.view);
        this.view.addChild(s);
      })
      .catch(() => {
        /* keep the procedural fallback */
      });
  }

  update(pose: HorsePose): void {
    this.fallback.update(pose);
    this.rise = this.fallback.rise;
    if (this.sprite) {
      const n = this.sprite.totalFrames;
      this.sprite.gotoAndStop(Math.floor((pose.phase - Math.floor(pose.phase)) * n) % n);
    }
  }

  hoofX(leg: LegId): number {
    return this.fallback.hoofX(leg);
  }

  destroy(): void {
    this.fallback.destroy();
    this.view.destroy({ children: true });
  }
}

export class AtlasHorseRenderer implements HorseRenderer {
  readonly kind = "atlas" as const;
  private procedural = new ProceduralHorseRenderer();
  private frames: Promise<Texture[]>;

  constructor(private entry: AssetEntry) {
    if (!entry.src) throw new Error(`AtlasHorseRenderer needs an approved entry with src (${entry.id})`);
    this.frames = Assets.load<Texture>(entry.src).then((sheet) => {
      const out: Texture[] = [];
      for (let i = 0; i < entry.frameCount; i++) {
        out.push(
          new Texture({
            source: sheet.source,
            frame: new Rectangle(i * entry.frameWidth, 0, entry.frameWidth, entry.frameHeight),
          }),
        );
      }
      return out;
    });
  }

  create(horse: ReplayHorse, opts: HorseVisualOptions): HorseVisual {
    return new AtlasHorse(this.entry, this.frames, this.procedural.create(horse, opts));
  }

  destroy(): void {}
}
