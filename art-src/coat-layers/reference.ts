// Coat layers, step 1: the reference horse PixelLab paints every pattern on.
//
// diorama/horse-loose-idle frame 0 (an untacked standing horse, side view, keyed) recoloured to a
// plain mid chestnut with a dark brown mane and tail and chestnut legs, at 2x (504 x 362), plus
// the inpainting masks (white = PixelLab paints there) for each kind of layer:
//   horse: every horse texel (body, face, legs, mane, tail);  head: the face (and forelock);
//   legs: the legs;  hair: the lower legs and the room around them, the tail and the room past
//   it, the mane and the top of the neck (for the long-haired feathered horse).
//   node <tsx> art-src/coat-layers/reference.ts
import { buildCoatGeometry, GEO_REGION, rgbaRoleGrid } from "../../packages/art-pipeline/src/coatGeometry";
import { ART, ROOT, blank, crop, readJson, readPng, writePng, type Img } from "./png";

export const REF_SHEET = "diorama/horse-loose-idle";
export const REF_FRAMES = 8;
export const REF_FRAME = 0;
export const REF_SCALE = 2;
export const REF_DIR = `${ROOT}/art-src/coat-layers/ref`;

type RGB = [number, number, number];
const hx = (h: string): RGB => {
  const n = Number.parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map(Math.round) as RGB;
const ramp = (stops: RGB[], n: number): RGB[] =>
  Array.from({ length: n }, (_, i) => {
    const f = n === 1 ? 0 : (i / (n - 1)) * (stops.length - 1);
    const k = Math.min(Math.floor(f), stops.length - 2);
    return mix(stops[k]!, stops[k + 1]!, f - k);
  });

export const REF_COLOURS = { shade: hx("#73371a"), body: hx("#a4552b"), highlight: hx("#d07f47"), mane: hx("#2a1a12") };

export function referenceFrame(): { img: Img; keyed: Img; fw: number; fh: number } {
  const sheet = readPng(`${ART}/${REF_SHEET}.png`);
  const fw = Math.floor(sheet.width / REF_FRAMES);
  const keyed = crop(sheet, REF_FRAME * fw, 0, fw, sheet.height);
  const pal = readJson<{ coat: string[]; mane: string[]; points: string[] }>(`${ART}/race/palette.json`);
  const c = REF_COLOURS;
  const map = new Map<number, RGB>();
  const put = (keys: string[], stops: RGB[]) => ramp(stops, keys.length).forEach((rgb, i) => map.set(Number.parseInt(keys[i]!.slice(1), 16), rgb));
  put(pal.coat, [mix(c.shade, [0, 0, 0], 0.35), c.shade, c.body, c.highlight]);
  put(pal.points, [mix(c.shade, [0, 0, 0], 0.35), c.shade, c.body]);
  put(pal.mane, [mix(c.mane, [0, 0, 0], 0.35), c.mane, mix(c.mane, [255, 255, 255], 0.18)]);
  const img = blank(fw, sheet.height);
  for (let i = 0; i < keyed.data.length; i += 4) {
    if (keyed.data[i + 3]! < 128) continue;
    const k = (keyed.data[i]! << 16) | (keyed.data[i + 1]! << 8) | keyed.data[i + 2]!;
    const rgb = map.get(k) ?? ([keyed.data[i]!, keyed.data[i + 1]!, keyed.data[i + 2]!] as RGB);
    img.data.set([...rgb, 255], i);
  }
  return { img, keyed, fw, fh: sheet.height };
}

export function referenceGeometry() {
  const { keyed, fw, fh } = referenceFrame();
  const pal = readJson<{ coat: string[]; mane: string[]; points: string[] }>(`${ART}/race/palette.json`);
  return { geo: buildCoatGeometry(rgbaRoleGrid(keyed.data, fw, fh, fw, pal)), fw, fh };
}

export function upscale(src: Img, s: number): Img {
  const out = blank(src.width * s, src.height * s);
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) {
      const si = (Math.floor(y / s) * src.width + Math.floor(x / s)) * 4;
      out.data.set(src.data.subarray(si, si + 4), (y * out.width + x) * 4);
    }
  return out;
}

export type MaskKind = "horse" | "head" | "legs" | "hair" | "body";

export function maskOf(kind: MaskKind): Img {
  const { geo, fw, fh } = referenceGeometry();
  const m = blank(fw, fh, [0, 0, 0, 255]);
  const R = GEO_REGION;
  for (let i = 0; i < fw * fh; i++) {
    const r = geo.region[i]!;
    const out = geo.outside[i]!;
    let on = false;
    if (kind === "horse") on = r > 0 && !out;
    else if (kind === "body") on = (r === R.body || r === R.mane || r === R.tail || (r >= 1 && r <= 4)) && !out;
    else if (kind === "head") on = r === R.face || (r === R.mane && geo.u[i]! > geo.H * 2.6);
    else if (kind === "legs") on = r >= 1 && r <= 4 && !out;
    else if (kind === "hair") on = (r >= 1 && r <= 4 && geo.p1[i]! < 0.45) || r === R.tail || r === R.mane || (r === R.body && geo.u[i]! > geo.H * 1.9 && geo.v[i]! < geo.H * 0.45);
    if (on) m.data.set([255, 255, 255, 255], i * 4);
  }
  // head: the face texels and everything opaque among them (ink, halter); hair: grow the mask a
  // little past the candidates (PixelLab needs room to draw strands)
  if (kind === "head") {
    const { keyed } = referenceFrame();
    const src = new Uint8Array(fw * fh);
    for (let i = 0; i < fw * fh; i++) src[i] = m.data[i * 4]! > 0 ? 1 : 0;
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        if (keyed.data[(y * fw + x) * 4 + 3]! < 128) continue;
        let near = false;
        for (let d = -2; d <= 2 && !near; d++) for (let e = -2; e <= 2 && !near; e++) if (src[Math.min(fh - 1, Math.max(0, y + d)) * fw + Math.min(fw - 1, Math.max(0, x + e))]) near = true;
        if (near) m.data.set([255, 255, 255, 255], (y * fw + x) * 4);
      }
  }
  if (kind === "hair") {
    const src = new Uint8Array(fw * fh);
    for (let i = 0; i < fw * fh; i++) src[i] = m.data[i * 4]! > 0 ? 1 : 0;
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        let near = false;
        for (let d = -2; d <= 2 && !near; d++) for (let e = -2; e <= 2 && !near; e++) if (src[Math.min(fh - 1, Math.max(0, y + d)) * fw + Math.min(fw - 1, Math.max(0, x + e))]) near = true;
        if (near) m.data.set([255, 255, 255, 255], (y * fw + x) * 4);
      }
  }
  return m;
}

if (process.argv[1]?.endsWith("reference.ts")) {
  const { img, fw, fh } = referenceFrame();
  writePng(`${REF_DIR}/reference-1x.png`, img);
  writePng(`${REF_DIR}/reference.png`, upscale(img, REF_SCALE));
  for (const k of ["horse", "head", "legs", "hair", "body"] as MaskKind[]) writePng(`${REF_DIR}/mask-${k}.png`, upscale(maskOf(k), REF_SCALE));
  console.log("reference", fw * REF_SCALE, fh * REF_SCALE);
}
