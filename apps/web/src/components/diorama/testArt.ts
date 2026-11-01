/** Test-only: the served art files decoded in Node (8-bit RGBA PNGs), and the coat-layer atlas. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { atlasFromRgba, type CoatAtlas } from "@thoroughbred/art-pipeline";
import type { Rgba } from "./sheetPaint";

const ART = join(process.cwd(), "public", "art");

/** 8-bit RGBA PNG reader (the art files' format). */
export function readPng(file: string): Rgba {
  const buf = readFileSync(join(ART, file));
  let o = 8;
  let w = 0;
  let h = 0;
  const idat: Buffer[] = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString("ascii", o + 4, o + 8);
    const body = buf.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new Error(`${file}: not 8-bit RGBA`);
    } else if (type === "IDAT") idat.push(body);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[y * stride + x - 4]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4]! : 0;
      let v = line[x]!;
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 255;
    }
  }
  return { data: out, w, h };
}
export const pngs = new Map<string, Rgba>();
export const png = (f: string) => {
  let p = pngs.get(f);
  if (!p) pngs.set(f, (p = readPng(f)));
  return p;
};
let atlasMemo: CoatAtlas | null = null;
export const atlas = () => {
  if (!atlasMemo) {
    const a = png("race/coat-layers.png");
    atlasMemo = atlasFromRgba(a.data, a.w, a.h, 1);
  }
  return atlasMemo;
};

