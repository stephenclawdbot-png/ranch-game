/**
 * Browser side of the photo finish: loads the lunge strip, paints the native raster at a
 * whole-number scale (nearest, never smoothed), and draws the text and the judge's line
 * on top at device resolution so it stays crisp.
 */
import { parseKeyPalette } from "../three/recolor";
import { formatPhotoTime } from "./layout";
import { marginPhrase, type PhotoFinishModel } from "./model";
import { rasterPhotoFinish, type PhotoArt, type PhotoRaster, type RasterOptions } from "./raster";

/** Lunge frame held for the photo-finish freeze (full stretch). */
export const LUNGE_PHOTO_FRAME = 5;
const LUNGE_FRAME_W = 256;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

/** Loads `race/horse-lunge.png` and `race/palette.json` from the art base (default "/art"). */
export async function loadPhotoFinishArt(base = "/art"): Promise<PhotoArt> {
  const [img, pal] = await Promise.all([loadImage(`${base}/race/horse-lunge.png`), fetch(`${base}/race/palette.json`).then((r) => r.json() as Promise<unknown>)]);
  const keys = parseKeyPalette(pal);
  if (!keys) throw new Error("photo finish: bad palette.json");
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  return { strip: { data, width: c.width, height: c.height, frameW: LUNGE_FRAME_W }, frame: LUNGE_PHOTO_FRAME, keys };
}

export interface RenderOptions extends RasterOptions {
  /** Device pixels per native pixel (whole number, default 2). */
  scale?: number;
  /** Judge's line progress from the winner's nose (0) to the runner-up's (1). Default 1. */
  judge?: number;
  /** Label size in canvas pixels. */
  textPx?: number;
  /** Reuse a raster across animation frames. */
  raster?: PhotoRaster;
  /** Paint into this canvas instead of a new one. */
  canvas?: HTMLCanvasElement;
}

const FONT = "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";

function nativeCanvas(r: PhotoRaster): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = r.width;
  c.height = r.height;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
  return c;
}

const natives = new WeakMap<PhotoRaster, HTMLCanvasElement>();

/**
 * Draw the photograph (scaled raster + labels + judge's line) at (0, 0) of `ctx`.
 * `textPx` is the label size in canvas pixels (pass about 10 x devicePixelRatio on screen).
 */
export function drawPhotoFinish(ctx: CanvasRenderingContext2D, model: PhotoFinishModel, raster: PhotoRaster, scale: number, judge: number, textPx?: number): void {
  const s = Math.max(1, Math.round(scale));
  const l = raster.layout;
  const W = raster.width * s;
  let native = natives.get(raster);
  if (!native) {
    native = nativeCanvas(raster);
    natives.set(raster, native);
  }
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(native, 0, 0, W, raster.height * s);
  const fs = Math.max(8, Math.round(textPx ?? Math.max(10, 4.5 * s)));

  // Time scale labels under the major ticks (sized to the band under the tick marks).
  const tickFs = Math.min(fs, (raster.height - l.scaleTop - 7) * s);
  if (tickFs >= 7) {
    ctx.font = `${tickFs}px ${FONT}`;
    ctx.textBaseline = "bottom";
    ctx.textAlign = "center";
    ctx.fillStyle = "#e9dfc6";
    let lastX = Infinity;
    for (const t of [...l.ticks].sort((a, b) => b.x - a.x)) {
      if (!t.major) continue;
      const x = (t.x + 0.5) * s;
      const text = formatPhotoTime(t.us);
      const w = ctx.measureText(text).width;
      if (lastX - x < w + tickFs || x - w / 2 < 0 || x + w / 2 > W) continue;
      ctx.fillText(text, x, raster.height * s);
      lastX = x;
    }
  }

  // Placing tags at each nose, stacked up from the track so close noses stay readable
  // and the heads and the judge's line stay clear.
  const tagH = Math.round(fs * 1.35);
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.font = `600 ${fs}px ${FONT}`;
  const tick = Math.max(1, Math.round(s / 2));
  model.runners.forEach((r, i) => {
    const p = l.placements[i]!;
    const text = `${r.position} ${r.name}`;
    const w = ctx.measureText(text).width + Math.round(fs * 0.6);
    const x = Math.max(w, (p.noseX + 1) * s);
    const y = l.scaleTop * s - (i + 1) * (tagH + tick);
    ctx.fillStyle = "rgba(24,20,14,0.8)";
    ctx.fillRect(x - w, y, w, tagH);
    ctx.fillStyle = "#f3e7c9";
    ctx.fillText(text, x - Math.round(fs * 0.3), y + tagH / 2);
  });

  // The judge's line: fixed on the winner's nose, a second line slides to the runner-up's.
  const r2 = l.placements[1];
  const lineW = Math.max(1, Math.round(s / 2));
  const top = l.mainTop * s;
  const h = (l.scaleTop - l.mainTop) * s;
  const x1 = (l.winnerX + 1) * s;
  ctx.fillStyle = "#9a6c16";
  ctx.fillRect(x1 - lineW, top, lineW, h);
  if (r2) {
    const j = Math.min(1, Math.max(0, judge));
    const x2 = (r2.noseX + 1) * s;
    const xj = Math.round(x1 + (x2 - x1) * j);
    ctx.fillStyle = "#7a1f1f";
    ctx.fillRect(xj - lineW, top, lineW, h);
    if (j >= 1 && model.judge.label) {
      const label = model.judge.label.toUpperCase();
      const lf = Math.round(fs * 1.2);
      ctx.font = `700 ${lf}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const w = ctx.measureText(label).width + lf;
      const bh = Math.round(lf * 1.5);
      const cx = Math.min(W - w / 2 - 2, Math.max(w / 2 + 2, (x1 + x2) / 2));
      const y = top + tick * 2;
      ctx.fillStyle = "#7a1f1f";
      ctx.fillRect(cx - w / 2, y, w, bh);
      ctx.fillStyle = "#f3e7c9";
      ctx.fillText(label, cx, y + bh / 2);
    }
  }
  ctx.restore();
}

/** Render the photograph into a canvas (new, or `opts.canvas`). */
export function renderPhotoFinish(model: PhotoFinishModel, art: PhotoArt, opts: RenderOptions = {}): HTMLCanvasElement {
  const raster = opts.raster ?? rasterPhotoFinish(model, art, opts);
  const s = Math.max(1, Math.round(opts.scale ?? 2));
  const c = opts.canvas ?? document.createElement("canvas");
  if (c.width !== raster.width * s) c.width = raster.width * s;
  if (c.height !== raster.height * s) c.height = raster.height * s;
  const ctx = c.getContext("2d")!;
  drawPhotoFinish(ctx, model, raster, s, opts.judge ?? 1, opts.textPx);
  return c;
}

export interface PhotoShareMeta {
  raceName?: string;
  course: string;
  /** Display date, e.g. "30 Oct 2026". Defaults to the post time's UTC date. */
  date?: string;
  /** Stable name per horseId. */
  stables?: Record<string, string>;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxW) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** The share card as a canvas: header, the photograph, the verdict and the placed horses with their stables. */
export function renderPhotoShareCard(model: PhotoFinishModel, art: PhotoArt, meta: PhotoShareMeta, opts: RasterOptions = {}): HTMLCanvasElement {
  const raster = rasterPhotoFinish(model, art, opts);
  const s = Math.max(2, Math.min(4, Math.floor(1100 / raster.width)));
  const pad = 28;
  const W = Math.max(raster.width * s + pad * 2, 720);
  const date = meta.date ?? new Date(model.postTimeMs).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `600 22px ${FONT}`;
  const verdict = wrap(measure, model.verdict, W - pad * 2);
  const rows = model.runners.length;
  const H = pad + 34 + 24 + 16 + raster.height * s + 18 + verdict.length * 30 + 10 + rows * 26 + pad + 18;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0f2a1d";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#d9a441";
  ctx.fillRect(0, 0, W, 6);
  let y = pad;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#f3e7c9";
  ctx.font = `700 30px ${FONT}`;
  ctx.fillText(meta.raceName ?? model.raceName, pad, y);
  y += 38;
  ctx.fillStyle = "#d9a441";
  ctx.font = `500 18px ${FONT}`;
  ctx.fillText(`${meta.course} · ${date} · ${model.distanceM} m · Photo finish`, pad, y);
  y += 24 + 12;
  const x0 = Math.floor((W - raster.width * s) / 2);
  ctx.save();
  ctx.translate(x0, y);
  drawPhotoFinish(ctx, model, raster, s, 1, 13);
  ctx.restore();
  ctx.strokeStyle = "#d9a441";
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 - 1, y - 1, raster.width * s + 2, raster.height * s + 2);
  y += raster.height * s + 18;
  ctx.fillStyle = "#f3e7c9";
  ctx.font = `600 22px ${FONT}`;
  for (const line of verdict) {
    ctx.fillText(line, pad, y);
    y += 30;
  }
  y += 10;
  ctx.font = `400 18px ${FONT}`;
  for (const r of model.runners) {
    const stable = meta.stables?.[r.horseId];
    ctx.fillStyle = "#d9a441";
    ctx.fillText(`${r.position}`, pad, y);
    ctx.fillStyle = "#f3e7c9";
    ctx.fillText(`${r.name}${stable ? `  (${stable})` : ""}${r.marginLabel ? ` · ${marginPhrase(r.marginLabel)}` : ""}`, pad + 30, y);
    y += 26;
  }
  ctx.fillStyle = "rgba(243,231,201,0.55)";
  ctx.font = `500 14px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("POST TIME", W - pad, H - pad);
  return c;
}

/** The share card as a PNG blob, for the share button. */
export function exportPhotoFinishPng(model: PhotoFinishModel, art: PhotoArt, meta: PhotoShareMeta, opts: RasterOptions = {}): Promise<Blob> {
  const c = renderPhotoShareCard(model, art, meta, opts);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("photo finish: toBlob failed"))), "image/png"));
}
