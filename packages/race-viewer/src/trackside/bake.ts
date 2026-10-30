/**
 * Canvas2D bakes for the Trackside backdrop (browser only, run once at load): the
 * track-dusk layer recipe (sky, far hills, trees, far rail, near rail) with its depth of
 * field blur and aerial haze baked in, light shafts, glow sprites, vignette and contact
 * shadows. Blur and bloom never touch the horse sprites.
 */
import type { BackdropStem } from "./art";
import type { TracksideLook } from "./looks";
import type { CourseArtSrc, SceneryRecipe } from "./scenery";
import { CHIP_FILL, CHIP_INK, CHIP_LABELS, CHIP_NUM, CHIP_UNIT, chipBitmap } from "./gapMarks";

type Cnv = HTMLCanvasElement;

export function canvas(w: number, h: number): Cnv {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}
const ctx = (c: Cnv) => c.getContext("2d")!;

let filterOk: boolean | null = null;
function canFilter(): boolean {
  if (filterOk !== null) return filterOk;
  try {
    const c = canvas(8, 8);
    const x = ctx(c);
    x.filter = "blur(2px)";
    filterOk = x.filter === "blur(2px)";
    if (filterOk) {
      x.fillStyle = "#fff";
      x.fillRect(3, 3, 2, 2);
      filterOk = x.getImageData(1, 1, 1, 1).data[3]! > 0;
    }
  } catch {
    filterOk = false;
  }
  return filterOk;
}

/** Gaussian-ish blur (ctx.filter where supported, else a down/up-sample). */
export function blurred(src: Cnv, r: number): { canvas: Cnv; pad: number } {
  const pad = Math.ceil(r * 3);
  const out = canvas(src.width + pad * 2, src.height + pad * 2);
  const x = ctx(out);
  if (canFilter()) {
    x.filter = `blur(${r}px)`;
    x.drawImage(src, pad, pad);
    x.filter = "none";
  } else {
    const f = Math.max(2, Math.round(r * 1.6));
    const small = canvas(out.width / f, out.height / f);
    const sx = ctx(small);
    sx.imageSmoothingEnabled = true;
    sx.drawImage(src, pad / f, pad / f, src.width / f, src.height / f);
    x.imageSmoothingEnabled = true;
    x.drawImage(small, 0, 0, out.width, out.height);
  }
  return { canvas: out, pad };
}

/** Blur a horizontally repeating canvas without a seam (blur 3 copies, keep the middle). */
function blurPeriodic(c: Cnv, r: number): Cnv {
  const w = c.width;
  const tri = canvas(w * 3, c.height);
  const tx = ctx(tri);
  for (let i = 0; i < 3; i++) tx.drawImage(c, i * w, 0);
  const b = blurred(tri, r);
  const mid = canvas(w, c.height);
  ctx(mid).drawImage(b.canvas, -(w + b.pad), -b.pad);
  return mid;
}

function haze(c: Cnv, color: string, a: number) {
  if (a <= 0) return;
  const x = ctx(c);
  x.globalCompositeOperation = "source-atop";
  x.globalAlpha = Math.min(1, a);
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  x.globalAlpha = 1;
  x.globalCompositeOperation = "source-over";
}

function darken(c: Cnv, a: number) {
  haze(c, "rgb(16,8,4)", a);
}

export interface BakedLayer {
  canvas: Cnv;
  /** Art-px of the layer's reference line (the rail bottom, y = 292 in the diorama) from the canvas top. */
  baseline: number;
  period: number;
}

type Img = Map<BackdropStem, HTMLImageElement>;
/** Course scenery art (art/course, plus the parkland grandstand), keyed by manifest src. */
export type CourseImg = Map<CourseArtSrc, HTMLImageElement>;

/** Sky strip mirror-doubled for a seamless drift, with a feathered flat top. */
export function bakeSky(images: Img, look: TracksideLook): { canvas: Cnv; top: string; feather: number } | null {
  const im = images.get(look.sky) ?? images.get("sky-dusk");
  if (!im) return null;
  const feather = 64;
  const c = canvas(im.width * 2, im.height + feather);
  const x = ctx(c);
  x.drawImage(im, 0, feather);
  x.save();
  x.translate(im.width * 2, 0);
  x.scale(-1, 1);
  x.drawImage(im, 0, feather);
  x.restore();
  const d = x.getImageData(0, feather, im.width, 6).data;
  let r = 0;
  let g = 0;
  let b = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i]!;
    g += d[i + 1]!;
    b += d[i + 2]!;
  }
  const top = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
  x.fillStyle = top;
  x.fillRect(0, 0, c.width, feather);
  const f = x.createLinearGradient(0, feather, 0, feather + 40);
  f.addColorStop(0, top);
  f.addColorStop(1, "rgba(0,0,0,0)");
  x.globalCompositeOperation = "source-atop";
  x.fillStyle = f;
  x.fillRect(0, feather, c.width, 40);
  x.globalCompositeOperation = "source-over";
  return { canvas: c, top, feather };
}

/** Far hills (period = image width), DOF blur 1.4 and haze. Baseline: hills sit 36 art px above the rail. */
export function bakeHills(images: Img, look: TracksideLook, far?: HTMLImageElement | null): BakedLayer | null {
  const im = far ?? images.get("far-hills");
  if (!im) return null;
  const c = canvas(im.width, im.height + 8);
  ctx(c).drawImage(im, 0, 4);
  // A course panorama is the course's signature (white horse, sea, skyline): a lighter haze.
  haze(c, look.fog, (far ? 0.36 : 0.5) * look.hazeMul);
  return { canvas: blurPeriodic(c, 1.4), baseline: 4 + im.height + 36, period: im.width };
}

/** The diorama's tree line (period 900): oaks and poplars, blur 1, haze .42. */
export function bakeTrees(images: Img, look: TracksideLook): BakedLayer | null {
  const oak = images.get("bb-tree-oak");
  const oakB = images.get("bb-tree-oak-b") ?? oak;
  const pop = images.get("bb-tree-poplar");
  if (!oak) return null;
  const P = 900;
  const H = 270;
  const c = canvas(P, H);
  const x = ctx(c);
  x.imageSmoothingEnabled = false;
  const put = (im: HTMLImageElement | undefined, px: number, bottom: number, flip = false) => {
    if (!im) return;
    for (const off of [-P, 0, P]) {
      const dx = px + off;
      if (dx > P || dx + im.width < 0) continue;
      if (flip) {
        x.save();
        x.translate(dx + im.width, bottom - im.height);
        x.scale(-1, 1);
        x.drawImage(im, 0, 0);
        x.restore();
      } else x.drawImage(im, dx, bottom - im.height);
    }
  };
  put(oak, 20, 262);
  put(pop, 260, 258);
  put(pop, 300, 262);
  put(oakB, 480, 264, true);
  put(oak, 700, 260);
  haze(c, look.fog, 0.42 * look.hazeMul);
  return { canvas: blurPeriodic(c, 1), baseline: 292, period: P };
}

/**
 * Far rail tile (sharp) on its grass fill band. Baseline = the rail's bottom. A course can
 * recolour the grass and set decor along the rail, behind it (gorse, boards, flowers, a
 * dry-stone wall), at the rail's own scale; the tile then repeats over a longer period.
 */
export function bakeRailFar(images: Img, look: TracksideLook, recipe?: SceneryRecipe | null, course?: CourseImg): BakedLayer | null {
  const im = images.get("rail-far");
  if (!im) return null;
  const decor = recipe?.railDecor && course ? course.get(recipe.railDecor.src) : undefined;
  const every = recipe?.railDecor?.every ?? im.width;
  // Period: whole rail tiles that also hold whole decor spacings (at most 8 tiles).
  let tiles = 1;
  if (decor) {
    tiles = 8;
    for (let t = 1; t <= 8; t++) {
      if ((t * im.width) % every === 0) {
        tiles = t;
        break;
      }
    }
  }
  const W = im.width * tiles;
  const top = decor ? Math.max(0, decor.height - im.height + 4) : 0;
  const base = top + im.height;
  const c = canvas(W, base + 8);
  const x = ctx(c);
  x.imageSmoothingEnabled = false;
  const fill = recipe?.railFill ?? ["#4a5a34", "#3f5530"];
  const g = x.createLinearGradient(0, base - 30, 0, base + 8);
  g.addColorStop(0, fill[0]);
  g.addColorStop(1, fill[1]);
  x.fillStyle = g;
  x.fillRect(0, base - 30, c.width, 38);
  if (decor && recipe?.railDecor) {
    const n = Math.max(1, Math.round(W / every));
    const y = base - decor.height + 2 - recipe.railDecor.lift;
    for (let i = 0; i < n; i++) {
      const dx = Math.round((i * W) / n);
      for (const off of [-W, 0, W]) {
        if (dx + off > W || dx + off + decor.width < 0) continue;
        if (i % 2 === 1) {
          x.save();
          x.translate(dx + off + decor.width, y);
          x.scale(-1, 1);
          x.drawImage(decor, 0, 0);
          x.restore();
        } else x.drawImage(decor, dx + off, y);
      }
    }
  }
  for (let t = 0; t < tiles; t++) x.drawImage(im, t * im.width, top);
  haze(c, look.fog, 0.2 * look.hazeMul);
  return { canvas: c, baseline: base, period: W };
}

/** Out-of-focus near rail (blur 2.8, in shadow). Baseline = the top of the rail bar. */
export function bakeRailNear(images: Img): BakedLayer | null {
  const im = images.get("rail-near") ?? images.get("rail-far");
  if (!im) return null;
  const c = canvas(im.width, im.height);
  ctx(c).drawImage(im, 0, 0);
  darken(c, 0.32);
  return { canvas: blurPeriodic(c, 2.8), baseline: 0, period: im.width };
}

/** A strip of distant field between the hills and the far rail (no sky gap at any zoom). */
export function bakeField(look: TracksideLook, colours: [string, string] = ["#5f6b3a", "#46582f"]): Cnv {
  const c = canvas(4, 64);
  const x = ctx(c);
  const g = x.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, colours[0]);
  g.addColorStop(1, colours[1]);
  x.fillStyle = g;
  x.fillRect(0, 0, 4, 64);
  haze(c, look.fog, 0.45 * look.hazeMul);
  return c;
}

/**
 * A course's midground band (period and placements from its scenery recipe), with the same
 * depth-of-field blur and aerial haze as the original tree line. Baseline 292 like the trees.
 */
export function bakeMid(course: CourseImg, recipe: SceneryRecipe, look: TracksideLook): BakedLayer | null {
  if (recipe.mid === "trees") return null;
  const m = recipe.mid;
  const P = m.period;
  const c = canvas(P, m.height);
  const x = ctx(c);
  x.imageSmoothingEnabled = false;
  let drawn = 0;
  for (const it of m.items) {
    const im = course.get(it.src);
    if (!im) continue;
    drawn++;
    for (const off of [-P, 0, P]) {
      const dx = it.x + off;
      if (dx > P || dx + im.width < 0) continue;
      if (it.flip) {
        x.save();
        x.translate(dx + im.width, it.bottom - im.height);
        x.scale(-1, 1);
        x.drawImage(im, 0, 0);
        x.restore();
      } else x.drawImage(im, dx, it.bottom - im.height);
    }
  }
  if (!drawn) return null;
  haze(c, look.fog, m.haze * look.hazeMul);
  return { canvas: blurPeriodic(c, m.blur), baseline: 292, period: P };
}

/** A grandstand with a touch of the midground's haze and blur (it stands just in front of it). */
export function bakeStand(im: HTMLImageElement, look: TracksideLook): { canvas: Cnv; pad: number } {
  const c = canvas(im.width, im.height);
  const x = ctx(c);
  x.imageSmoothingEnabled = false;
  x.drawImage(im, 0, 0);
  haze(c, look.fog, 0.24 * look.hazeMul);
  return blurred(c, 0.6);
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

/** Two light-shaft sprites (cross-faded) fanning left/down from the sun. */
export function bakeRays(color: string, seed = 17): Cnv[] {
  const make = (s: number) => {
    const rnd = rand(s);
    const length = 520;
    const width = 16;
    const size = length * 2;
    const c = canvas(size, size);
    const x = ctx(c);
    const cx = size / 2;
    for (let i = 0; i < 9; i++) {
      const ang = ((180 + (rnd() - 0.5) * 120) * Math.PI) / 180;
      const len = length * (0.6 + rnd() * 0.4);
      const w0 = width * (0.15 + rnd() * 0.25);
      const w1 = width * (0.7 + rnd() * 0.9);
      const nx = -Math.sin(ang);
      const ny = Math.cos(ang);
      const ex = cx + Math.cos(ang) * len;
      const ey = cx + Math.sin(ang) * len;
      const g = x.createLinearGradient(cx, cx, ex, ey);
      const a = 0.35 + rnd() * 0.65;
      g.addColorStop(0, color + "00");
      g.addColorStop(0.08, color + Math.round(a * 255).toString(16).padStart(2, "0"));
      g.addColorStop(0.55, color + Math.round(a * 120).toString(16).padStart(2, "0"));
      g.addColorStop(1, color + "00");
      x.fillStyle = g;
      x.beginPath();
      x.moveTo(cx + nx * w0, cx + ny * w0);
      x.lineTo(ex + nx * w1, ey + ny * w1);
      x.lineTo(ex - nx * w1, ey - ny * w1);
      x.lineTo(cx - nx * w0, cx - ny * w0);
      x.closePath();
      x.fill();
    }
    return blurred(c, 6).canvas;
  };
  return [make(seed), make(seed + 101)];
}

/** Radial glow (sun, bokeh). */
export function glow(color: string, size = 128, stops: [number, string][] = [[0, "ff"], [0.18, "cc"], [0.5, "33"], [1, "00"]]): Cnv {
  const c = canvas(size, size);
  const x = ctx(c);
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, a] of stops) g.addColorStop(o, color + a);
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return c;
}

export function vignette(strength: number): Cnv {
  const c = canvas(160, 90);
  const x = ctx(c);
  const g = x.createRadialGradient(80, 50, 20, 80, 50, 100);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(0.55, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(8,4,2,${strength})`);
  x.fillStyle = g;
  x.fillRect(0, 0, 160, 90);
  return c;
}

/** Soft contact shadow ellipse. */
export function shadowBlob(): Cnv {
  const c = canvas(64, 16);
  const x = ctx(c);
  const g = x.createRadialGradient(32, 8, 0, 32, 8, 32);
  g.addColorStop(0, "rgba(20,10,4,0.5)");
  g.addColorStop(0.6, "rgba(20,10,4,0.28)");
  g.addColorStop(1, "rgba(20,10,4,0)");
  x.save();
  x.scale(1, 0.25);
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  x.restore();
  return c;
}

/** "My horse" pixel chevron. */
export function chevron(): Cnv {
  const c = canvas(11, 9);
  const x = ctx(c);
  const rows = ["11111111111", "12222222221", "01222222210", "00122222100", "00012221000", "00001210000", "00000100000"];
  rows.forEach((row, y) =>
    [...row].forEach((v, i) => {
      if (v === "0") return;
      x.fillStyle = v === "1" ? "#3a2604" : y < 2 ? "#ffe08a" : "#d9a441";
      x.fillRect(i, y + 1, 1, 1);
    }),
  );
  return c;
}

/** Every gap-marker chip ("8L") in one atlas, so nothing is baked or uploaded mid-race. */
export function gapChipAtlas(): { canvas: Cnv; cells: Map<string, { x: number; y: number; w: number; h: number }> } {
  const bms = CHIP_LABELS.map((l) => [l, chipBitmap(l)] as const);
  const cw = Math.max(...bms.map(([, b]) => b.w)) + 1;
  const ch = Math.max(...bms.map(([, b]) => b.h)) + 1;
  const cols = 12;
  const c = canvas(cols * cw, Math.ceil(bms.length / cols) * ch);
  const x = ctx(c);
  const colour: Record<number, string> = { [CHIP_INK]: "#0b0f0c", [CHIP_FILL]: "rgba(15,42,29,0.92)", [CHIP_NUM]: "#f2c86a", [CHIP_UNIT]: "#f3e7c9" };
  const cells = new Map<string, { x: number; y: number; w: number; h: number }>();
  bms.forEach(([label, b], i) => {
    const ox = (i % cols) * cw;
    const oy = Math.floor(i / cols) * ch;
    for (let py = 0; py < b.h; py++)
      for (let px = 0; px < b.w; px++) {
        const v = b.px[py * b.w + px]!;
        if (!v) continue;
        x.fillStyle = colour[v]!;
        x.fillRect(ox + px, oy + py, 1, 1);
      }
    cells.set(label, { x: ox, y: oy, w: b.w, h: b.h });
  });
  return { canvas: c, cells };
}

/** Soft vertical haze column (white; tinted at draw time) marking a squeezed gap as a cut. */
export function gapHaze(): Cnv {
  const W = 32;
  const H = 64;
  const c = canvas(W, H);
  const x = ctx(c);
  const img = x.createImageData(W, H);
  for (let py = 0; py < H; py++) {
    const v = py / (H - 1);
    // fades in over the far lanes, holds across the field, fades out in front of it
    const fy = Math.min(1, v / 0.25) * Math.min(1, (1 - v) / 0.2);
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5) / W - 0.5;
      const a = Math.exp(-(u * u) / (2 * 0.16 * 0.16)) * fy;
      const o = (py * W + px) * 4;
      img.data[o] = 255;
      img.data[o + 1] = 255;
      img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(255 * a);
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}
