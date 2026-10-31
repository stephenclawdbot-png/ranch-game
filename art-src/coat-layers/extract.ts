// Coat layers, step 3: read every PixelLab painting (art-src/coat-layers/raw) back into horse
// space and write the atlases: apps/web/public/art/race/coat-layers.png (1x) and
// apps/web/public/art/portraits/coat-layers-2x.png (2x, the portraits).
//   node <tsx> art-src/coat-layers/extract.ts [--sheet out.png]
import { existsSync, readdirSync } from "node:fs";
import { ATLAS_CELL, ATLAS_COLS, BODY, CELL_COUNT, COAT_LAYERS, FACE, LAYER_CELL, LEGS, TAIL, atlasSize, spaceXY, type LayerMode } from "../../packages/art-pipeline/src/coatLayers";
import { GEO_REGION } from "../../packages/art-pipeline/src/coatGeometry";
import { ART, ROOT, blank, readPng, writePng, type Img } from "./png";
import { REF_DIR, REF_SCALE, referenceGeometry } from "./reference";
// @ts-expect-error plain JS job list
import { LAYER_JOBS } from "./jobs.mjs";

const MASK_OF = new Map<string, string>((LAYER_JOBS as { id: string; mask: string }[]).map((j) => [j.id, j.mask]));
/** Layers whose details are single hairs or freckles: the 1x copy keeps any of them (max, not mean). */
const SPARSE = new Set(["birdcatcher", "roan", "rabicano", "greying", "varnish"]);

const RAW = `${ROOT}/art-src/coat-layers/raw`;
const S = 2; // atlas scale written first (the 1x atlas is its 2:1 copy)
const { geo, fw, fh } = referenceGeometry();
const ref = readPng(`${REF_DIR}/reference.png`);
const size2 = atlasSize(S);
const val = new Float32Array(size2.width * size2.height);
const cov = new Float32Array(size2.width * size2.height);

const px = (img: Img, x: number, y: number) => {
  const i = (y * img.width + x) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!] as const;
};
const luma = (c: readonly number[]) => 0.299 * c[0]! + 0.587 * c[1]! + 0.114 * c[2]!;
const chroma = (c: readonly number[]) => Math.max(c[0]!, c[1]!, c[2]!) - Math.min(c[0]!, c[1]!, c[2]!);
const isWhite = (c: readonly number[]) => c[3]! >= 128 && chroma(c) <= 56 && luma(c) >= 118;

function valueOf(mode: LayerMode, r: readonly number[], q: readonly number[], outside: boolean, region: number): number {
  if (q[3]! < 128) return 0;
  switch (mode) {
    case "white":
      return isWhite(q) && !isWhite(r) ? 255 : 0;
    case "tick":
      return luma(q) - luma(r) >= 26 && chroma(q) < chroma(r) ? 255 : 0;
    case "dark": {
      const d = (luma(r) - luma(q)) / Math.max(30, luma(r));
      return d > 0.08 ? Math.round(Math.min(1, d * 1.6) * 255) : 0;
    }
    case "light": {
      const d = (luma(q) - luma(r)) / Math.max(30, 255 - luma(r));
      return d > 0.08 ? Math.round(Math.min(1, d * 1.6) * 255) : 0;
    }
    case "skin":
      return q[0]! - q[1]! >= 25 && luma(q) >= luma(r) + 12 ? 255 : 0;
    case "hair": {
      // the feathered painting has no background: anything opaque past the reference outline is
      // hair; inside it, what the painting changed (strands over the legs and down the neck)
      const L = luma(q);
      const changed = outside || r[3]! < 128 || Math.abs(luma(r) - L) > 14 || chroma(q) < chroma(r) - 30 || region === GEO_REGION.tail || region === GEO_REGION.mane;
      return changed ? 1 + Math.round(Math.min(1, L / 170) * 254) : 0;
    }
  }
}

let filled = 0;
const missing: string[] = [];
for (const [id, mode, n] of COAT_LAYERS) {
  for (let v = 0; v < n; v++) {
    const file = existsSync(RAW) ? readdirSync(RAW).find((f) => f.startsWith(`${id}-${v}-`) && f.endsWith("-0.png")) : undefined;
    if (!file) {
      missing.push(`${id}#${v}`);
      continue;
    }
    const q = readPng(`${RAW}/${file}`);
    const cell = LAYER_CELL[id] + v;
    const cx = (cell % ATLAS_COLS) * ATLAS_CELL.w * S;
    const cy = Math.floor(cell / ATLAS_COLS) * ATLAS_CELL.h * S;
    for (let Y = 0; Y < fh * REF_SCALE; Y++)
      for (let X = 0; X < fw * REF_SCALE; X++) {
        const x = Math.floor(X / REF_SCALE);
        const y = Math.floor(Y / REF_SCALE);
        const i = y * fw + x;
        const region = geo.region[i]!;
        if (!region) continue;
        const out = geo.outside[i]! === 1;
        if (out && mode !== "hair") continue;
        const dx = (X % REF_SCALE) / REF_SCALE - 0.25;
        const dy = (Y % REF_SCALE) / REF_SCALE - 0.25;
        const p2 = region === GEO_REGION.face ? geo.p2[i]! - dx : region >= 1 && region <= 4 ? geo.p2[i]! + dx : geo.p2[i]!;
        const xy = spaceXY(region, geo.p1[i]!, p2, geo.u[i]! + dx, geo.v[i]! + dy, geo.H);
        if (!xy) continue;
        const ax = cx + Math.round(xy[0] * S);
        const ay = cy + Math.round(xy[1] * S);
        if (ax < cx || ay < cy || ax >= cx + ATLAS_CELL.w * S || ay >= cy + ATLAS_CELL.h * S) continue;
        const k = ay * size2.width + ax;
        val[k]! += valueOf(mode, px(ref, X, Y), px(q, X, Y), out, region);
        cov[k]! += 1;
      }
    filled++;
  }
}

// Fill each space of each cell: uncovered atlas pixels take the nearest covered value (so frames
// that reach past the reference pose still read the drawn pattern next to it).
const spaces = [
  { x: BODY.x, y: BODY.y, w: Math.round((BODY.u1 - BODY.u0) * 48), h: Math.round((BODY.v1 - BODY.v0) * 48) },
  { x: FACE.x, y: FACE.y, w: FACE.w, h: FACE.h },
  { x: TAIL.x, y: TAIL.y, w: TAIL.w, h: TAIL.h },
  ...[0, 1, 2, 3].map((k) => ({ x: LEGS.x + k * LEGS.w, y: LEGS.y, w: LEGS.w, h: LEGS.h })),
];
const atlas2 = new Uint8Array(size2.width * size2.height);
for (let cell = 0; cell < CELL_COUNT; cell++) {
  const cx = (cell % ATLAS_COLS) * ATLAS_CELL.w * S;
  const cy = Math.floor(cell / ATLAS_COLS) * ATLAS_CELL.h * S;
  for (const sp of spaces) {
    const w = sp.w * S;
    const h = sp.h * S;
    const vals = new Float32Array(w * h).fill(-1);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = (cy + sp.y * S + y) * size2.width + cx + sp.x * S + x;
        if (cov[k]! > 0) vals[y * w + x] = val[k]! / cov[k]!;
      }
    // multi-pass 4-neighbour dilation until every pixel is known (or nothing is)
    let unknown = vals.reduce((n, v) => n + (v < 0 ? 1 : 0), 0);
    if (unknown === w * h) continue;
    // a few pixels past the painted pose (frames reach a little further than the reference);
    // beyond that the layer is empty, never a smear of its edge
    for (let pass = 0; pass < 10 * S && unknown > 0; pass++) {
      const next = vals.slice();
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (vals[y * w + x]! >= 0) continue;
          let s = 0;
          let c = 0;
          for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const xx = x + ox;
            const yy = y + oy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const q = vals[yy * w + xx]!;
            if (q >= 0) {
              s += q;
              c++;
            }
          }
          if (c) {
            next[y * w + x] = s / c;
            unknown--;
          }
        }
      vals.set(next);
    }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) atlas2[(cy + sp.y * S + y) * size2.width + cx + sp.x * S + x] = Math.max(0, Math.round(vals[y * w + x]!));
  }
}

// The far legs are mostly hidden behind the near ones on the reference: a far leg block with
// little coverage takes its near twin's block (front-far <- front-near, hind-far <- hind-near).
for (let cell = 0; cell < CELL_COUNT; cell++) {
  const cx = (cell % ATLAS_COLS) * ATLAS_CELL.w * S;
  const cy = Math.floor(cell / ATLAS_COLS) * ATLAS_CELL.h * S;
  const coverage = (k: number) => {
    let c = 0;
    for (let y = 0; y < LEGS.h * S; y++) for (let x = 0; x < LEGS.w * S; x++) if (cov[(cy + LEGS.y * S + y) * size2.width + cx + (LEGS.x + k * LEGS.w) * S + x]! > 0) c++;
    return c;
  };
  for (const [near, far] of [[0, 1], [2, 3]] as const) {
    if (coverage(far) >= coverage(near) * 0.6) continue;
    for (let y = 0; y < LEGS.h * S; y++)
      for (let x = 0; x < LEGS.w * S; x++) {
        const row = (cy + LEGS.y * S + y) * size2.width + cx;
        atlas2[row + (LEGS.x + far * LEGS.w) * S + x] = atlas2[row + (LEGS.x + near * LEGS.w) * S + x]!;
      }
  }
}

// Leg feathering: the painting's strands around each lower leg become one clean skirt per leg
// (per row: from the leg out to the painting's farthest strand, rows smoothed), shaded by the
// painting, so it reads as hair in every pose instead of loose specks.
for (const [id, mode, n] of COAT_LAYERS) {
  if (mode !== "hair") continue;
  for (let v = 0; v < n; v++) {
    const cell = LAYER_CELL[id] + v;
    const cx = (cell % ATLAS_COLS) * ATLAS_CELL.w * S;
    const cy = Math.floor(cell / ATLAS_COLS) * ATLAS_CELL.h * S;
    const w = LEGS.w * S;
    const h = LEGS.h * S;
    const zero = Math.round((-LEGS.s0 / (LEGS.s1 - LEGS.s0)) * (w - 1));
    for (let k = 0; k < 4; k++) {
      const at = (x: number, y: number) => (cy + LEGS.y * S + y) * size2.width + cx + (LEGS.x + k * LEGS.w) * S + x;
      const left: number[] = [];
      const right: number[] = [];
      const shade: number[] = [];
      for (let y = 0; y < h; y++) {
        let l = zero;
        let r = zero;
        let sum = 0;
        let cnt = 0;
        for (let x = 0; x < w; x++) {
          const q = atlas2[at(x, y)]!;
          if (q < 24) continue;
          // a strand counts when its neighbour in the row is hair too (no single specks)
          const nb = (x > 0 && atlas2[at(x - 1, y)]! >= 24) || (x < w - 1 && atlas2[at(x + 1, y)]! >= 24);
          if (!nb) continue;
          if (x < l) l = x;
          if (x > r) r = x;
          sum += q;
          cnt++;
        }
        left.push(l);
        right.push(r);
        shade.push(cnt ? sum / cnt : 0);
      }
      const med = (a: number[], y: number) => {
        const win = a.slice(Math.max(0, y - 4), Math.min(a.length, y + 5)).sort((p, q) => p - q);
        return win[Math.floor(win.length / 2)]!;
      };
      for (let y = 0; y < h; y++) {
        // feathers grow from the fetlock down (the lowest 30 % of the leg) and stand out a few
        // texels behind it, wider toward the hoof
        const low = (y / (h - 1) - 0.7) / 0.3;
        if (low <= 0) {
          for (let x = 0; x < w; x++) atlas2[at(x, y)] = 0;
          continue;
        }
        const l = Math.max(med(left, y), zero - Math.round(w * (0.08 + 0.14 * low)));
        const r = Math.min(med(right, y), zero + Math.round(w * 0.1));
        const sh = med(shade, y) || 120;
        for (let x = 0; x < w; x++) {
          const inside = x >= l && x <= r && r > l;
          const q = atlas2[at(x, y)]!;
          // keep the painted shade where it is, the row's shade elsewhere; strands every other column
          atlas2[at(x, y)] = inside ? Math.max(24, q >= 24 ? q : Math.round(sh * (x % 2 ? 0.85 : 1))) : 0;
        }
      }
    }
  }
}

// Whole-leg patterns: the far leg of each pair shows what the near leg shows (near and far swap
// as the legs pass each other, and a pattern must not jump between them).
for (const [id, , n] of COAT_LAYERS) {
  if (id.startsWith("leg-")) continue;
  for (let v = 0; v < n; v++) {
    const cell = LAYER_CELL[id] + v;
    const cx = (cell % ATLAS_COLS) * ATLAS_CELL.w * S;
    const cy = Math.floor(cell / ATLAS_COLS) * ATLAS_CELL.h * S;
    for (const [near, far] of [[0, 1], [2, 3]] as const)
      for (let y = 0; y < LEGS.h * S; y++)
        for (let x = 0; x < LEGS.w * S; x++) {
          const row = (cy + LEGS.y * S + y) * size2.width + cx;
          atlas2[row + (LEGS.x + far * LEGS.w) * S + x] = atlas2[row + (LEGS.x + near * LEGS.w) * S + x]!;
        }
  }
}

// Binary layers stay binary (white, tick, skin: on at half coverage); hair keeps its shade.
for (const [id, mode, n] of COAT_LAYERS) {
  if (mode === "dark" || mode === "light" || mode === "hair") continue;
  for (let v = 0; v < n; v++) {
    const cell = LAYER_CELL[id] + v;
    const cx = (cell % ATLAS_COLS) * ATLAS_CELL.w * S;
    const cy = Math.floor(cell / ATLAS_COLS) * ATLAS_CELL.h * S;
    for (let y = 0; y < ATLAS_CELL.h * S; y++)
      for (let x = 0; x < ATLAS_CELL.w * S; x++) {
        const k = (cy + y) * size2.width + cx + x;
        atlas2[k] = atlas2[k]! >= 128 ? 255 : 0;
      }
  }
}
// hair: keep strands where most of the samples were hair (values < 64 averaged with zeros read as no hair)
for (const [id, mode, n] of COAT_LAYERS) {
  if (mode !== "hair") continue;
  for (let v = 0; v < n; v++) {
    const cell = LAYER_CELL[id] + v;
    const cx = (cell % ATLAS_COLS) * ATLAS_CELL.w * S;
    const cy = Math.floor(cell / ATLAS_COLS) * ATLAS_CELL.h * S;
    for (let y = 0; y < ATLAS_CELL.h * S; y++)
      for (let x = 0; x < ATLAS_CELL.w * S; x++) {
        const k = (cy + y) * size2.width + cx + x;
        if (atlas2[k]! < 24) atlas2[k] = 0;
      }
  }
}

// A layer painted with the head mask lives on the face only; with the legs mask on the legs only
// (anything PixelLab touched elsewhere, like the halter, is not part of the marking).
for (const [id, , n] of COAT_LAYERS) {
  const mask = MASK_OF.get(id);
  if (mask !== "head" && mask !== "legs") continue;
  for (let v = 0; v < n; v++) {
    const cell = LAYER_CELL[id] + v;
    const cx = (cell % ATLAS_COLS) * ATLAS_CELL.w * S;
    const cy = Math.floor(cell / ATLAS_COLS) * ATLAS_CELL.h * S;
    const keep = mask === "head" ? spaces[1]! : null;
    for (let y = 0; y < ATLAS_CELL.h * S; y++)
      for (let x = 0; x < ATLAS_CELL.w * S; x++) {
        const inKeep = keep ? x >= keep.x * S && x < (keep.x + keep.w) * S && y >= keep.y * S && y < (keep.y + keep.h) * S : y >= LEGS.y * S && y < (LEGS.y + LEGS.h) * S && x < (LEGS.x + 4 * LEGS.w) * S;
        if (!inKeep) atlas2[(cy + y) * size2.width + cx + x] = 0;
      }
  }
}

const toImg = (data: Uint8Array, w: number, h: number): Img => {
  const img = blank(w, h);
  for (let i = 0; i < data.length; i++) img.data.set([data[i]!, data[i]!, data[i]!, 255], i * 4);
  return img;
};
const size1 = atlasSize(1);
const atlas1 = new Uint8Array(size1.width * size1.height);
const sparseCell = new Uint8Array(CELL_COUNT);
for (const id of SPARSE) for (let v = 0; v < (COAT_LAYERS.find((l) => l[0] === id)?.[2] ?? 0); v++) sparseCell[LAYER_CELL[id as keyof typeof LAYER_CELL] + v] = 1;
for (let y = 0; y < size1.height; y++)
  for (let x = 0; x < size1.width; x++) {
    let s = 0;
    let m = 0;
    for (let k = 0; k < 4; k++) {
      const q = atlas2[(y * 2 + (k >> 1)) * size2.width + x * 2 + (k & 1)]!;
      s += q;
      m = Math.max(m, q);
    }
    const cell = Math.floor(y / ATLAS_CELL.h) * ATLAS_COLS + Math.floor(x / ATLAS_CELL.w);
    atlas1[y * size1.width + x] = sparseCell[cell] ? m : Math.round(s / 4);
  }
// re-binarise the 1x copy the same way
for (const [id, mode, n] of COAT_LAYERS) {
  if (mode === "dark" || mode === "light" || mode === "hair") continue;
  for (let v = 0; v < n; v++) {
    const cell = LAYER_CELL[id] + v;
    const cx = (cell % ATLAS_COLS) * ATLAS_CELL.w;
    const cy = Math.floor(cell / ATLAS_COLS) * ATLAS_CELL.h;
    for (let y = 0; y < ATLAS_CELL.h; y++) for (let x = 0; x < ATLAS_CELL.w; x++) atlas1[(cy + y) * size1.width + cx + x] = atlas1[(cy + y) * size1.width + cx + x]! >= 128 ? 255 : 0;
  }
}
writePng(`${ART}/race/coat-layers.png`, toImg(atlas1, size1.width, size1.height));
writePng(`${ART}/portraits/coat-layers-2x.png`, toImg(atlas2, size2.width, size2.height));
console.log("cells", filled, "/", CELL_COUNT, missing.length ? `missing ${missing.join(" ")}` : "");
