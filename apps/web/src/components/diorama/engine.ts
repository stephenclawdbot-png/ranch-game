/**
 * HD-2D diorama renderer (Canvas2D, client only).
 *
 * Pixel integrity: every sprite and sharp layer is drawn with nearest filtering at an INTEGER
 * number of backing pixels per art pixel (`k`), and the canvas itself is upscaled by an integer
 * factor (`m`) with `image-rendering: pixelated`. Depth of field, bloom, light shafts, motes and
 * the grade are separate passes layered on top (or pre-blurred copies of far/near layers), so
 * the focal band stays tack sharp.
 *
 * Cost per frame: one drawImage per layer (+1 per bloomed layer), one per animated sprite and
 * shadow, a few dozen 1-px motes, 2 ray sprites, a vignette sprite. All blurs are baked once.
 */
import { applyRecolor, lookKey, recolorMap } from "./recolor";
import type { AnimItem, Layer, Overlay, RaySet, SceneDef, StaticItem } from "./scenes";

const MARGIN = 96; // art px of bake margin on each side of a non-repeating layer
const ART = "/art/";

type Cnv = HTMLCanvasElement;
interface Baked {
  def: Layer;
  canvas: Cnv;
  /** Offset of canvas (0,0) from the layer's world origin, in art px (blur padding). */
  ox: number;
  oy: number;
  /** Width covered by one repeat (period layers) or 0. */
  period: number;
  bloom: { canvas: Cnv; ox: number; oy: number; scale: number } | null;
  sway: { item: StaticItem; img: HTMLImageElement }[];
  sharp: boolean;
}
interface Sprite {
  def: AnimItem;
  strip: Cnv | HTMLImageElement;
  with: Sprite[];
}
interface OverlayBaked {
  def: Overlay;
  canvas: Cnv;
  pad: number;
}

export interface EngineStats {
  fps: number;
  frameMs: number;
  frames: number;
  k: number;
  m: number;
  quality: "high" | "low";
}

const isBrowser = typeof document !== "undefined";
function canvas(w: number, h: number): Cnv {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}
function ctx2d(c: Cnv): CanvasRenderingContext2D {
  const x = c.getContext("2d");
  if (!x) throw new Error("2d context unavailable");
  return x;
}

let filterOk: boolean | null = null;
function canFilter(): boolean {
  if (filterOk !== null) return filterOk;
  try {
    const c = canvas(8, 8);
    const x = ctx2d(c);
    x.filter = "blur(2px)";
    filterOk = x.filter === "blur(2px)";
    if (filterOk) {
      x.fillStyle = "#fff";
      x.fillRect(3, 3, 2, 2);
      const d = x.getImageData(0, 0, 8, 8).data;
      // the blurred rect must have leaked onto a corner-adjacent pixel
      filterOk = d[(1 * 8 + 1) * 4 + 3]! > 0;
    }
  } catch {
    filterOk = false;
  }
  return filterOk;
}

/** Gaussian-ish blur of a canvas (ctx.filter where supported, otherwise a down/up-sample chain). */
function blurred(src: Cnv, r: number): { canvas: Cnv; pad: number } {
  const pad = Math.ceil(r * 3);
  const out = canvas(src.width + pad * 2, src.height + pad * 2);
  const x = ctx2d(out);
  if (canFilter()) {
    x.filter = `blur(${r}px)`;
    x.drawImage(src, pad, pad);
    x.filter = "none";
  } else {
    const f = Math.max(2, Math.round(r * 1.6));
    const small = canvas(out.width / f, out.height / f);
    const sx = ctx2d(small);
    sx.imageSmoothingEnabled = true;
    sx.imageSmoothingQuality = "high";
    sx.drawImage(src, pad / f, pad / f, src.width / f, src.height / f);
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = "high";
    x.drawImage(small, 0, 0, out.width, out.height);
  }
  return { canvas: out, pad };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.decoding = "async";
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`diorama: failed to load ${src}`));
    im.src = ART + src;
  });
}

function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Width of one tile of an item. */
const itemW = (it: StaticItem, im: HTMLImageElement) => (it.rect ? it.rect[2] : im.width);
const itemH = (it: StaticItem, im: HTMLImageElement) => (it.rect ? it.rect[3] : im.height);

function drawItem(x: CanvasRenderingContext2D, it: StaticItem, im: HTMLImageElement, dx: number, dy: number) {
  const [sx, sy, sw, sh] = it.rect ?? [0, 0, im.width, im.height];
  x.globalAlpha = it.alpha ?? 1;
  if (it.flip) {
    x.save();
    x.translate(dx + sw, dy);
    x.scale(-1, 1);
    x.drawImage(im, sx, sy, sw, sh, 0, 0, sw, sh);
    x.restore();
  } else x.drawImage(im, sx, sy, sw, sh, dx, dy, sw, sh);
  x.globalAlpha = 1;
}

function shadowBlob(x: CanvasRenderingContext2D, cx: number, cy: number, w: number, a = 0.32) {
  const h = Math.max(3, w * 0.12);
  const g = x.createRadialGradient(cx, cy, 0, cx, cy, w / 2);
  g.addColorStop(0, `rgba(20,10,4,${a})`);
  g.addColorStop(0.6, `rgba(20,10,4,${a * 0.55})`);
  g.addColorStop(1, "rgba(20,10,4,0)");
  x.save();
  x.translate(cx, cy);
  x.scale(1, h / (w / 2));
  x.translate(-cx, -cy);
  x.fillStyle = g;
  x.beginPath();
  x.arc(cx, cy, w / 2, 0, Math.PI * 2);
  x.fill();
  x.restore();
}

export class DioramaEngine {
  readonly scene: SceneDef;
  private readonly el: Cnv;
  private readonly ctx: CanvasRenderingContext2D;
  private images = new Map<string, HTMLImageElement>();
  private layers: Baked[] = [];
  private sprites = new Map<Layer, Sprite[]>();
  private overlays: OverlayBaked[] = [];
  private sky: Cnv | null = null;
  private skyTop = "#000";
  private rays: { a: Cnv; b: Cnv; pad: number; def: RaySet }[] = [];
  private sun: Cnv | null = null;
  private bokeh: Cnv | null = null;
  private vignette: Cnv | null = null;
  private swayBuf: Cnv | null = null;
  // view
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private k = 1; // backing px per art px
  private m = 1; // css upscale of the backing store (device px per backing px)
  private viewW = 0; // art px
  private viewH = 0;
  private vx = 0;
  private vy = 0;
  // motion
  private raf = 0;
  private running = false;
  private last = 0;
  private time = 0;
  private parTarget = { x: 0, y: 0 };
  private par = { x: 0, y: 0 };
  private motes: Float32Array = new Float32Array(0); // x, y, z, phase, speed per mote
  private dust: Float32Array = new Float32Array(0); // x, y, vx, vy, life per particle
  private dustN = 0;
  private quality: "high" | "low" = "high";
  private frameTimes: number[] = [];
  private frames = 0;
  private destroyed = false;
  readonly reduced: boolean;

  constructor(el: Cnv, scene: SceneDef, opts: { reducedMotion: boolean; quality?: "high" | "low" }) {
    this.el = el;
    this.scene = scene;
    this.ctx = ctx2d(el);
    this.reduced = opts.reducedMotion;
    this.quality = opts.quality ?? "high";
    this.time = scene.posterT;
  }

  // ------------------------------------------------------------------ loading + baking
  async load(): Promise<void> {
    const files = new Set<string>();
    const s = this.scene;
    if (s.sky.src) files.add(s.sky.src);
    const addA = (a: AnimItem) => {
      files.add(a.src);
      a.with?.forEach(addA);
    };
    for (const l of s.layers) {
      l.items.forEach((i) => files.add(i.src));
      l.anims?.forEach(addA);
    }
    s.overlays?.forEach((o) => files.add(o.src));
    await Promise.all([...files].map(async (f) => this.images.set(f, await loadImage(f))));
    if (this.destroyed) return;
    this.bake();
  }

  private img(src: string): HTMLImageElement {
    const im = this.images.get(src);
    if (!im) throw new Error(`diorama: missing ${src}`);
    return im;
  }

  private bake() {
    const s = this.scene;
    // sky: mirror-doubled so it can drift forever without a seam
    if (s.sky.src) {
      const im = this.img(s.sky.src);
      this.sky = canvas(im.width * 2, im.height);
      const x = ctx2d(this.sky);
      x.drawImage(im, 0, 0);
      x.save();
      x.translate(im.width * 2, 0);
      x.scale(-1, 1);
      x.drawImage(im, 0, 0);
      x.restore();
      // flat colour that continues the sky upwards (average of its top rows)
      const d = x.getImageData(0, 0, im.width, 6).data;
      let r = 0;
      let g = 0;
      let b = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i]!;
        g += d[i + 1]!;
        b += d[i + 2]!;
      }
      this.skyTop = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
    }
    for (const l of s.layers) this.layers.push(this.bakeLayer(l));
    for (const l of s.layers) this.sprites.set(l, (l.anims ?? []).map((a) => this.sprite(a)));
    for (const o of s.overlays ?? []) {
      const im = this.img(o.src);
      const c = canvas(im.width, im.height);
      const x = ctx2d(c);
      if (o.flip) {
        x.translate(im.width, 0);
        x.scale(-1, 1);
      }
      x.drawImage(im, 0, 0);
      this.darken(c, 0.25);
      const b = blurred(c, o.blur);
      this.overlays.push({ def: o, canvas: b.canvas, pad: b.pad });
    }
    this.rays = s.rays.map((r) => ({ ...this.bakeRays(r), def: r }));
    // sun glow + bokeh disc sprites
    this.sun = canvas(128, 128);
    {
      const x = ctx2d(this.sun);
      const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, s.sun.color);
      g.addColorStop(0.18, s.sun.color + "cc");
      g.addColorStop(0.5, s.sun.color + "33");
      g.addColorStop(1, s.sun.color + "00");
      x.fillStyle = g;
      x.fillRect(0, 0, 128, 128);
    }
    this.bokeh = canvas(32, 32);
    {
      const x = ctx2d(this.bokeh);
      const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, s.motes.glow + "aa");
      g.addColorStop(0.55, s.motes.glow + "66");
      g.addColorStop(0.8, s.motes.glow + "22");
      g.addColorStop(1, s.motes.glow + "00");
      x.fillStyle = g;
      x.fillRect(0, 0, 32, 32);
    }
    this.vignette = canvas(160, 90);
    {
      const x = ctx2d(this.vignette);
      const g = x.createRadialGradient(80, 50, 20, 80, 50, 100);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(0.55, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(8,4,2,${s.grade.vignette})`);
      x.fillStyle = g;
      x.fillRect(0, 0, 160, 90);
    }
    this.seedMotes();
  }

  /** Multiply toward black (out-of-focus foreground is in shadow). */
  private darken(c: Cnv, a: number) {
    const x = ctx2d(c);
    x.globalCompositeOperation = "source-atop";
    x.fillStyle = `rgba(16,8,4,${a})`;
    x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = "source-over";
  }

  private bakeLayer(l: Layer): Baked {
    const s = this.scene;
    const period = l.period ?? 0;
    const w = period || s.width + MARGIN * 2;
    const ox = period ? 0 : -MARGIN; // world x of canvas x=0
    const h = l.y1 - l.y0;
    const c = canvas(w, h);
    const x = ctx2d(c);
    x.imageSmoothingEnabled = false;
    for (const f of l.fills ?? []) {
      const g = x.createLinearGradient(0, f.y0 - l.y0, 0, f.y1 - l.y0);
      for (const [o, col] of f.stops) g.addColorStop(o, col);
      x.fillStyle = g;
      x.fillRect(0, f.y0 - l.y0, w, f.y1 - f.y0);
    }
    for (const hole of l.holes ?? []) {
      const [hx, hy, hw, hh] = hole.rect;
      const g = x.createLinearGradient(0, hy - l.y0, 0, hy + hh - l.y0);
      g.addColorStop(0, hole.color);
      g.addColorStop(1, "#2a1a10");
      x.fillStyle = g;
      x.fillRect(hx - ox, hy - l.y0, hw, hh);
    }
    const sway: Baked["sway"] = [];
    for (const it of l.items) {
      const im = this.img(it.src);
      if (it.sway) {
        sway.push({ item: it, img: im });
        continue;
      }
      const iw = itemW(it, im);
      const ih = itemH(it, im);
      const top = it.y - ih - l.y0;
      if (it.shadow) shadowBlob(x, it.x - ox + iw / 2, it.y - l.y0 - 1, it.shadow);
      if (it.tile) {
        const step = iw + (it.gap ?? 0);
        let start = it.x - ox;
        start = ((start % step) + step) % step - step;
        for (let px = start; px < w; px += step) drawItem(x, it, im, Math.round(px), top);
      } else if (period) {
        // wrap items that cross the repeat seam
        for (const off of [-period, 0, period]) drawItem(x, it, im, it.x + off, top);
      } else drawItem(x, it, im, it.x - ox, top);
    }
    for (const f of l.shade ?? []) {
      const g = x.createLinearGradient(0, f.y0 - l.y0, 0, f.y1 - l.y0);
      for (const [o, col] of f.stops) g.addColorStop(o, col);
      x.fillStyle = g;
      x.globalCompositeOperation = "source-atop";
      x.fillRect(0, f.y0 - l.y0, w, f.y1 - f.y0);
      x.globalCompositeOperation = "source-over";
    }
    if (l.haze) {
      x.globalCompositeOperation = "source-atop";
      x.globalAlpha = l.haze;
      x.fillStyle = s.fog;
      x.fillRect(0, 0, w, h);
      x.globalAlpha = 1;
      x.globalCompositeOperation = "source-over";
    }
    let bloom: Baked["bloom"] = null;
    if (l.bloom && !period && this.quality === "high") {
      bloom = this.bakeBloom(c, l.bloom);
      if (bloom) bloom.ox += ox; // world x of the bloom canvas origin
    }
    if (l.blur && l.blur > 0 && !period) {
      const b = blurred(c, l.blur);
      return { def: l, canvas: b.canvas, ox: ox - b.pad, oy: -b.pad, period, bloom, sway, sharp: false };
    }
    if (l.blur && l.blur > 0 && period) {
      // blur a 3-wide repeat and keep the middle one, so the seam stays continuous
      const tri = canvas(w * 3, h);
      const tx = ctx2d(tri);
      for (let i = 0; i < 3; i++) tx.drawImage(c, i * w, 0);
      const b = blurred(tri, l.blur);
      const mid = canvas(w, h + b.pad * 2);
      ctx2d(mid).drawImage(b.canvas, -(w + b.pad), 0);
      return { def: l, canvas: mid, ox, oy: -b.pad, period, bloom, sway, sharp: false };
    }
    return { def: l, canvas: c, ox, oy: 0, period, bloom, sway, sharp: true };
  }

  private bakeBloom(src: Cnv, strength: number): Baked["bloom"] {
    const f = 2;
    const small = canvas(src.width / f, src.height / f);
    const sx = ctx2d(small);
    sx.imageSmoothingEnabled = true;
    sx.drawImage(src, 0, 0, small.width, small.height);
    const d = sx.getImageData(0, 0, small.width, small.height);
    const p = d.data;
    const T = 178;
    for (let i = 0; i < p.length; i += 4) {
      const lum = p[i]! * 0.299 + p[i + 1]! * 0.587 + p[i + 2]! * 0.114;
      const k = lum > T ? Math.min(1, ((lum - T) / (255 - T)) * 1.6) * strength : 0;
      p[i + 3] = Math.round(p[i + 3]! * k);
    }
    sx.putImageData(d, 0, 0);
    const b = blurred(small, 3);
    return { canvas: b.canvas, ox: -b.pad * f, oy: -b.pad * f, scale: f };
  }

  private bakeRays(r: RaySet): { a: Cnv; b: Cnv; pad: number } {
    const make = (seed: number) => {
      const rnd = rand(seed);
      const size = r.length * 2;
      const c = canvas(size, size);
      const x = ctx2d(c);
      const cx = size / 2;
      const cy = size / 2;
      for (let i = 0; i < r.count; i++) {
        const ang = ((r.angle + (rnd() - 0.5) * r.spread) * Math.PI) / 180;
        const len = r.length * (0.6 + rnd() * 0.4);
        const w0 = r.width * (0.15 + rnd() * 0.25);
        const w1 = r.width * (0.7 + rnd() * 0.9);
        const nx = -Math.sin(ang);
        const ny = Math.cos(ang);
        const ex = cx + Math.cos(ang) * len;
        const ey = cy + Math.sin(ang) * len;
        const g = x.createLinearGradient(cx, cy, ex, ey);
        const a = 0.35 + rnd() * 0.65;
        g.addColorStop(0, r.color + "00");
        g.addColorStop(0.08, r.color + Math.round(a * 255).toString(16).padStart(2, "0"));
        g.addColorStop(0.55, r.color + Math.round(a * 120).toString(16).padStart(2, "0"));
        g.addColorStop(1, r.color + "00");
        x.fillStyle = g;
        x.beginPath();
        x.moveTo(cx + nx * w0, cy + ny * w0);
        x.lineTo(ex + nx * w1, ey + ny * w1);
        x.lineTo(ex - nx * w1, ey - ny * w1);
        x.lineTo(cx - nx * w0, cy - ny * w0);
        x.closePath();
        x.fill();
      }
      return blurred(c, 6);
    };
    const a = make(r.seed);
    const b = make(r.seed + 101);
    return { a: a.canvas, b: b.canvas, pad: a.pad + r.length };
  }

  private recolored = new Map<string, Cnv | HTMLImageElement>();
  private sprite(a: AnimItem): Sprite {
    const key = `${a.src}|${a.look ? lookKey(a.look) : ""}|${a.flip ? 1 : 0}`;
    let strip = this.recolored.get(key);
    if (!strip) {
      const im = this.img(a.src);
      if (!a.look && !a.flip && !this.scene.sprites) strip = im;
      else {
        const c = canvas(im.width, im.height);
        const x = ctx2d(c);
        if (a.flip) {
          // flip each frame in place (keeps frame order)
          for (let f = 0; f < a.frames; f++) {
            x.save();
            x.translate(f * a.fw + a.fw, 0);
            x.scale(-1, 1);
            x.drawImage(im, f * a.fw, 0, a.fw, a.fh, 0, 0, a.fw, a.fh);
            x.restore();
          }
        } else x.drawImage(im, 0, 0);
        if (a.look) {
          const d = x.getImageData(0, 0, c.width, c.height);
          applyRecolor(d.data, recolorMap(a.look));
          x.putImageData(d, 0, 0);
        }
        this.gradeSprite(c);
        strip = c;
      }
      this.recolored.set(key, strip);
    }
    return { def: a, strip, with: (a.with ?? []).map((w) => this.sprite(w)) };
  }

  private gradeSprite(c: Cnv) {
    const g = this.scene.sprites;
    if (!g) return;
    const x = ctx2d(c);
    x.globalCompositeOperation = "source-atop";
    x.globalAlpha = g.alpha;
    x.fillStyle = g.color;
    x.fillRect(0, 0, c.width, c.height);
    x.globalAlpha = 1;
    x.globalCompositeOperation = "source-over";
  }

  private seedMotes() {
    const n = this.reduced ? Math.round(this.scene.motes.count * 0.5) : this.quality === "low" ? Math.round(this.scene.motes.count * 0.5) : this.scene.motes.count;
    const rnd = rand(7 + this.scene.id.length);
    this.motes = new Float32Array(n * 5);
    for (let i = 0; i < n; i++) {
      this.motes[i * 5] = rnd(); // x (0..1 of view)
      this.motes[i * 5 + 1] = rnd(); // y (0..1 of the mote band)
      this.motes[i * 5 + 2] = 0.35 + rnd() * 1.35; // depth
      this.motes[i * 5 + 3] = rnd() * Math.PI * 2;
      this.motes[i * 5 + 4] = 0.5 + rnd();
    }
    this.dust = new Float32Array(160 * 5);
    this.dustN = 0;
  }

  // ------------------------------------------------------------------ layout
  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.dpr = Math.max(1, dpr || 1);
    const devW = Math.round(this.cssW * this.dpr);
    const devH = Math.round(this.cssH * this.dpr);
    // device px per art px: aim for ~720 art px across, at most ~480 tall, at least 360 wide
    let s = Math.max(1, Math.round(devW / 720));
    while (devH / s > 480 && devW / (s + 1) >= 360) s++;
    // split s = k (backing px per art px) * m (css upscale), keeping the backing store small
    let m = 1;
    const budget = this.quality === "high" ? 1.6e6 : 0.5e6;
    for (const cand of [1, 2, 3, 4, 6]) {
      if (s % cand) continue;
      m = cand;
      if ((devW / cand) * (devH / cand) <= budget) break;
    }
    if (this.quality === "low") m = s; // backing = art resolution
    this.k = s / m;
    this.m = m;
    const bw = Math.round(devW / m);
    const bh = Math.round(devH / m);
    if (this.el.width !== bw || this.el.height !== bh) {
      this.el.width = bw;
      this.el.height = bh;
    }
    this.viewW = bw / this.k;
    this.viewH = bh / this.k;
    const W = this.scene.width;
    this.vx = W <= this.viewW ? (W - this.viewW) / 2 : Math.min(Math.max(this.scene.focusX - this.viewW / 2, 0), W - this.viewW);
    this.vy = Math.min(this.scene.height - this.viewH, this.scene.focusY - this.viewH * 0.5);
    this.swayBuf = null;
    if (!this.running) this.draw(this.time);
  }

  // ------------------------------------------------------------------ input
  setPointer(nx: number, ny: number): void {
    this.parTarget.x = Math.max(-1, Math.min(1, nx)) * 12;
    this.parTarget.y = Math.max(-1, Math.min(1, ny)) * 4;
  }
  setScroll(n: number): void {
    // n: -1 (element below the fold) .. 1 (scrolled past): a gentle vertical drift
    this.parTarget.y = Math.max(-1, Math.min(1, n)) * 6;
  }

  // ------------------------------------------------------------------ loop
  start(): void {
    if (this.running || this.reduced || this.destroyed) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      const dt = now - this.last;
      if (dt < 14) return; // cap at ~60 fps on high-refresh screens
      this.last = now;
      this.step(Math.min(dt, 50) / 1000);
      const t1 = performance.now();
      this.draw(this.time);
      this.track(dt, performance.now() - t1);
    };
    this.raf = requestAnimationFrame(tick);
  }
  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
  destroy(): void {
    this.stop();
    this.destroyed = true;
    this.images.clear();
    this.layers = [];
  }

  /** Draw a single still frame (reduced motion / poster). */
  renderStill(t = this.scene.posterT): void {
    this.time = t;
    this.par.x = this.par.y = 0;
    this.warmMotes(t);
    this.draw(t);
  }

  /** Render the whole world (1 backing px per art px) as the static poster frame; returns a PNG data URL. */
  posterDataUrl(): string {
    const { width: W, height: H } = this.scene;
    this.stop();
    this.el.width = W;
    this.el.height = H;
    this.k = 1;
    this.m = 1;
    this.viewW = W;
    this.viewH = H;
    this.vx = 0;
    this.vy = 0;
    this.renderStill();
    return this.el.toDataURL("image/png");
  }

  stats(): EngineStats {
    const n = this.frameTimes.length;
    const avg = n ? this.frameTimes.reduce((a, b) => a + b, 0) / n : 0;
    return { fps: avg ? 1000 / avg : 0, frameMs: this.lastDrawMs, frames: this.frames, k: this.k, m: this.m, quality: this.quality };
  }

  private lastDrawMs = 0;
  private track(dt: number, drawMs: number) {
    this.frames++;
    this.lastDrawMs = drawMs;
    if (dt > 100) return; // resumed after a pause: not a real frame time
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    // adaptive quality: sustained < 40 fps after warm-up -> drop to the light path once
    if (this.quality === "high" && this.frames > 120 && this.frameTimes.length >= 90) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      if (avg > 25) {
        this.quality = "low";
        this.layers = this.layers.map((b) => ({ ...b, bloom: null }));
        this.seedMotes();
        this.resize(this.cssW, this.cssH, this.dpr);
        this.frameTimes = [];
      }
    }
  }

  private step(dt: number) {
    this.time += dt;
    // ease parallax toward the pointer, plus a slow idle sway so it always breathes
    const idleX = Math.sin(this.time * 0.21) * 3;
    const idleY = Math.sin(this.time * 0.17 + 1) * 1.2;
    const e = 1 - Math.exp(-dt * 2.2);
    this.par.x += (this.parTarget.x + idleX - this.par.x) * e;
    this.par.y += (this.parTarget.y + idleY - this.par.y) * e;
    this.stepMotes(dt);
  }

  private warmMotes(t: number) {
    // deterministic positions for still frames
    const m = this.motes;
    for (let i = 0; i < m.length; i += 5) m[i] = (m[i]! + t * 0.01 * m[i + 4]!) % 1;
  }

  private stepMotes(dt: number) {
    const s = this.scene.motes;
    const m = this.motes;
    const vw = Math.max(1, this.viewW);
    for (let i = 0; i < m.length; i += 5) {
      const z = m[i + 2]!;
      m[i] = m[i]! + ((s.wind * z + Math.sin(this.time * 0.6 + m[i + 3]!) * 4) * dt) / vw;
      m[i + 1] = m[i + 1]! + ((Math.cos(this.time * 0.45 + m[i + 3]! * 1.7) * 3 - 1.5 * m[i + 4]!) * dt) / (s.y1 - s.y0);
      if (m[i]! > 1.05) m[i] = -0.05;
      if (m[i]! < -0.05) m[i] = 1.05;
      if (m[i + 1]! < -0.02) m[i + 1] = 1.02;
      if (m[i + 1]! > 1.02) m[i + 1] = -0.02;
    }
    // hoof dust
    const d = this.dust;
    let w = 0;
    for (let i = 0; i < this.dustN; i++) {
      const o = i * 5;
      const life = d[o + 4]! - dt;
      if (life <= 0) continue;
      const n = w * 5;
      d[n] = d[o]! + d[o + 2]! * dt;
      d[n + 1] = d[o + 1]! + d[o + 3]! * dt;
      d[n + 2] = d[o + 2]! * 0.97;
      d[n + 3] = d[o + 3]! - 4 * dt;
      d[n + 4] = life;
      w++;
    }
    this.dustN = w;
  }

  private emitDust(x: number, y: number, vx: number) {
    if (this.dustN >= this.dust.length / 5 || this.quality === "low") return;
    const o = this.dustN * 5;
    this.dust[o] = x + (Math.random() - 0.5) * 30;
    this.dust[o + 1] = y - Math.random() * 4;
    this.dust[o + 2] = vx - 20 - Math.random() * 40;
    this.dust[o + 3] = -6 - Math.random() * 10;
    this.dust[o + 4] = 0.6 + Math.random() * 0.8;
    this.dustN++;
  }

  // ------------------------------------------------------------------ drawing
  private draw(t: number) {
    if (!this.layers.length) return;
    const c = this.ctx;
    const s = this.scene;
    const k = this.k;
    const W = this.el.width;
    const H = this.el.height;
    const px = this.par.x;
    const py = this.par.y;
    const scroll = s.scroll * t;
    // screen (backing px) of a world point on a plane of depth d
    const sx = (wx: number, d: number, follow = false) => (wx - this.vx - px * d - (follow ? 0 : scroll * d)) * k;
    const sy = (wy: number, d: number) => (wy - this.vy - py * d * 0.6) * k;

    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    // sky
    const sg = c.createLinearGradient(0, 0, 0, H);
    sg.addColorStop(0, s.sky.top);
    sg.addColorStop(1, s.sky.bottom);
    c.fillStyle = sg;
    c.fillRect(0, 0, W, H);
    if (this.sky) {
      c.imageSmoothingEnabled = false;
      const sw = this.sky.width;
      const d = 0.04;
      const top = Math.round(sy(s.sky.y - this.sky.height, d));
      let x0 = (-(s.sky.drift * t) - px * d - this.vx) % sw;
      if (x0 > 0) x0 -= sw;
      for (let x = x0; x * k < W; x += sw) c.drawImage(this.sky, Math.round(x * k), top, sw * k, this.sky.height * k);
      // the sky continues upwards as a flat colour, feathered into the image's top edge
      if (top > 0) {
        c.fillStyle = this.skyTop;
        c.fillRect(0, 0, W, top);
        const f = c.createLinearGradient(0, top, 0, top + 40 * k);
        f.addColorStop(0, this.skyTop);
        f.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = f;
        c.fillRect(0, top, W, 40 * k);
      }
    }
    // sun glow
    if (this.sun) {
      c.globalCompositeOperation = "lighter";
      const r = s.sun.r * (1 + Math.sin(t * 0.5) * 0.03);
      c.globalAlpha = s.sun.alpha;
      c.imageSmoothingEnabled = true;
      c.drawImage(this.sun, sx(s.sun.x - r, 0.04, true), sy(s.sun.y - r, 0.04), r * 2 * k, r * 2 * k);
      c.globalAlpha = 1;
      c.globalCompositeOperation = "source-over";
    }

    for (const b of this.layers) {
      const l = b.def;
      const d = l.depth;
      c.imageSmoothingEnabled = !b.sharp;
      const y = Math.round(sy(l.y0 + b.oy, d));
      const h = b.canvas.height * k;
      if (b.period) {
        const off = sx(0, d) / k; // world x=0 on screen (art px)
        let x0 = off % b.period;
        if (x0 > 0) x0 -= b.period;
        for (let x = x0 + b.ox; x * k < W; x += b.period) c.drawImage(b.canvas, Math.round(x * k), y, b.canvas.width * k, h);
      } else c.drawImage(b.canvas, Math.round(sx(b.ox, d)), y, b.canvas.width * k, h);
      if (b.bloom) {
        c.globalCompositeOperation = "lighter";
        c.imageSmoothingEnabled = true;
        const bb = b.bloom;
        c.globalAlpha = 0.85 + Math.sin(t * 0.7) * 0.1;
        c.drawImage(bb.canvas, sx(bb.ox, d), sy(l.y0 + bb.oy, d), bb.canvas.width * bb.scale * k, bb.canvas.height * bb.scale * k);
        c.globalAlpha = 1;
        c.globalCompositeOperation = "source-over";
      }
      if (b.sway.length) this.drawSway(b, t, sx, sy);
      const sprites = this.sprites.get(l);
      if (sprites?.length) {
        c.imageSmoothingEnabled = false;
        for (const sp of sprites) this.drawSprite(sp, t, d, sx, sy, 0);
      }
      if (l.id === "focal") this.drawDust(sx, sy);
    }

    // light shafts
    c.globalCompositeOperation = "screen";
    c.imageSmoothingEnabled = true;
    for (const r of this.rays) {
      const def = r.def;
      const size = r.a.width;
      const half = size / 2;
      const ax = sx(def.x - half, def.depth, true);
      const ay = sy(def.y - half, def.depth);
      const wa = 0.5 + 0.5 * Math.sin(t * 0.23 + def.seed);
      c.globalAlpha = def.alpha * (0.55 + 0.45 * wa);
      c.drawImage(r.a, ax, ay, size * k, size * k);
      c.globalAlpha = def.alpha * (0.55 + 0.45 * (1 - wa));
      c.drawImage(r.b, ax, ay, size * k, size * k);
    }
    c.globalAlpha = 1;

    // motes: crisp 1-2 art-px sparks in the focal band, soft bokeh when near the lens
    c.globalCompositeOperation = "lighter";
    const ms = s.motes;
    const m = this.motes;
    for (let i = 0; i < m.length; i += 5) {
      const z = m[i + 2]!;
      const mx = (m[i]! * this.viewW - px * z) * k;
      const my = (ms.y0 + m[i + 1]! * (ms.y1 - ms.y0) - this.vy - py * z * 0.6) * k;
      const tw = 0.55 + 0.45 * Math.sin(t * (1.3 + m[i + 4]!) + m[i + 3]!);
      if (z > 1.35) {
        const r = (z - 1.1) * ms.bokeh * k;
        c.globalAlpha = 0.5 * tw;
        c.drawImage(this.bokeh!, mx - r, my - r, r * 2, r * 2);
      } else {
        const size = (z > 0.9 ? 2 : 1) * k;
        c.globalAlpha = 0.35 + 0.65 * tw * Math.min(1, z);
        c.fillStyle = ms.color;
        c.fillRect(Math.round(mx), Math.round(my), size, size);
      }
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";

    // out-of-focus framing pinned to the view corners
    for (const o of this.overlays) this.drawOverlay(o, t);

    // grade: warm top wash, darker base, vignette
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, hexA(s.grade.top, s.grade.topA));
    g.addColorStop(0.45, hexA(s.grade.top, 0));
    g.addColorStop(0.7, hexA(s.grade.bottom, 0));
    g.addColorStop(1, hexA(s.grade.bottom, s.grade.bottomA));
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    if (this.vignette) {
      c.imageSmoothingEnabled = true;
      c.drawImage(this.vignette, 0, 0, W, H);
    }
  }

  private drawSprite(
    sp: Sprite,
    t: number,
    d: number,
    sx: (wx: number, d: number, follow?: boolean) => number,
    sy: (wy: number, d: number) => number,
    baseX: number,
    parentX?: number,
  ) {
    const a = sp.def;
    const c = this.ctx;
    const k = this.k;
    let x = a.x;
    if (parentX !== undefined) x = parentX + a.x;
    else if (a.walk) {
      const span = Math.abs(a.walk.to - a.walk.from);
      const dur = span / a.walk.speed;
      const u = (((t + (a.walk.offset ?? 0)) % dur) + dur) % dur;
      x = a.walk.from + Math.sign(a.walk.to - a.walk.from) * u * a.walk.speed;
    }
    if (a.surge) x += Math.sin(t * a.surge.speed + (a.phase ?? 0)) * a.surge.amp;
    x += baseX;
    const frame = Math.floor(t * a.fps + (a.phase ?? 0)) % a.frames;
    const crop = a.cropBottom ?? 0;
    const dx = Math.round(sx(x, d, a.follow));
    if (!sp.with.length && (dx > this.el.width + 40 || dx + a.fw * k < -40)) return;
    const dy = Math.round(sy(a.y - a.fh, d));
    if (a.shadow) {
      c.imageSmoothingEnabled = true;
      shadowBlob(c, dx + (a.fw * k) / 2, sy(a.y - 1, d), a.shadow * k, 0.3);
      c.imageSmoothingEnabled = false;
    }
    c.drawImage(sp.strip, frame * a.fw, 0, a.fw, a.fh - crop, dx, dy, a.fw * k, (a.fh - crop) * k);
    if (a.dust && this.running && Math.random() < 0.5) this.emitDust(x + a.fw * 0.25 + (a.follow ? this.scene.scroll * t : 0), a.y, 0);
    for (const w of sp.with) this.drawSprite(w, t, d, sx, sy, 0, x);
  }

  private drawDust(sx: (wx: number, d: number, follow?: boolean) => number, sy: (wy: number, d: number) => number) {
    if (!this.dustN) return;
    const c = this.ctx;
    const k = this.k;
    c.fillStyle = this.scene.id === "track-dusk" ? "#e8b48a" : "#d8c09a";
    for (let i = 0; i < this.dustN; i++) {
      const o = i * 5;
      c.globalAlpha = Math.min(1, this.dust[o + 4]!) * 0.5;
      const size = (this.dust[o + 4]! > 0.8 ? 2 : 1) * k;
      c.fillRect(Math.round(sx(this.dust[o]!, 1)), Math.round(sy(this.dust[o + 1]!, 1)), size, size);
    }
    c.globalAlpha = 1;
  }

  /** Grass that sways: drawn in vertical slices, bent more at the top, into a low-res buffer when blurred. */
  private drawSway(b: Baked, t: number, sx: (wx: number, d: number) => number, sy: (wy: number, d: number) => number) {
    const c = this.ctx;
    const k = this.k;
    const d = b.def.depth;
    const blur = b.def.blur ?? 0;
    const f = blur > 0 ? Math.max(1, Math.round(blur)) : 0; // downsample factor = cheap blur
    for (const { item, img } of b.sway) {
      const iw = img.width;
      const ih = img.height;
      const amp = item.sway!.amp;
      const sp = item.sway!.speed;
      const yTop = item.y - ih;
      const x0w = sx(item.x, d) / k; // screen art x of the item origin
      let start = x0w % iw;
      if (start > 0) start -= iw;
      const target = f ? this.swayBuffer(Math.ceil(this.viewW / f) + 2, Math.ceil(ih / f) + 2) : null;
      const tc = target ? ctx2d(target) : c;
      if (target) {
        tc.clearRect(0, 0, target.width, target.height);
        tc.imageSmoothingEnabled = true;
      } else tc.imageSmoothingEnabled = false;
      const scale = f ? 1 / f : k;
      const SL = 32;
      for (let x = start; x < this.viewW; x += iw) {
        for (let s0 = 0; s0 < iw; s0 += SL) {
          const sxp = x + s0;
          if (sxp + SL < -amp || sxp > this.viewW + amp) continue;
          const bend = Math.sin(t * sp + (sxp + item.x) * 0.02) * amp + Math.sin(t * sp * 2.3 + sxp * 0.05) * amp * 0.3;
          // three height bands: roots still, tips bend
          for (let band = 0; band < 3; band++) {
            const by0 = Math.floor((ih * band) / 3);
            const by1 = Math.floor((ih * (band + 1)) / 3);
            const off = bend * (1 - band / 3);
            const dx = (sxp + off) * scale;
            const dy = target ? by0 * scale + 1 : sy(yTop + by0, d);
            tc.drawImage(img, s0, by0, SL, by1 - by0, target ? dx + 1 : Math.round(dx), Math.round(dy), SL * scale, (by1 - by0) * scale);
          }
        }
      }
      if (target) {
        tc.globalCompositeOperation = "source-atop";
        tc.fillStyle = "rgba(16,8,4,0.2)";
        tc.fillRect(0, 0, target.width, target.height);
        tc.globalCompositeOperation = "source-over";
        c.imageSmoothingEnabled = true;
        c.drawImage(target, -k * f, sy(yTop, d) - k * f, target.width * f * k, target.height * f * k);
      }
    }
  }

  private swayBuffer(w: number, h: number): Cnv {
    if (!this.swayBuf || this.swayBuf.width < w || this.swayBuf.height < h) this.swayBuf = canvas(w, h);
    return this.swayBuf;
  }

  private drawOverlay(o: OverlayBaked, t: number) {
    const c = this.ctx;
    const k = this.k;
    const def = o.def;
    const w = o.canvas.width;
    const h = o.canvas.height;
    const sway = def.sway ? Math.sin(t * 0.8) * def.sway : 0;
    const right = def.corner.endsWith("right");
    const bottom = def.corner.startsWith("bottom");
    const x = (right ? this.viewW - w + o.pad - def.dx : def.dx - o.pad) - this.par.x * (def.depth - 1) + sway;
    const y = (bottom ? this.viewH - h + o.pad - def.dy : def.dy - o.pad) - this.par.y * (def.depth - 1) * 0.6 + sway * 0.3;
    c.imageSmoothingEnabled = true;
    c.drawImage(o.canvas, x * k, y * k, w * k, h * k);
  }
}

function hexA(hex: string, a: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export const dioramaSupported = (): boolean => {
  if (!isBrowser) return false;
  try {
    return !!document.createElement("canvas").getContext("2d");
  } catch {
    return false;
  }
};
