// Tiny PNG read/write for the coat-layer tools (pngjs from the workspace store; tools only).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const ART = join(ROOT, "apps/web/public/art");

function pngjs(): { PNG: { sync: { read(b: Buffer): { width: number; height: number; data: Buffer }; write(p: { width: number; height: number; data: Buffer }): Buffer } } } {
  const store = join(ROOT, "node_modules/.pnpm");
  const dir = readdirSync(store).find((d) => d.startsWith("pngjs@"));
  if (!dir) throw new Error("pngjs not found in node_modules/.pnpm (run pnpm install)");
  return createRequire(import.meta.url)(join(store, dir, "node_modules/pngjs"));
}

export interface Img {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function readPng(path: string): Img {
  const p = pngjs().PNG.sync.read(readFileSync(path));
  return { width: p.width, height: p.height, data: new Uint8ClampedArray(p.data.buffer, p.data.byteOffset, p.data.length) };
}

export function writePng(path: string, img: Img): void {
  mkdirSync(dirname(path), { recursive: true });
  const buf = pngjs().PNG.sync.write({ width: img.width, height: img.height, data: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length) });
  writeFileSync(path, buf);
}

export function blank(width: number, height: number, rgba: [number, number, number, number] = [0, 0, 0, 0]): Img {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width, height, data };
}

/** Paste src at (x, y) with alpha over, optional integer scale. */
export function paste(dst: Img, src: Img, x: number, y: number, scale = 1): void {
  for (let sy = 0; sy < src.height * scale; sy++) {
    for (let sx = 0; sx < src.width * scale; sx++) {
      const dx = x + sx;
      const dy = y + sy;
      if (dx < 0 || dy < 0 || dx >= dst.width || dy >= dst.height) continue;
      const si = (Math.floor(sy / scale) * src.width + Math.floor(sx / scale)) * 4;
      const a = src.data[si + 3]! / 255;
      if (a <= 0) continue;
      const di = (dy * dst.width + dx) * 4;
      for (let k = 0; k < 3; k++) dst.data[di + k] = src.data[si + k]! * a + dst.data[di + k]! * (1 - a);
      dst.data[di + 3] = Math.max(dst.data[di + 3]!, src.data[si + 3]!);
    }
  }
}

export function crop(src: Img, x: number, y: number, w: number, h: number): Img {
  const out = blank(w, h);
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      const sx = x + xx;
      const sy = y + yy;
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
      out.data.set(src.data.subarray((sy * src.width + sx) * 4, (sy * src.width + sx) * 4 + 4), (yy * w + xx) * 4);
    }
  return out;
}

export const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
