/**
 * The whole 2.5D race picture. Owns every Pixi object; the React component only
 * feeds it a race time, a camera mode and the canvas size.
 *
 * Layers, back to front:
 *   backdrop (sky 0, clouds 0.03, hills 0.1, skyline 0.2, stand/trees/flags 0.4, apron)
 *   track surface mesh (perspective-mapped turf stripes / dirt)
 *   furniture.back (finish line, inner rail, furlong poles, winning post)
 *   ground (contact shadows, highlight ring)
 *   field (depth-sorted: horses, stall partitions, hoof particles)
 *   gate roof, furniture.front (outer rail), hedge (1.25), rain, marker, vignette, flash
 */
import { Container, Graphics, Sprite, TilingSprite, type Application, type Texture } from "pixi.js";
import { FURLONG_MM, type RaceReplay } from "@thoroughbred/shared";
import { resolveAsset, type AssetManifest } from "@thoroughbred/art-pipeline";
import { createReplaySampler, replayTiming, type HorseSample, type ReplaySampler } from "../sampleReplay";
import { Backdrop } from "./backdrop";
import { Spring } from "./camera";
import { clamp, hex, lerp, mix, rng, smoothstep } from "./draw";
import { HoofParticles, Rain } from "./particles";
import { Projection, laneDepth } from "./projection";
import { StartingGate, T_OUTER_RAIL, TrackFurniture, TrackSurface } from "./track";
import {
  clodTexture,
  hedgeTexture,
  silksTexture,
  softDotTexture,
  streakTexture,
  vignetteTexture,
} from "./textures";
import { AtlasHorseRenderer } from "./horse/AtlasHorseRenderer";
import { ProceduralHorseRenderer } from "./horse/ProceduralHorseRenderer";
import type { HorseRenderer, HorseVisual } from "./horse/HorseRenderer";
import { legPhase, strideLengthM, type LegId } from "./horse/gait";

import type { CameraMode, RenderQuality } from "../types";
export type { CameraMode, RenderQuality };

export interface RaceSceneOptions {
  quality: RenderQuality;
  highlightHorseId?: string;
  manifest?: AssetManifest;
}

export interface SceneFrame {
  /** Race time (s); may be negative (pre-race) or past the end (pull-up). */
  time: number;
  /** Real seconds since the last render (camera smoothing). */
  realDt: number;
  camera: CameraMode;
  /** Photo freeze: hold the picture. */
  frozen: boolean;
  /** 0..1 white camera flash. */
  flash: number;
}

/** Seconds for a finished horse's speed to decay by 1/e while pulling up. */
const PULLUP_TAU = 2.6;
const LEGS: LegId[] = ["HL", "HR", "FL", "FR"];

interface Runner {
  index: number;
  horseId: string;
  visual: HorseVisual;
  shadow: Sprite;
  phase: number;
  lastX: number;
  depth: number;
  visX: number;
  visSpeed: number;
  drive: number;
  finishT: number | null;
  finishSpeed: number;
  kickT: number | null;
  prevLeg: number[];
  rand: () => number;
  baseTint: number;
}

function mulTint(a: number, b: number): number {
  const ch = (s: number) => Math.round((((a >> s) & 255) * ((b >> s) & 255)) / 255);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export class RaceScene {
  readonly root = new Container();
  readonly proj = new Projection();
  private replay: RaceReplay;
  private sampler: ReplaySampler;
  private samples: HorseSample[] = [];
  private backdrop: Backdrop;
  private surface: TrackSurface;
  private furniture: TrackFurniture;
  private gate: StartingGate;
  private ground = new Container();
  private field = new Container();
  private hedge: TilingSprite;
  private rain: Rain | null = null;
  private particles: HoofParticles;
  private marker = new Graphics();
  private ring = new Graphics();
  private vignette: Sprite;
  private flash = new Graphics();
  private overlay = new Container();
  private runners: Runner[] = [];
  private renderer: HorseRenderer;
  private textures: Texture[] = [];
  private camX: Spring;
  private camZoom: Spring;
  private lastTime = Number.NaN;
  private firstFrame = true;
  private animTime = 0;
  private quality: RenderQuality;
  private highlight: number;
  private trackM: number;
  private laneCount: number;
  private winnerTime: number;
  /** Camera x velocity estimate (m/s), for rain drift. */
  private camVel = 0;

  constructor(
    private app: Application,
    replay: RaceReplay,
    opts: RaceSceneOptions,
  ) {
    this.replay = replay;
    this.quality = opts.quality;
    this.sampler = createReplaySampler(replay);
    this.trackM = replay.trackLengthMm / 1000;
    this.laneCount = Math.max(2, replay.laneCount);
    this.winnerTime = replayTiming(replay).winnerTime;
    this.highlight = replay.horses.findIndex((h) => h.horseId === opts.highlightHorseId);
    const tex = <T extends Texture>(t: T) => (this.textures.push(t), t);

    this.backdrop = new Backdrop(replay.race.weather, this.trackM, opts.quality);
    const look = this.backdrop.look;
    this.surface = new TrackSurface(look, replay.race.surface);
    this.furniture = new TrackFurniture(this.trackM);

    // Starting stalls: one per lane up to the widest starting lane.
    const start = this.sampler(0);
    const maxLane = Math.max(0, ...start.map((s) => Math.round(s.lane)));
    const laneDepths: number[] = [];
    const bounds: number[] = [];
    for (let l = 0; l <= maxLane; l++) laneDepths.push(laneDepth(l, this.laneCount));
    for (let l = -0.5; l <= maxLane + 0.5; l += 1) bounds.push(laneDepth(l, this.laneCount));
    this.gate = new StartingGate(bounds, laneDepths);

    this.field.sortableChildren = true;
    for (const g of this.gate.partitions) this.field.addChild(g);

    const dot = tex(softDotTexture());
    const dustColor = replay.race.surface === "turf" ? hex(look.turfB) : mix(hex(look.dirt), 0xffffff, 0.25);
    const clodColor = replay.race.surface === "turf" ? hex(look.turfA) : hex(look.dirt);
    this.particles = new HoofParticles(this.field, replay.race.surface, dot, tex(clodTexture()), opts.quality === "high" ? 320 : 110, dustColor, clodColor);
    this.particles.density = opts.quality === "high" ? 1 : 0.45;

    // Horses.
    const hr = opts.manifest ? resolveAsset(opts.manifest, "horse.body.gallop") : null;
    this.renderer = hr && !hr.fallback && hr.entry ? new AtlasHorseRenderer(hr.entry) : new ProceduralHorseRenderer();
    const timing = replayTiming(replay);
    const finishByHorse = new Map(replay.result.finishOrder.map((f) => [f.horseId, f.finishTimeUs / 1e6]));
    const kicks = new Map<string, number>();
    for (const ev of replay.events) {
      if (ev.type === "kick" && ev.horseId && !kicks.has(ev.horseId)) kicks.set(ev.horseId, ev.tick / replay.tickHz);
    }
    replay.horses.forEach((h, i) => {
      const visual = this.renderer.create(h, { silksTexture: tex(silksTexture(h.appearance.silks)), quality: opts.quality });
      const shadow = new Sprite(dot);
      shadow.anchor.set(0.5);
      shadow.tint = 0x000000;
      this.ground.addChild(shadow);
      this.field.addChild(visual.view);
      const ft = finishByHorse.get(h.horseId) ?? null;
      const fs = ft !== null ? this.sampler(Math.max(0, Math.min(ft - 0.05, timing.lastFrameTime)))[i]!.speed / 1000 : 0;
      this.runners.push({
        index: i,
        horseId: h.horseId,
        visual,
        shadow,
        phase: rng(i * 977 + 13)(),
        lastX: Number.NaN,
        depth: 0.5,
        visX: 0,
        visSpeed: 0,
        drive: 0,
        finishT: ft,
        finishSpeed: Math.max(fs, 8),
        kickT: kicks.get(h.horseId) ?? null,
        prevLeg: [0, 0, 0, 0],
        rand: rng(i * 7919 + 1),
        baseTint: 0xffffff,
      });
    });

    this.hedge = new TilingSprite({ texture: tex(hedgeTexture(look, 91)), width: 10, height: 10 });
    if (replay.race.weather === "rain") {
      this.rain = new Rain(tex(streakTexture()), opts.quality === "high" ? 240 : 90);
    }

    // Highlight marker: gold chevron above the jockey + ring on the ground.
    this.marker
      .poly([-14, -22, 14, -22, 0, 0])
      .fill(0xf2c230)
      .stroke({ width: 3, color: 0x2a1d05, alpha: 0.85, join: "round" });
    this.marker.poly([-8, -18, 8, -18, 0, -8]).fill({ color: 0xffffff, alpha: 0.35 });
    this.ring.ellipse(0, 0, 100, 100).stroke({ width: 10, color: 0xf2c230, alpha: 0.9 });
    this.ground.addChild(this.ring);
    this.marker.visible = this.ring.visible = this.highlight >= 0;

    this.vignette = new Sprite(tex(vignetteTexture()));
    this.vignette.alpha = replay.race.weather === "dusk" ? 0.6 : replay.race.weather === "rain" ? 0.55 : 0.38;

    this.overlay.addChild(this.marker);
    this.root.addChild(
      this.backdrop.view,
      this.surface.mesh,
      this.furniture.back,
      this.ground,
      this.field,
      this.gate.roof,
      this.furniture.front,
      this.hedge,
    );
    if (this.rain) this.root.addChild(this.rain.view);
    this.root.addChild(this.overlay, this.vignette, this.flash);
    app.stage.addChild(this.root);

    this.camX = new Spring(0, 3.2);
    this.camZoom = new Spring(0.85, 2.2);
    this.applyTints();
  }

  private applyTints(): void {
    const look = this.backdrop.look;
    for (const r of this.runners) r.baseTint = look.tint;
  }

  setQuality(q: RenderQuality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.particles.density = q === "high" ? 1 : 0.45;
    this.rain?.setCount(q === "high" ? 240 : 90);
  }

  resize(W: number, H: number): void {
    this.proj.setSize(W, H);
  }

  /** Field samples from the last render (shared array; read-only). */
  get lastSamples(): readonly HorseSample[] {
    return this.samples;
  }

  render(f: SceneFrame): void {
    const p = this.proj;
    const raceT = f.time;
    const tS = Math.max(0, raceT);
    let simDt = Number.isNaN(this.lastTime) ? 0 : raceT - this.lastTime;
    const seek = Math.abs(simDt) > 0.6 || simDt < -1e-9;
    if (seek) {
      simDt = 0;
      this.particles.clear();
    }
    if (f.frozen) simDt = 0;
    this.lastTime = raceT;
    this.animTime += simDt;

    this.samples = this.sampler(tS, this.samples);
    const L = this.trackM;
    const furlong = FURLONG_MM / 1000;

    // --- Runner state -------------------------------------------------------
    let leadX = -1e9;
    let lastX = 1e9;
    let leadSpeed = 0;
    for (const r of this.runners) {
      const s = this.samples[r.index]!;
      if (r.finishT !== null && tS > r.finishT) {
        const dtp = tS - r.finishT;
        const e = Math.exp(-dtp / PULLUP_TAU);
        r.visX = L + r.finishSpeed * PULLUP_TAU * (1 - e);
        r.visSpeed = r.finishSpeed * e;
      } else {
        r.visX = s.x / 1000;
        r.visSpeed = raceT < 0 ? 0 : s.speed / 1000;
      }
      r.depth = laneDepth(s.lane, this.laneCount);
      if (r.visX > leadX) {
        leadX = r.visX;
        leadSpeed = r.visSpeed;
      }
      lastX = Math.min(lastX, r.visX);
    }

    // --- Camera ---------------------------------------------------------------
    const W = p.W;
    const halfAt1 = (W * 0.5) / (p.ppm * 0.91);
    let mode = f.camera;
    if (mode === "mine" && this.highlight < 0) mode = "leader";
    let targetX: number;
    let targetZoom: number;
    let targetVel = leadSpeed;
    const toGo = L - leadX;
    if (raceT < 0.6) {
      targetZoom = 0.8;
      targetX = (halfAt1 / 0.8) * 0.3 - 1.5;
      targetVel = 0;
    } else if (mode === "wide") {
      const spread = Math.max(8, leadX - lastX + 7);
      targetZoom = clamp((halfAt1 * 2 * 0.86) / spread, 0.42, 0.95);
      targetX = (leadX + lastX) / 2 - 1.2;
    } else {
      // Gentle zoom out at the start, settle, zoom in through the final furlong.
      const early = smoothstep(0.6, 5, raceT);
      const late = toGo < furlong ? smoothstep(furlong, 25, toGo) : 0;
      const post = tS > this.winnerTime ? smoothstep(this.winnerTime, this.winnerTime + 2.5, tS) : 0;
      targetZoom = lerp(0.8, 1, early) + 0.14 * late * (1 - post);
      const focus = mode === "mine" ? this.runners[this.highlight]! : null;
      const fx = focus ? focus.visX : leadX;
      if (focus) targetVel = focus.visSpeed;
      const half = halfAt1 / targetZoom;
      targetX = fx - half * (focus ? 0.1 : 0.3) - 1.1;
      // Once the winner is home, hold the line so the rest of the field is seen finishing.
      if (post > 0 && !focus) {
        targetX = lerp(targetX, L + half * 0.12, post);
        targetVel *= 1 - post;
      }
    }
    const realDt = Math.min(0.1, Math.max(0, f.realDt));
    if (seek || this.firstFrame) {
      this.firstFrame = false;
      this.camX.snap(targetX);
      this.camZoom.snap(targetZoom);
    }
    const prevCam = this.camX.x;
    this.camX.step(targetX, f.frozen ? 0 : realDt, f.frozen ? 0 : targetVel * (simDt > 0 && realDt > 0 ? simDt / realDt : 0));
    this.camZoom.step(targetZoom, f.frozen ? 0 : realDt);
    this.camVel = realDt > 0 ? (this.camX.x - prevCam) / realDt : 0;
    p.camX = this.camX.x;
    p.zoom = this.camZoom.x;

    // --- Static layers ----------------------------------------------------------
    this.backdrop.update(p, this.animTime);
    this.surface.update(p);
    this.furniture.update(p);
    this.gate.update(p, clamp(raceT / 0.35, 0, 1));

    // --- Horses -------------------------------------------------------------------
    const look = this.backdrop.look;
    const haze = hex(look.haze);
    for (const r of this.runners) {
      const t = r.depth;
      const k = p.k(t);
      const sx = p.x(r.visX, t);
      const gy = p.y(t);
      const view = r.visual.view;
      const onScreen = sx > -60 && sx - 3.2 * k < W + 60;
      view.visible = onScreen;
      r.shadow.visible = onScreen;

      // Gait: phase advances with distance travelled, so planted hooves never slide.
      const speed = r.visSpeed;
      const stride = strideLengthM(Math.max(speed, 6));
      if (seek || Number.isNaN(r.lastX)) r.lastX = r.visX;
      const dx = r.visX - r.lastX;
      r.lastX = r.visX;
      if (dx > 0 && dx < 5) r.phase += dx / stride;
      const gallop = smoothstep(1.2, 9, speed);

      // Jockey drive: rousting after a kick, riding out through the final furlong.
      const finished = r.finishT !== null && tS >= r.finishT;
      const remaining = L - r.visX;
      const kicked = r.kickT !== null && tS >= r.kickT;
      let driveTarget = 0;
      if (!finished && raceT > 0) {
        if (remaining < furlong) driveTarget = kicked ? 1 : 0.7;
        else if (kicked) driveTarget = 0.55;
      }
      r.drive += (driveTarget - r.drive) * (1 - Math.exp(-4 * simDt));

      if (onScreen) {
        r.visual.update({ phase: r.phase, strideM: stride, gallop, drive: r.drive, time: this.animTime, speedMs: speed });
        view.position.set(sx, gy);
        view.scale.set(k / 100);
        view.zIndex = t * 1000 + r.index * 0.01;
        // Far lanes sit in more haze.
        const hz = (1 - t) * 0.28;
        view.tint = mulTint(r.baseTint, mix(0xffffff, haze, hz));
        // Contact shadow: under the barrel, shrinks as the body rises.
        const rise = r.visual.rise;
        r.shadow.position.set(sx - 1.25 * k, gy + 0.03 * k);
        r.shadow.width = (2.5 - rise * 0.01) * k;
        r.shadow.height = 0.42 * k;
        r.shadow.alpha = look.shadowAlpha * (1 - rise * 0.02);

        // Hoof strikes kick up dust / turf.
        if (simDt > 0 && speed > 4) {
          for (let li = 0; li < 4; li++) {
            const leg = LEGS[li]!;
            const ph = legPhase(r.phase, leg);
            if (ph < r.prevLeg[li]! && (this.quality === "high" || li % 2 === 1)) {
              this.particles.strike(r.visX + r.visual.hoofX(leg) / 100, t + (li % 2 ? 0.01 : -0.01), speed, r.rand);
            }
            r.prevLeg[li] = ph;
          }
        }
      }
    }
    this.particles.update(simDt, p);

    // --- Highlight ---------------------------------------------------------------
    if (this.highlight >= 0) {
      const r = this.runners[this.highlight]!;
      const t = r.depth;
      const k = p.k(t);
      const sx = p.x(r.visX - 1.0, t);
      const bob = Math.sin(this.animTime * 4) * 0.06 * k + Math.sin(performance.now() / 300) * 2;
      this.marker.position.set(sx + 0.15 * k, p.y(t) - 2.6 * k - bob);
      const ms = clamp(k / 55, 0.55, 1.2);
      this.marker.scale.set(ms);
      this.ring.position.set(p.x(r.visX - 1.25, t), p.y(t) + 0.03 * k);
      this.ring.scale.set((1.45 * k) / 100, (0.24 * k) / 100);
      this.ring.alpha = 0.55 + 0.25 * Math.sin(performance.now() / 260);
    }

    // --- Foreground ---------------------------------------------------------------
    const H = p.H;
    const hz = 1.25;
    const hedgeTop = p.y(T_OUTER_RAIL) - 0.55 * p.k(T_OUTER_RAIL);
    const hTex = this.hedge.texture;
    const hh = Math.max(8, H - hedgeTop + 4);
    const hs = (H * 0.2 * p.layerZoom(hz)) / hTex.height;
    this.hedge.width = W;
    this.hedge.height = hh;
    this.hedge.y = hedgeTop;
    this.hedge.tileScale.set(hs);
    const period = hTex.width * hs;
    const off = W * p.anchor - p.camX * hz * p.ppm * p.zoom;
    this.hedge.tilePosition.set(((off % period) + period) % period, 0);

    if (this.rain) this.rain.update(f.frozen ? 0 : realDt, W, H, this.camVel * p.ppm);
    this.vignette.width = W;
    this.vignette.height = H;
    this.flash.clear();
    if (f.flash > 0) this.flash.rect(0, 0, W, H).fill({ color: 0xffffff, alpha: Math.min(1, f.flash) * 0.85 });
  }

  /** World x of the camera centre and zoom (for debug overlays). */
  get cameraInfo(): { x: number; zoom: number } {
    return { x: this.camX.x, zoom: this.camZoom.x };
  }

  destroy(): void {
    this.particles.destroy();
    this.rain?.destroy();
    for (const r of this.runners) r.visual.destroy();
    this.renderer.destroy();
    this.backdrop.destroy();
    this.surface.destroy();
    this.furniture.destroy();
    this.gate.destroy();
    this.root.destroy({ children: true });
    for (const t of this.textures) t.destroy(true);
    this.textures = [];
    void this.app;
  }
}
