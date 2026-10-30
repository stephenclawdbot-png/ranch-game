/**
 * Stage art painted in code (browser only), shared by both views so they draw the very same
 * pixels: distance plates, the judge's box, ground-fx strips recoloured for the going, and the
 * cheering-crowd frames. Everything at the horses' density (96 px/m) with hard pixel edges.
 */
import type { PlateGrid } from "./plates";
import { PLATE_TEXEL_PX } from "./plates";
import type { FxPalette } from "../trackside/art";
import { hexToRgb } from "../three/color";

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/** A distance plate, PLATE_TEXEL_PX source px per plate texel. */
export function plateCanvas(g: PlateGrid, texel = PLATE_TEXEL_PX): HTMLCanvasElement {
  const c = canvas(g.w * texel, g.h * texel);
  const x = c.getContext("2d")!;
  const col = [null, g.colours.rim, g.colours.plate, g.colours.glyph];
  for (let y = 0; y < g.h; y++) {
    for (let i = 0; i < g.w; i++) {
      const k = g.px[y * g.w + i]!;
      if (!k) continue;
      x.fillStyle = col[k]!;
      x.fillRect(i * texel, y * texel, texel, texel);
    }
  }
  return c;
}

/**
 * The judge's box: a small white hut on stilts with a dark window and a red roof, 1.8 x 3.2 m
 * at 96 px/m (flat pixel shapes, a one-pixel dark outline, light from the right).
 */
export function judgeBoxCanvas(): HTMLCanvasElement {
  const W = 173;
  const H = 307;
  const c = canvas(W, H);
  const x = c.getContext("2d")!;
  const r = (col: string, a: number, b: number, w: number, h: number) => {
    x.fillStyle = col;
    x.fillRect(a, b, w, h);
  };
  const ink = "#1a1612";
  // stilts and steps
  r(ink, 22, 200, 14, 107);
  r(ink, 137, 200, 14, 107);
  r("#d8d4c8", 24, 200, 10, 107);
  r("#efeae0", 139, 200, 10, 107);
  // hut
  r(ink, 6, 70, 161, 136);
  r("#e9e4d8", 8, 72, 157, 132);
  r("#fbf8f0", 120, 72, 45, 132);
  // window
  r(ink, 24, 92, 125, 56);
  r("#2b3a48", 27, 95, 119, 50);
  r("#4f6a80", 110, 95, 36, 50);
  r(ink, 85, 95, 3, 50);
  // red band and roof
  r("#a8141f", 8, 168, 157, 10);
  r(ink, 0, 40, 173, 34);
  r("#b5121b", 2, 42, 169, 30);
  r("#d8303a", 110, 42, 61, 30);
  r(ink, 20, 22, 133, 20);
  r("#8f0f17", 22, 24, 129, 16);
  // pennant
  r(ink, 84, 0, 4, 24);
  r("#f2c230", 88, 2, 22, 10);
  return c;
}

/** A ground-fx strip recoloured for the race's ground (race/fx-palette.json ramps by index). */
export function fxStripCanvas(img: HTMLImageElement, pal: FxPalette | null, strip: string, surfaceKey: string): HTMLCanvasElement {
  const c = canvas(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(img, 0, 0);
  const keys = pal?.keys[strip];
  const target = pal?.surfaces[surfaceKey]?.[strip];
  if (!keys || !target) return c;
  const map = new Map<number, [number, number, number]>();
  for (const role of Object.keys(keys)) {
    const from = keys[role]!;
    const to = target[role];
    if (!to || to.length !== from.length) continue;
    from.forEach((h, i) => {
      const [r, g, b] = hexToRgb(h);
      map.set((r << 16) | (g << 8) | b, hexToRgb(to[i]!));
    });
  }
  const d = x.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    if (d.data[i + 3]! < 8) continue;
    const t = map.get((d.data[i]! << 16) | (d.data[i + 1]! << 8) | d.data[i + 2]!);
    if (t) {
      d.data[i] = t[0];
      d.data[i + 1] = t[1];
      d.data[i + 2] = t[2];
    }
  }
  x.putImageData(d, 0, 0);
  return c;
}

/** Split a horizontal strip into per-frame canvases (crowd-cheer: 10 x 320x128, seamless-x). */
export function stripFrames(img: HTMLImageElement, frameW: number): HTMLCanvasElement[] {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const n = Math.max(1, Math.floor(w / frameW));
  const out: HTMLCanvasElement[] = [];
  for (let f = 0; f < n; f++) {
    const c = canvas(frameW, h);
    const x = c.getContext("2d")!;
    x.imageSmoothingEnabled = false;
    x.drawImage(img, f * frameW, 0, frameW, h, 0, 0, frameW, h);
    out.push(c);
  }
  return out;
}

/** Crowd-cheer frame at race time t: frame 0 at rest, the ping-pong loop while it cheers. */
export function crowdFrame(cheering: boolean, animTime: number, frames: number): number {
  return cheering ? Math.floor(animTime * 8) % frames : 0;
}

/** The crowd cheers while the leaders are on the run-in and for a while after the line. */
export function crowdCheering(leaderToGoM: number, t: number, winnerTime: number): boolean {
  return leaderToGoM < 160 && t < winnerTime + 12;
}
