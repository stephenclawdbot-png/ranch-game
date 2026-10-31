// Coat layers, step 3: read every PixelLab painting (art-src/coat-layers/raw) back into horse
// space and write the atlases: apps/web/public/art/race/coat-layers.png (1x) and
// apps/web/public/art/portraits/coat-layers-2x.png (2x, the portraits).
//   node <tsx> art-src/coat-layers/extract.ts [--sheet out.png]
import { existsSync, readdirSync } from "node:fs";
import { ATLAS_CELL, ATLAS_COLS, BODY, CELL_COUNT, COAT_LAYERS, FACE, LAYER_CELL, LEGS, LEG_BODY_V, TAIL, atlasSize, spaceXY, type LayerMode } from "../../packages/art-pipeline/src/coatLayers";
import { GEO_REGION } from "../../packages/art-pipeline/src/coatGeometry";
import { ART, ROOT, blank, readPng, writePng, type Img } from "./png";
import { REF_DIR, REF_SCALE, referenceGeometry } from "./reference";
// @ts-expect-error plain JS job list
import { LAYER_JOBS } from "./jobs.mjs";

const MASK_OF = new Map<string, string>((LAYER_JOBS as { id: string; mask: string }[]).map((j) => [j.id, j.mask]));
/** Layers whose details are single hairs or freckles: the 1x copy keeps any of them (max, not mean). */
const SPARSE = new Set(["birdcatcher"]);

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
        // every texel lands in its own space, and the head and the legs in body space too (the
        // patterns read body space there, so the head, the neck and the upper legs join seamlessly)
        const value = valueOf(mode, px(ref, X, Y), px(q, X, Y), out, region);
        const targets = [spaceXY(region, geo.p1[i]!, p2, geo.u[i]! + dx, geo.v[i]! + dy, geo.H)];
        if (!out && (region === GEO_REGION.face || (region >= 1 && region <= 4 && geo.v[i]! <= geo.H * LEG_BODY_V))) targets.push(spaceXY(GEO_REGION.body, 0, 0, geo.u[i]! + dx, geo.v[i]! + dy, geo.H));
        for (const xy of targets) {
          if (!xy) continue;
          const ax = cx + Math.round(xy[0] * S);
          const ay = cy + Math.round(xy[1] * S);
          if (ax < cx || ay < cy || ax >= cx + ATLAS_CELL.w * S || ay >= cy + ATLAS_CELL.h * S) continue;
          const k = ay * size2.width + ax;
          val[k]! += value;
          cov[k]! += 1;
        }
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
        // a soft fringe from the knee / hock down: narrow at the top, widest over the fetlock,
        // drawn in again over the hoof (never a smear along the ground)
        const low = (y / (h - 1) - 0.55) / 0.45;
        if (low <= 0) {
          for (let x = 0; x < w; x++) atlas2[at(x, y)] = 0;
          continue;
        }
        const frac = 0.04 + 0.13 * (low < 0.75 ? low / 0.75 : 1 - ((low - 0.75) / 0.25) * 0.7);
        const l = Math.max(Math.min(med(left, y), zero - Math.round(w * 0.04)), zero - Math.round(w * frac));
        const r = Math.min(med(right, y), zero + Math.round(w * 0.06));
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

// The long mane: per column of the neck (body u), the painting's mane hangs from the crest down to
// its strands' ends; keep that length (smoothed along the crest, tapering to nothing at the
// withers) as one curtain from the crest, shaded by the painting, so it reads as a flowing mane
// in every pose instead of loose blocks.
for (const [id, mode, n] of COAT_LAYERS) {
  if (mode !== "hair") continue;
  for (let v = 0; v < n; v++) {
    const cell = LAYER_CELL[id] + v;
    const cx = (cell % ATLAS_COLS) * ATLAS_CELL.w * S;
    const cy = Math.floor(cell / ATLAS_COLS) * ATLAS_CELL.h * S;
    const w = Math.round((BODY.u1 - BODY.u0) * 48) * S;
    const h = Math.round((BODY.v1 - BODY.v0) * 48) * S;
    const at = (x: number, y: number) => (cy + y) * size2.width + cx + x;
    const uOf = (x: number) => BODY.u0 + (x / (w - 1)) * (BODY.u1 - BODY.u0);
    const yOf = (vh: number) => Math.round(((vh - BODY.v0) / (BODY.v1 - BODY.v0)) * (h - 1));
    const top = yOf(-0.04);
    const len: number[] = [];
    const shade: number[] = [];
    for (let x = 0; x < w; x++) {
      let y = Math.max(0, yOf(0.02));
      let sum = 0;
      let c = 0;
      let gap = 0;
      let end = -1;
      for (; y < h; y++) {
        const q = atlas2[at(x, y)]!;
        if (q >= 24) {
          end = y;
          sum += q;
          c++;
          gap = 0;
        } else if (++gap > 3 * S) break;
      }
      len.push(uOf(x) < 1.9 ? -1 : end);
      shade.push(c ? sum / c : 0);
    }
    for (let x = 0; x < w; x++) {
      const win = len.slice(Math.max(0, x - 5 * S), x + 5 * S + 1).sort((p, q) => p - q);
      let end = win[Math.floor(win.length / 2)]!;
      // a long mane: at least a third of a barrel depth down the neck (the painting's own length
      // where it is longer), tapering from the withers (u 1.9 H) over the first 0.35 H of the crest
      const u = uOf(x);
      if (u >= 1.9 && u <= 3.05) end = Math.max(end, yOf(0.34));
      if (end >= 0 && u < 2.25) end = Math.round(top + (end - top) * Math.max(0, (u - 1.9) / 0.35));
      const sh = shade[x] || 120;
      for (let y = 0; y < h; y++) {
        const k = at(x, y);
        const q = atlas2[k]!;
        atlas2[k] = end >= 0 && y >= top && y <= end ? Math.max(24, q >= 24 ? q : Math.round(sh * (x % 3 === 0 ? 0.8 : 1))) : 0;
      }
    }
  }
}

// A fuller tail: per row along the tail (a), the painting's hair from one side to the other as one
// band, at least 0.14 H wide down to 1.35 tail lengths (the long tail of the feathered horse).
for (const [id, mode, n] of COAT_LAYERS) {
  if (mode !== "hair") continue;
  for (let v = 0; v < n; v++) {
    const cell = LAYER_CELL[id] + v;
    const cx = (cell % ATLAS_COLS) * ATLAS_CELL.w * S;
    const cy = Math.floor(cell / ATLAS_COLS) * ATLAS_CELL.h * S;
    const w = TAIL.w * S;
    const h = TAIL.h * S;
    const at = (x: number, y: number) => (cy + TAIL.y * S + y) * size2.width + cx + TAIL.x * S + x;
    const mid = (w - 1) / 2;
    const minHalf = ((0.07 / (2 * TAIL.l1)) * (w - 1));
    for (let y = 0; y < h; y++) {
      const a = (y / (h - 1)) * TAIL.a1;
      let l = w;
      let r = -1;
      let sum = 0;
      let c = 0;
      for (let x = 0; x < w; x++) {
        const q = atlas2[at(x, y)]!;
        if (q < 24) continue;
        l = Math.min(l, x);
        r = Math.max(r, x);
        sum += q;
        c++;
      }
      const long = a <= 1.35;
      if (long) {
        l = Math.min(l, Math.floor(mid - minHalf * (1 - a / 1.6)));
        r = Math.max(r, Math.ceil(mid + minHalf * (1 - a / 1.6)));
      }
      const sh = c ? sum / c : 110;
      for (let x = 0; x < w; x++) {
        const q = atlas2[at(x, y)]!;
        atlas2[at(x, y)] = r >= l && x >= l && x <= r && (long || q >= 24) ? Math.max(24, q >= 24 ? q : Math.round(sh * (x % 2 ? 0.85 : 1))) : 0;
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

// Dun: the painting darkens the whole top line a little; the primitive marking is the sharp
// dorsal stripe. Per body column keep the painting's strongest darkening along the top line as a
// thin stripe (smoothed along the back); the leg barring stays as painted.
for (let v = 0; v < (COAT_LAYERS.find((l) => l[0] === "dun")?.[2] ?? 0); v++) {
  const cell = LAYER_CELL.dun + v;
  const cx = (cell % ATLAS_COLS) * ATLAS_CELL.w * S;
  const cy = Math.floor(cell / ATLAS_COLS) * ATLAS_CELL.h * S;
  const w = Math.round((BODY.u1 - BODY.u0) * 48) * S;
  const h = Math.round((BODY.v1 - BODY.v0) * 48) * S;
  const vy = (vh: number) => Math.round(((vh - BODY.v0) / (BODY.v1 - BODY.v0)) * (h - 1));
  const y0 = vy(0);
  const y1 = vy(0.12);
  const strength: number[] = [];
  for (let x = 0; x < w; x++) {
    let m = 0;
    for (let y = y0; y <= y1; y++) m = Math.max(m, atlas2[(cy + y) * size2.width + cx + x]!);
    strength.push(m);
  }
  for (let x = 0; x < w; x++) {
    const win = strength.slice(Math.max(0, x - 6), x + 7).sort((p, q) => p - q);
    const m = win[Math.floor(win.length / 2)]!;
    for (let y = 0; y < h; y++) {
      const k = (cy + y) * size2.width + cx + x;
      atlas2[k] = y >= vy(0.015) && y <= vy(0.065) && m > 60 ? Math.max(200, m) : 0;
    }
  }
}

// Ticking (roan, rabicano, varnish, greying) becomes a density: the share of the painting's white
// hairs around each point (the painters scatter fine single hairs at that density, fixed to the
// body), so it reads as even white hairs at any scale, never as coarse blots.
for (const [id, mode, n] of COAT_LAYERS) {
  if (mode !== "tick") continue;
  for (let v = 0; v < n; v++) {
    const cell = LAYER_CELL[id] + v;
    const cx = (cell % ATLAS_COLS) * ATLAS_CELL.w * S;
    const cy = Math.floor(cell / ATLAS_COLS) * ATLAS_CELL.h * S;
    const w = ATLAS_CELL.w * S;
    const h = ATLAS_CELL.h * S;
    const src = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) src[y * w + x] = atlas2[(cy + y) * size2.width + cx + x]! >= 128 ? 1 : 0;
    const r = 3 * S;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s2 = 0;
        let c = 0;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            s2 += src[yy * w + xx]!;
            c++;
          }
        // a pixel with no hair near it stays 0 (the solid head and legs keep their colour)
        atlas2[(cy + y) * size2.width + cx + x] = s2 ? Math.min(255, Math.round((s2 / c) * 255 * 1.6)) : 0;
      }
  }
}

// Binary layers stay binary (white, skin: on at half coverage); hair keeps its shade.
for (const [id, mode, n] of COAT_LAYERS) {
  if (mode === "dark" || mode === "light" || mode === "hair" || mode === "tick") continue;
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

// White patterns are shapes: a majority (median) filter over each space removes the single-pixel
// lines and specks the read-back leaves (texels whose geometry wobbles on the reference), so the
// patches keep clean edges in every pose. Birdcatcher freckles are specks by design: kept.
for (const [id, mode, n] of COAT_LAYERS) {
  if (mode !== "white" || id === "birdcatcher") continue;
  for (let v = 0; v < n; v++) {
    const cell = LAYER_CELL[id] + v;
    const cx = (cell % ATLAS_COLS) * ATLAS_CELL.w * S;
    const cy = Math.floor(cell / ATLAS_COLS) * ATLAS_CELL.h * S;
    const r = id.startsWith("face-") || id.startsWith("leg-") ? 1 : 2;
    for (const sp of spaces) {
      const w = sp.w * S;
      const h = sp.h * S;
      const at = (x: number, y: number) => (cy + sp.y * S + y) * size2.width + cx + sp.x * S + x;
      const src = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) src[y * w + x] = atlas2[at(x, y)]! >= 128 ? 1 : 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let on = 0;
          let tot = 0;
          for (let dy = -r; dy <= r; dy++)
            for (let dx = -r; dx <= r; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
              on += src[yy * w + xx]!;
              tot++;
            }
          atlas2[at(x, y)] = on * 2 > tot ? 255 : 0;
        }
    }
  }
}

// White on the legs (pinto white legs, socks and stockings): per leg and per height one value,
// the painting's majority across the leg, so leg white is a clean band that rides up and down
// with the leg in every pose (no streaks along a swinging leg). Spotted patterns keep their spots.
const BANDED = new Set(["tobiano", "tobiano-ink", "splash", "splash2", "sabino1", "sabino2", "blanket", "fewspot", "leg-coronet", "leg-sock", "leg-stocking"]);
for (const [id, , n] of COAT_LAYERS) {
  if (!BANDED.has(id)) continue;
  for (let v = 0; v < n; v++) {
    const cell = LAYER_CELL[id] + v;
    const cx = (cell % ATLAS_COLS) * ATLAS_CELL.w * S;
    const cy = Math.floor(cell / ATLAS_COLS) * ATLAS_CELL.h * S;
    const w = LEGS.w * S;
    const zero = Math.round((-LEGS.s0 / (LEGS.s1 - LEGS.s0)) * (w - 1));
    const half = Math.round((0.1 / (LEGS.s1 - LEGS.s0)) * (w - 1)); // the leg itself: +-0.1 H
    for (let k = 0; k < 4; k++) {
      const at = (x: number, y: number) => (cy + (LEGS.y * S + y)) * size2.width + cx + (LEGS.x + k * LEGS.w) * S + x;
      const rows: number[] = [];
      for (let y = 0; y < LEGS.h * S; y++) {
        let on = 0;
        let tot = 0;
        for (let x = zero - half; x <= zero + half; x++) {
          tot++;
          if (atlas2[at(x, y)]! >= 128) on++;
        }
        rows.push(on * (id === "leg-coronet" ? 3 : 2) > tot ? 255 : 0);
      }
      // smooth the band edges over a few rows (no single-row flicker)
      const sm = id.startsWith("leg-") ? 0 : 2 * S; // a coronet is only a few rows: no smoothing
      for (let y = 0; y < rows.length; y++) {
        const win = rows.slice(Math.max(0, y - sm), y + sm + 1);
        const val = win.filter((q) => q > 0).length * 2 > win.length ? 255 : 0;
        for (let x = 0; x < w; x++) atlas2[at(x, y)] = val;
      }
    }
  }
}

// Leg markings: one drawn shape per variant for every leg (the painting's clearest leg; a variant
// the painting lost entirely takes its sibling's), so a sock is the same sock on any leg.
for (const [id, , n] of COAT_LAYERS) {
  if (!id.startsWith("leg-")) continue;
  const blockOf = (cell: number, k: number) => {
    const cx = (cell % ATLAS_COLS) * ATLAS_CELL.w * S;
    const cy = Math.floor(cell / ATLAS_COLS) * ATLAS_CELL.h * S;
    const out: number[] = [];
    for (let y = 0; y < LEGS.h * S; y++) for (let x = 0; x < LEGS.w * S; x++) out.push((cy + LEGS.y * S + y) * size2.width + cx + (LEGS.x + k * LEGS.w) * S + x);
    return out;
  };
  const cover = (idx: number[]) => idx.reduce((c, k) => c + (atlas2[k]! >= 128 ? 1 : 0), 0);
  const best: number[][] = [];
  for (let v = 0; v < n; v++) {
    const cell = LAYER_CELL[id] + v;
    let top: number[] = [];
    let topN = -1;
    for (let k = 0; k < 4; k++) {
      const b = blockOf(cell, k);
      const c = cover(b);
      if (c > topN) {
        topN = c;
        top = b;
      }
    }
    best.push(topN > 0 ? top.map((k) => atlas2[k]!) : []);
  }
  for (let v = 0; v < n; v++) {
    const vals = best[v]!.length ? best[v]! : best.find((b) => b.length) ?? [];
    if (!vals.length) continue;
    for (let k = 0; k < 4; k++) blockOf(LAYER_CELL[id] + v, k).forEach((at, j) => (atlas2[at] = vals[j]!));
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
  if (mode === "dark" || mode === "light" || mode === "hair" || mode === "tick") continue;
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
