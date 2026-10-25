/**
 * The racing surface and its furniture: perspective-mapped turf/dirt mesh,
 * inner rail with furlong poles and the winning post (behind the horses),
 * the outer rail (in front), and the starting stalls (depth-sorted with horses).
 */
import { Container, Graphics, MeshSimple, Text, type Texture } from "pixi.js";
import { FURLONG_MM, type Surface } from "@thoroughbred/shared";
import type { Projection } from "./projection";
import { TRACK_TILE_M, trackTexture, type WeatherLook } from "./textures";

const ROWS = 28;
const T_TOP = -0.03;
const T_BOTTOM = 1.09;
export const T_INNER_RAIL = -0.035;
export const T_OUTER_RAIL = 1.05;
const LABEL_STYLE = { fontFamily: "Arial, Helvetica, sans-serif", fontWeight: "800" as const, fill: 0xffffff };

export class TrackSurface {
  readonly mesh: MeshSimple;
  private texture: Texture;
  private positions: Float32Array;
  private uvs: Float32Array;

  constructor(look: WeatherLook, surface: Surface) {
    this.texture = trackTexture(look, surface, 77);
    const n = (ROWS + 1) * 2;
    this.positions = new Float32Array(n * 2);
    this.uvs = new Float32Array(n * 2);
    const indices = new Uint32Array(ROWS * 6);
    for (let r = 0; r < ROWS; r++) {
      const a = r * 2;
      indices.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], r * 6);
    }
    this.mesh = new MeshSimple({ texture: this.texture, vertices: this.positions, uvs: this.uvs, indices });
  }

  update(p: Projection): void {
    for (let r = 0; r <= ROWS; r++) {
      const t = T_TOP + ((T_BOTTOM - T_TOP) * r) / ROWS;
      const y = p.y(t);
      const v = Math.min(0.995, Math.max(0.005, t));
      const i = r * 4;
      this.positions[i] = 0;
      this.positions[i + 1] = y;
      this.positions[i + 2] = p.W;
      this.positions[i + 3] = y;
      this.uvs[i] = p.worldXAt(0, t) / TRACK_TILE_M;
      this.uvs[i + 1] = v;
      this.uvs[i + 2] = p.worldXAt(p.W, t) / TRACK_TILE_M;
      this.uvs[i + 3] = v;
    }
    this.mesh.geometry.getBuffer("aPosition").update();
    this.mesh.geometry.getBuffer("aUV").update();
  }

  destroy(): void {
    this.mesh.destroy();
    this.texture.destroy(true);
  }
}

/** Visible world-x range at depth t, padded. */
function visibleRange(p: Projection, t: number, pad = 2): [number, number] {
  return [p.worldXAt(0, t) - pad, p.worldXAt(p.W, t) + pad];
}

function drawRail(g: Graphics, p: Projection, t: number, height: number, spacing: number, near: boolean): void {
  const k = p.k(t);
  const base = p.y(t);
  const top = base - height * k;
  const [x0, x1] = visibleRange(p, t);
  // Shadow on the grass.
  g.rect(0, base - 0.04 * k, p.W, 0.12 * k).fill({ color: 0x000000, alpha: 0.18 });
  const postW = Math.max(1, 0.07 * k);
  for (let x = Math.floor(x0 / spacing) * spacing; x <= x1; x += spacing) {
    const sx = p.x(x, t);
    g.rect(sx - postW / 2, top + 0.05 * k, postW, base - top).fill(near ? 0xe9e9e6 : 0xd9dbd8);
    g.rect(sx + postW / 2 - Math.max(0.6, postW * 0.35), top + 0.05 * k, Math.max(0.6, postW * 0.35), base - top).fill({ color: 0x000000, alpha: 0.18 });
  }
  const barH = Math.max(1.5, 0.12 * k);
  g.rect(0, top, p.W, barH).fill(0xffffff);
  g.rect(0, top + barH * 0.62, p.W, barH * 0.38).fill({ color: 0x000000, alpha: 0.14 });
}

export interface TrackDecor {
  back: Container;
  front: Container;
}

/** Inner rail, poles, winning post, finish line (back) + outer rail and stall roof (front). */
export class TrackFurniture {
  readonly back = new Container();
  readonly front = new Container();
  private gBack = new Graphics();
  private gFront = new Graphics();
  private poleLabels: { text: Text; x: number; label: string }[] = [];
  private finishX: number;

  constructor(trackLengthM: number) {
    this.finishX = trackLengthM;
    this.back.addChild(this.gBack);
    this.front.addChild(this.gFront);
    const furlong = FURLONG_MM / 1000;
    for (let i = 1; trackLengthM - i * furlong > 1; i++) {
      const text = new Text({ text: `${i}f`, style: { ...LABEL_STYLE, fontSize: 28 }, resolution: 2 });
      text.anchor.set(0.5);
      this.back.addChild(text);
      this.poleLabels.push({ text, x: trackLengthM - i * furlong, label: `${i}f` });
    }
  }

  update(p: Projection): void {
    const g = this.gBack;
    g.clear();
    // Finish line painted across the track.
    const L = this.finishX;
    const ta = -0.03;
    const tb = T_OUTER_RAIL;
    const hw = 0.13;
    if (p.x(L, 1) > -50 && p.x(L, 0) < p.W + 50) {
      g.poly([p.x(L - hw, ta), p.y(ta), p.x(L + hw, ta), p.y(ta), p.x(L + hw, tb), p.y(tb), p.x(L - hw, tb), p.y(tb)]).fill({ color: 0xffffff, alpha: 0.85 });
    }
    drawRail(g, p, T_INNER_RAIL, 0.95, 2.5, false);

    // Furlong poles on the inner rail.
    const tr = T_INNER_RAIL - 0.005;
    const k = p.k(tr);
    const base = p.y(tr);
    for (const pl of this.poleLabels) {
      const sx = p.x(pl.x, tr);
      const vis = sx > -60 && sx < p.W + 60;
      pl.text.visible = vis;
      if (!vis) continue;
      const h = 2.3 * k;
      const w = Math.max(1.5, 0.11 * k);
      g.rect(sx - w / 2, base - h, w, h).fill(0xf4f4f2);
      for (let s = 0; s < 4; s++) g.rect(sx - w / 2, base - h + (h * s) / 4, w, h / 12).fill(0xc8102e);
      const bw = 0.95 * k;
      const bh = 0.62 * k;
      g.roundRect(sx - bw / 2, base - h - bh, bw, bh, bh * 0.18).fill(0x0f3b28);
      g.roundRect(sx - bw / 2, base - h - bh, bw, bh, bh * 0.18).stroke({ width: Math.max(1, 0.04 * k), color: 0xf4f4f2 });
      pl.text.position.set(sx, base - h - bh / 2);
      pl.text.scale.set((bh * 0.62) / 28);
    }

    // Winning post: red/white pole with the roundel.
    const sxF = p.x(L, tr);
    if (sxF > -80 && sxF < p.W + 80) {
      const h = 4.4 * k;
      const w = Math.max(2, 0.16 * k);
      g.rect(sxF - w / 2, base - h, w, h).fill(0xffffff);
      for (let s = 0; s < 11; s += 2) g.rect(sxF - w / 2, base - h + (h * s) / 11, w, h / 11).fill(0xd71920);
      const R = 0.55 * k;
      g.circle(sxF, base - h - R * 0.6, R).fill(0xd71920);
      g.circle(sxF, base - h - R * 0.6, R * 0.62).fill(0xffffff);
      g.circle(sxF, base - h - R * 0.6, R * 0.2).fill(0xd71920);
    }

    // Front: outer rail + near winning post.
    const f = this.gFront;
    f.clear();
    drawRail(f, p, T_OUTER_RAIL, 1.0, 2.5, true);
    const sxN = p.x(L, T_OUTER_RAIL);
    if (sxN > -80 && sxN < p.W + 80) {
      const kn = p.k(T_OUTER_RAIL);
      const bn = p.y(T_OUTER_RAIL);
      const h = 1.9 * kn;
      const w = Math.max(2, 0.14 * kn);
      f.rect(sxN - w / 2, bn - h, w, h).fill(0xffffff);
      for (let s = 0; s < 7; s += 2) f.rect(sxN - w / 2, bn - h + (h * s) / 7, w, h / 7).fill(0xd71920);
    }
  }

  destroy(): void {
    this.back.destroy({ children: true });
    this.front.destroy({ children: true });
  }
}

/**
 * Starting stalls. Each partition is its own display object so it can be
 * depth-sorted between horses; the roof beam is drawn in front of everything.
 */
export class StartingGate {
  readonly partitions: Graphics[] = [];
  readonly roof = new Container();
  private roofG = new Graphics();
  private numbers: Text[] = [];

  constructor(
    private boundaries: number[],
    private laneDepths: number[],
  ) {
    for (let i = 0; i < boundaries.length; i++) {
      const g = new Graphics();
      g.zIndex = boundaries[i]!;
      this.partitions.push(g);
    }
    this.roof.addChild(this.roofG);
    laneDepths.forEach((_, i) => {
      const t = new Text({ text: String(i + 1), style: { ...LABEL_STYLE, fontSize: 26 }, resolution: 2 });
      t.anchor.set(0.5);
      this.numbers.push(t);
      this.roof.addChild(t);
    });
  }

  update(p: Projection, open: number): void {
    const BACK = -3.3;
    const FRONT = 0.25;
    const visible = p.x(BACK - 1, 0) < p.W && p.x(FRONT + 1, 1) > 0;
    this.roof.visible = visible;
    for (const g of this.partitions) {
      g.clear();
      g.visible = visible;
    }
    this.roofG.clear();
    if (!visible) return;
    const green = 0x1f6b45;
    const dark = 0x123d28;
    this.boundaries.forEach((t, i) => {
      const g = this.partitions[i]!;
      const k = p.k(t);
      const y = p.y(t);
      const xb = p.x(BACK, t);
      const xf = p.x(FRONT, t);
      // Padded lower panel + pipe frame.
      g.rect(xb, y - 1.45 * k, xf - xb, 0.95 * k).fill(green);
      g.rect(xb, y - 1.45 * k, xf - xb, 0.12 * k).fill({ color: 0xffffff, alpha: 0.25 });
      const pipe = Math.max(1, 0.06 * k);
      g.rect(xb, y - 2.55 * k, pipe * 1.5, 2.55 * k).fill(0xe9ecea);
      g.rect(xf - pipe * 1.5, y - 2.55 * k, pipe * 1.5, 2.55 * k).fill(0xe9ecea);
      g.rect(xb, y - 2.0 * k, xf - xb, pipe).fill(0xe9ecea);
      g.rect(xb, y - 0.45 * k, xf - xb, pipe).fill(dark);
      // Front door of the stall in front of this partition (lane i-1 sits behind it).
      const lane = i - 1;
      if (lane >= 0 && lane < this.laneDepths.length && open < 1) {
        const ta = this.boundaries[i - 1]!;
        const tb = t;
        const doorX = (tt: number) => p.x(FRONT, tt);
        const swing = open;
        const hTop = 1.65;
        const hBot = 0.35;
        const tm = ta + (tb - ta) * (0.5 - 0.5 * swing);
        const tm2 = tb - (tb - ta) * (0.5 - 0.5 * swing);
        g.poly([doorX(ta), p.y(ta) - hTop * p.k(ta), doorX(tm), p.y(tm) - hTop * p.k(tm), doorX(tm), p.y(tm) - hBot * p.k(tm), doorX(ta), p.y(ta) - hBot * p.k(ta)]).fill(
          0x2a8a5a,
        );
        g.poly([doorX(tm2), p.y(tm2) - hTop * p.k(tm2), doorX(tb), p.y(tb) - hTop * p.k(tb), doorX(tb), p.y(tb) - hBot * p.k(tb), doorX(tm2), p.y(tm2) - hBot * p.k(tm2)]).fill(
          0x247a4f,
        );
      }
    });
    // Roof beam across all stalls (front edge), with stall numbers.
    const t0 = this.boundaries[0]!;
    const t1 = this.boundaries[this.boundaries.length - 1]!;
    const beam = (x: number, tt: number, h: number) => [p.x(x, tt), p.y(tt) - h * p.k(tt)];
    this.roofG
      .poly([...beam(BACK, t0, 2.95), ...beam(FRONT, t0, 2.95), ...beam(FRONT, t1, 2.95), ...beam(BACK, t1, 2.95)])
      .fill({ color: 0x174f34, alpha: 0.9 });
    this.roofG.poly([...beam(FRONT, t0, 2.95), ...beam(FRONT, t1, 2.95), ...beam(FRONT, t1, 2.55), ...beam(FRONT, t0, 2.55)]).fill(0x2f9a63);
    this.laneDepths.forEach((t, i) => {
      const txt = this.numbers[i]!;
      const k = p.k(t);
      txt.position.set(p.x(FRONT, t), p.y(t) - 2.75 * k);
      txt.scale.set((0.3 * k) / 26);
    });
  }

  destroy(): void {
    for (const g of this.partitions) g.destroy();
    this.roof.destroy({ children: true });
  }
}
