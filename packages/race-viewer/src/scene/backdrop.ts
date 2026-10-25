/**
 * Everything behind the track: sky, clouds, far hills (0.1), skyline (0.2),
 * grandstand + trees + flags (0.4) and the apron grass in front of them.
 */
import { Container, Graphics, Sprite, TilingSprite, type Texture } from "pixi.js";
import type { Weather } from "@thoroughbred/shared";
import type { Projection } from "./projection";
import {
  WEATHER_LOOKS,
  cloudTexture,
  grandstandTexture,
  hillsTexture,
  skyTexture,
  skylineTexture,
  treeTexture,
  type WeatherLook,
} from "./textures";
import { hex, rng } from "./draw";

const MID = 0.4;
const FLAG_COLORS = [0xc8102e, 0xf2c230, 0x1d3f8f, 0xffffff, 0x0f6b3a, 0xe8457c];

interface Prop {
  sprite: Sprite;
  layerX: number;
  heightH: number;
}

export class Backdrop {
  readonly view = new Container();
  readonly look: WeatherLook;
  private sky: Sprite;
  private clouds: TilingSprite;
  private hills: TilingSprite;
  private skyline: TilingSprite;
  private stand: TilingSprite;
  private standShadow = new Graphics();
  private flags = new Graphics();
  private apron = new Graphics();
  private props: Prop[] = [];
  private textures: Texture[] = [];
  private standFrom: number;
  private standTo: number;

  constructor(weather: Weather, finishX: number, quality: "high" | "low") {
    this.look = WEATHER_LOOKS[weather];
    const look = this.look;
    const t = (tex: Texture) => (this.textures.push(tex), tex);
    this.sky = new Sprite(t(skyTexture(look)));
    this.clouds = new TilingSprite({ texture: t(cloudTexture(look, 11)), width: 10, height: 10 });
    this.hills = new TilingSprite({ texture: t(hillsTexture(look, 21)), width: 10, height: 10 });
    this.skyline = new TilingSprite({ texture: t(skylineTexture(look, 31)), width: 10, height: 10 });
    this.stand = new TilingSprite({ texture: t(grandstandTexture(look, 41)), width: 10, height: 10 });
    // The grandstand lines the home straight; trees elsewhere.
    this.standFrom = finishX * MID - 70;
    this.standTo = finishX * MID + 26;
    const trees = [0, 1, 2].map((i) => t(treeTexture(look, 51 + i)));
    const r = rng(61);
    const step = quality === "high" ? 7 : 12;
    for (let L = -40; L < finishX * MID + 80; L += step + r() * step) {
      if (L > this.standFrom - 6 && L < this.standTo + 4) continue;
      const s = new Sprite(trees[Math.floor(r() * trees.length)]!);
      s.anchor.set(0.5, 1);
      this.props.push({ sprite: s, layerX: L, heightH: 0.13 + r() * 0.09 });
    }
    this.view.addChild(this.sky, this.clouds, this.hills, this.skyline);
    for (const p of this.props) this.view.addChild(p.sprite);
    this.view.addChild(this.standShadow, this.stand, this.flags, this.apron);
    this.clouds.alpha = look.cloudAlpha;
  }

  /** Top of the apron grass (bottom of the background layers). */
  apronTop(p: Projection): number {
    return p.y(0) - p.H * 0.05 * p.zoomV;
  }

  update(p: Projection, time: number): void {
    const { W, H } = p;
    const base = this.apronTop(p);
    this.sky.width = W;
    this.sky.height = Math.max(base + 4, H * 0.62);

    const strip = (s: TilingSprite, factor: number, heightPx: number, bottom: number, drift = 0) => {
      const tex = s.texture;
      const scale = heightPx / tex.height;
      s.width = W;
      s.height = heightPx;
      s.y = bottom - heightPx;
      s.tileScale.set(scale);
      const period = tex.width * scale;
      const off = W * p.anchor - p.camX * factor * p.ppm * p.layerZoom(factor) + drift;
      s.tilePosition.x = ((off % period) + period) % period;
    };
    strip(this.clouds, 0.03, H * 0.42, H * 0.46, time * 6);
    strip(this.hills, 0.1, H * 0.27 * p.layerZoom(0.1), base + H * 0.012);
    strip(this.skyline, 0.2, H * 0.15 * p.layerZoom(0.2), base + 2);

    // Grandstand: a tiling module clipped to its span and to the screen.
    const z = p.layerZoom(MID);
    const standH = H * 0.25 * z;
    const x0 = p.layerX(this.standFrom, MID);
    const x1 = p.layerX(this.standTo, MID);
    const vis0 = Math.max(0, x0);
    const vis1 = Math.min(W, x1);
    const tex = this.stand.texture;
    const scale = standH / tex.height;
    this.stand.visible = vis1 > vis0;
    this.standShadow.clear();
    if (this.stand.visible) {
      this.stand.x = vis0;
      this.stand.width = vis1 - vis0;
      this.stand.height = standH;
      this.stand.y = base - standH + 2;
      this.stand.tileScale.set(scale);
      const period = tex.width * scale;
      this.stand.tilePosition.x = (((x0 - vis0) % period) + period) % period;
      this.standShadow.rect(vis0, base - 6, vis1 - vis0, 10).fill({ color: 0x000000, alpha: 0.25 });
    }

    // Trees.
    for (const pr of this.props) {
      const sx = p.layerX(pr.layerX, MID);
      const h = H * pr.heightH * z;
      const w = h * 0.8;
      const vis = sx > -w && sx < W + w;
      pr.sprite.visible = vis;
      if (!vis) continue;
      pr.sprite.position.set(sx, base + 2);
      pr.sprite.width = w;
      pr.sprite.height = h;
    }

    // Flags on the stand roof.
    this.flags.clear();
    if (this.stand.visible) {
      const roofY = base - standH + 2 + standH * (26 / 300);
      let i = 0;
      for (let L = this.standFrom + 4; L < this.standTo; L += 9, i++) {
        const fx = p.layerX(L, MID);
        if (fx < -40 || fx > W + 40) continue;
        const pole = standH * 0.2;
        this.flags.rect(fx - 0.8, roofY - pole, 1.6, pole).fill(0xdedede);
        const fw = pole * 0.62;
        const fh = pole * 0.36;
        const top = roofY - pole;
        const wave = (u: number) => Math.sin(time * 5 + i * 1.7 - u * 5) * fh * 0.16 * u;
        const pts: number[] = [];
        for (let k = 0; k <= 6; k++) pts.push(fx + (fw * k) / 6, top + wave(k / 6));
        for (let k = 6; k >= 0; k--) pts.push(fx + (fw * k) / 6, top + fh + wave(k / 6));
        this.flags.poly(pts).fill(FLAG_COLORS[i % FLAG_COLORS.length]!);
      }
    }

    // Apron grass from the stand base to the inner rail.
    const railY = p.y(-0.03);
    this.apron.clear();
    this.apron.rect(0, base, W, railY - base + 2).fill(hex(this.look.apron));
    this.apron.rect(0, base, W, Math.max(2, (railY - base) * 0.35)).fill({ color: 0x000000, alpha: 0.12 });
  }

  destroy(): void {
    this.view.destroy({ children: true });
    for (const t of this.textures) t.destroy(true);
  }
}
