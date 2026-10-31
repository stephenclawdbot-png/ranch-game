/**
 * Burned-in clip overlays (canvas 2D): the banner (race name, course and date) across
 * the top, the race call as captions, the end card with the official top 3, and the
 * POST TIME wordmark + URL. `clipLayout` is the pure geometry (unit-tested); the draw
 * functions only paint what it says. Everything scales from the shorter side, so the
 * same code serves 1080x1920 and 1920x1080.
 */
import type { CallLine } from "../call/buildRaceCall";
import type { EndCardRow } from "./plan";

const INK = "#0b0f0c";
const GREEN = "#0f2a1d";
const GREEN2 = "#163a28";
const CREAM = "#f3e7c9";
const BRASS = "#d9a441";
const BRASS2 = "#f2c86a";
const SANS = "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
const DISPLAY = '"Pixelify Sans", "Courier New", monospace';

export interface ClipLayout {
  W: number;
  H: number;
  /** Scale unit: the shorter side / 1080 (1 for both shipping sizes). */
  u: number;
  /** Edge margin (px). */
  pad: number;
  bannerH: number;
  bannerTitlePx: number;
  bannerSubPx: number;
  captionFontPx: number;
  captionMaxW: number;
  /** Baseline zone: captions sit this far above the frame bottom. */
  captionBottom: number;
  wordmarkPx: number;
  endCard: { w: number; x: number; headerPx: number; rowPx: number; rowH: number; padY: number; bottom: number };
  /** Photo-card fit box (contain). */
  photo: { x: number; y: number; w: number; h: number };
}

export function clipLayout(W: number, H: number): ClipLayout {
  const u = Math.min(W, H) / 1080;
  const pad = Math.round(40 * u);
  const bannerH = Math.round(150 * u);
  const captionMaxW = W - pad * 2;
  const captionBottom = Math.round(150 * u);
  const endCardW = Math.min(W - pad * 2, Math.round(860 * u));
  return {
    W,
    H,
    u,
    pad,
    bannerH,
    bannerTitlePx: Math.round(50 * u),
    bannerSubPx: Math.round(30 * u),
    captionFontPx: Math.round(38 * u),
    captionMaxW,
    captionBottom,
    wordmarkPx: Math.round(24 * u),
    endCard: {
      w: endCardW,
      x: Math.round((W - endCardW) / 2),
      headerPx: Math.round(34 * u),
      rowPx: Math.round(40 * u),
      rowH: Math.round(64 * u),
      padY: Math.round(26 * u),
      bottom: captionBottom + Math.round(120 * u),
    },
    photo: { x: 0, y: 0, w: W, h: H },
  };
}

/** Word-wrap against a measurer (ctx.measureText); kept pure for tests. */
export function wrapLines(measure: (text: string) => number, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > maxW) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** The height of the end card panel for `rows` rows (used by the draw and the tests). */
export function endCardHeight(l: ClipLayout, rows: number): number {
  return l.endCard.padY * 2 + l.endCard.headerPx + Math.round(10 * l.u) + rows * l.endCard.rowH;
}

/** Banner: race name with course · date · distance, over a top scrim. Drawn every frame. */
export function drawBanner(ctx: CanvasRenderingContext2D, l: ClipLayout, title: string, subtitle: string): void {
  const g = ctx.createLinearGradient(0, 0, 0, l.bannerH + Math.round(30 * l.u));
  g.addColorStop(0, "rgba(8,21,14,0.88)");
  g.addColorStop(0.7, "rgba(8,21,14,0.45)");
  g.addColorStop(1, "rgba(8,21,14,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, l.W, l.bannerH + Math.round(30 * l.u));
  ctx.fillStyle = BRASS;
  ctx.fillRect(0, 0, l.W, Math.max(2, Math.round(6 * l.u)));
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = CREAM;
  ctx.font = `700 ${l.bannerTitlePx}px ${DISPLAY}`;
  const maxW = l.W - l.pad * 2;
  let text = title;
  while (text.length > 4 && ctx.measureText(text).width > maxW) text = `${text.slice(0, -2).trimEnd()}…`;
  ctx.fillText(text, l.pad, l.pad + l.bannerTitlePx * 0.9);
  ctx.fillStyle = BRASS;
  ctx.font = `600 ${l.bannerSubPx}px ${SANS}`;
  ctx.fillText(subtitle, l.pad, l.pad + l.bannerTitlePx * 0.9 + l.bannerSubPx * 1.35);
}

/** The race call as a caption near the bottom, styled like the on-stage ticker. */
export function drawCaption(ctx: CanvasRenderingContext2D, l: ClipLayout, line: CallLine): void {
  ctx.font = `700 ${l.captionFontPx}px ${SANS}`;
  const padX = Math.round(18 * l.u);
  const padY = Math.round(12 * l.u);
  const barW = Math.max(3, Math.round(6 * l.u));
  const lines = wrapLines((t) => ctx.measureText(t).width, line.text, l.captionMaxW - padX * 2 - barW).slice(0, 3);
  const lineH = Math.round(l.captionFontPx * 1.22);
  const h = padY * 2 + lines.length * lineH;
  let maxW = 0;
  for (const t of lines) maxW = Math.max(maxW, ctx.measureText(t).width);
  const w = Math.ceil(maxW) + padX * 2 + barW;
  const x = Math.round((l.W - w) / 2);
  const y = l.H - l.captionBottom - h;
  ctx.fillStyle = "rgba(11,15,12,0.88)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, Math.round(3 * l.u));
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = BRASS;
  ctx.fillRect(x, y, barW, h);
  ctx.fillStyle = CREAM;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  lines.forEach((t, i) => ctx.fillText(t, x + barW + padX, y + padY + i * lineH + Math.round(l.captionFontPx * 0.08)));
}

/** The wordmark + game URL, always on. */
export function drawWordmark(ctx: CanvasRenderingContext2D, l: ClipLayout, url: string): void {
  const label = `POST TIME${url ? ` · ${url}` : ""}`;
  ctx.font = `700 ${l.wordmarkPx}px ${SANS}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  const y = l.H - Math.round(24 * l.u);
  const x = l.W - Math.round(36 * l.u);
  ctx.fillStyle = "rgba(11,15,12,0.55)";
  const w = ctx.measureText(label).width;
  ctx.fillRect(x - w - Math.round(10 * l.u), y - l.wordmarkPx - Math.round(10 * l.u), w + Math.round(16 * l.u), l.wordmarkPx + Math.round(14 * l.u));
  ctx.fillStyle = BRASS2;
  ctx.globalAlpha = 0.9;
  ctx.fillText(label, x, y);
  ctx.globalAlpha = 1;
}

/** The end card: the official top 3 with margins, over the ease-down. */
export function drawEndCard(ctx: CanvasRenderingContext2D, l: ClipLayout, rows: readonly EndCardRow[], fade: number): void {
  if (fade <= 0 || rows.length === 0) return;
  const e = l.endCard;
  const h = endCardHeight(l, rows.length);
  const w = e.w;
  const x = e.x;
  const y = l.H - e.bottom - h;
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, fade));
  ctx.fillStyle = "rgba(15,42,29,0.95)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, Math.round(4 * l.u));
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = "rgba(242,200,106,0.45)";
  ctx.lineWidth = Math.max(1, Math.round(2 * l.u));
  ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = BRASS;
  ctx.font = `700 ${e.headerPx}px ${SANS}`;
  ctx.fillText("OFFICIAL RESULT", x + e.padY, y + e.padY + e.headerPx * 0.85);
  let ry = y + e.padY + e.headerPx + Math.round(10 * l.u);
  const nameX = x + e.padY + Math.round(140 * l.u);
  const marginX = x + w - e.padY;
  for (const r of rows) {
    const cy = ry + e.rowH / 2;
    const sw = Math.round(30 * l.u);
    ctx.fillStyle = r.silks.primary;
    ctx.fillRect(x + e.padY, cy - sw / 2, sw, sw);
    ctx.fillStyle = r.silks.secondary;
    ctx.beginPath();
    ctx.moveTo(x + e.padY + sw, cy - sw / 2);
    ctx.lineTo(x + e.padY + sw, cy + sw / 2);
    ctx.lineTo(x + e.padY, cy + sw / 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, Math.round(2 * l.u));
    ctx.strokeRect(x + e.padY, cy - sw / 2, sw, sw);
    ctx.font = `700 ${e.rowPx}px ${SANS}`;
    ctx.textAlign = "left";
    ctx.fillStyle = r.winner ? BRASS2 : CREAM;
    ctx.fillText(r.posText, x + e.padY + Math.round(44 * l.u), cy + e.rowPx * 0.34);
    ctx.fillText(r.name, nameX, cy + e.rowPx * 0.34);
    ctx.textAlign = "right";
    ctx.fillStyle = r.winner ? BRASS2 : "rgba(243,231,201,0.75)";
    ctx.font = `600 ${Math.round(e.rowPx * 0.8)}px ${SANS}`;
    ctx.fillText(r.marginText, marginX, cy + e.rowPx * 0.3);
    ry += e.rowH;
  }
  ctx.restore();
}

/**
 * The photo-finish hold: the share card (already rendered to a canvas) fitted into the
 * frame on the raceday green. Pixel-crisp at integer scales only when it fits 1:1;
 * otherwise smoothed is fine for the card's text (its strip inside was rasterised crisp).
 */
export function drawPhotoCard(ctx: CanvasRenderingContext2D, l: ClipLayout, card: HTMLCanvasElement): void {
  ctx.fillStyle = GREEN;
  ctx.fillRect(0, 0, l.W, l.H);
  const scale = Math.min(l.photo.w / card.width, l.photo.h / card.height);
  const w = Math.round(card.width * scale);
  const h = Math.round(card.height * scale);
  const x = Math.round((l.W - w) / 2);
  const y = Math.round((l.H - h) / 2);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(card, x, y, w, h);
  ctx.imageSmoothingEnabled = false;
}

export { GREEN, GREEN2, CREAM, BRASS, BRASS2, INK };
