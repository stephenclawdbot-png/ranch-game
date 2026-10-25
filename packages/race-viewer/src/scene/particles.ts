/**
 * Pooled hoof particles (dust on dirt, clods + spray on turf) in world space,
 * plus screen-space rain. Particles live in each horse's depth slot so they sort
 * with the field.
 */
import { Container, Sprite, type Texture } from "pixi.js";
import type { Surface } from "@thoroughbred/shared";
import type { Projection } from "./projection";

interface P {
  sprite: Sprite;
  alive: boolean;
  x: number;
  t: number;
  h: number;
  vx: number;
  vh: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  gravity: number;
  alpha: number;
  spin: number;
}

export class HoofParticles {
  readonly view = new Container();
  private pool: P[] = [];

  constructor(
    private surface: Surface,
    private dot: Texture,
    private clod: Texture,
    capacity: number,
    private dustColor: number,
    private clodColor: number,
  ) {
    for (let i = 0; i < capacity; i++) {
      const sprite = new Sprite(dot);
      sprite.anchor.set(0.5);
      sprite.visible = false;
      this.view.addChild(sprite);
      this.pool.push({ sprite, alive: false, x: 0, t: 0, h: 0, vx: 0, vh: 0, life: 0, max: 1, size: 0.3, grow: 0, gravity: 0, alpha: 1, spin: 0 });
    }
  }

  private take(): P | null {
    for (const p of this.pool) if (!p.alive) return p;
    return null;
  }

  /** A hoof strike at world x / depth t, horse moving at `speed` m/s. */
  strike(x: number, t: number, speed: number, rand: () => number): void {
    const power = Math.min(1, speed / 15);
    if (power < 0.25) return;
    if (this.surface === "turf") {
      const n = rand() < 0.55 ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const p = this.take();
        if (!p) return;
        Object.assign(p, {
          alive: true,
          x,
          t: t + (rand() - 0.5) * 0.02,
          h: 0.05,
          vx: (-1.5 - rand() * 3) * power,
          vh: (1.8 + rand() * 2.4) * power,
          life: 0,
          max: 0.9,
          size: 0.07 + rand() * 0.07,
          grow: 0,
          gravity: 9.8,
          alpha: 0.95,
          spin: (rand() - 0.5) * 12,
        });
        p.sprite.texture = this.clod;
        p.sprite.tint = rand() < 0.5 ? this.clodColor : 0x4a3220;
      }
      const s = this.take();
      if (s) {
        Object.assign(s, { alive: true, x, t, h: 0.05, vx: -1.2, vh: 0.5, life: 0, max: 0.45, size: 0.22, grow: 0.9, gravity: 0, alpha: 0.28, spin: 0 });
        s.sprite.texture = this.dot;
        s.sprite.tint = this.clodColor;
      }
    } else {
      const n = rand() < 0.5 ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const p = this.take();
        if (!p) return;
        Object.assign(p, {
          alive: true,
          x: x - rand() * 0.3,
          t: t + (rand() - 0.5) * 0.02,
          h: 0.08 + rand() * 0.1,
          vx: (-0.8 - rand() * 1.6) * power,
          vh: (0.35 + rand() * 0.6) * power,
          life: 0,
          max: 0.9 + rand() * 0.7,
          size: 0.28 + rand() * 0.22,
          grow: 1.1 + rand() * 0.8,
          gravity: 0.4,
          alpha: 0.42,
          spin: 0,
        });
        p.sprite.texture = this.dot;
        p.sprite.tint = this.dustColor;
      }
    }
  }

  update(dt: number, proj: Projection): void {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life += dt;
      p.vh -= p.gravity * dt;
      p.x += p.vx * dt;
      p.h += p.vh * dt;
      p.vx *= Math.exp(-1.6 * dt);
      p.size += p.grow * dt;
      if (p.life >= p.max || p.h < -0.02) {
        p.alive = false;
        p.sprite.visible = false;
        continue;
      }
      const k = proj.k(p.t);
      const s = p.sprite;
      s.visible = true;
      s.position.set(proj.x(p.x, p.t), proj.y(p.t) - Math.max(0, p.h) * k);
      const px = p.size * k;
      s.width = px;
      s.height = px * (p.gravity > 5 ? 0.8 : 0.7);
      s.rotation += p.spin * dt;
      s.alpha = p.alpha * (1 - p.life / p.max);
    }
  }

  clear(): void {
    for (const p of this.pool) {
      p.alive = false;
      p.sprite.visible = false;
    }
  }
}

export class Rain {
  readonly view = new Container();
  private drops: { s: Sprite; x: number; y: number; v: number; len: number }[] = [];

  constructor(streak: Texture, count: number) {
    for (let i = 0; i < count; i++) {
      const s = new Sprite(streak);
      s.anchor.set(0.5, 1);
      s.alpha = 0.22 + Math.random() * 0.25;
      s.rotation = 0.18;
      this.view.addChild(s);
      this.drops.push({ s, x: Math.random(), y: Math.random(), v: 0.9 + Math.random() * 0.6, len: 0.04 + Math.random() * 0.05 });
    }
  }

  update(dt: number, W: number, H: number, camVel: number): void {
    for (const d of this.drops) {
      d.y += d.v * dt * 1.4;
      d.x -= (0.25 + camVel * 0.004) * dt * d.v;
      if (d.y > 1.05) {
        d.y -= 1.1;
        d.x = Math.random() * 1.2;
      }
      if (d.x < -0.05) d.x += 1.1;
      d.s.position.set(d.x * W, d.y * H);
      d.s.height = d.len * H;
      d.s.width = Math.max(1, H / 500);
    }
  }
}
