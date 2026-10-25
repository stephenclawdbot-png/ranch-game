/**
 * Code-generated parts set, used when the PixelLab-derived atlas is missing (or still loading).
 * Same skeleton, part names and atlas channel layout as art-src/rig/build_rig.py, drawn from
 * simple primitives (ellipses, capsules, polygons) with distance-field normals, so the rig always
 * works. Node-safe: returns plain RGBA byte arrays.
 */
import { ROLE_ID, ROLES, type RigDef, type RigPartDef, type Role, type Vec2 } from "./rigdef";

type Shape =
  | { kind: "ellipse"; c: Vec2; r: Vec2 }
  | { kind: "capsule"; a: Vec2; b: Vec2; r: number }
  | { kind: "poly"; pts: Vec2[] }
  | { kind: "rect"; x0: number; y0: number; x1: number; y1: number };

interface Paint {
  shape: Shape;
  role: Role;
}

interface PartSpec {
  name: string;
  pivot: Vec2;
  parent: string | null;
  z: number;
  paints: Paint[];
  /** chamfer radius for the height field */
  R: number;
}

const W = 128;
const H = 96;
const GROUND = 86;

function inside(s: Shape, x: number, y: number): boolean {
  switch (s.kind) {
    case "ellipse": {
      const dx = (x - s.c[0]) / s.r[0];
      const dy = (y - s.c[1]) / s.r[1];
      return dx * dx + dy * dy <= 1;
    }
    case "capsule": {
      const [ax, ay] = s.a;
      const [bx, by] = s.b;
      const vx = bx - ax;
      const vy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)));
      const dx = x - (ax + vx * t);
      const dy = y - (ay + vy * t);
      return dx * dx + dy * dy <= s.r * s.r;
    }
    case "rect":
      return x >= s.x0 && x < s.x1 && y >= s.y0 && y < s.y1;
    case "poly": {
      let c = false;
      const p = s.pts;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [xi, yi] = p[i]!;
        const [xj, yj] = p[j]!;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    }
  }
}

const P = (shape: Shape, role: Role): Paint => ({ shape, role });

const SPECS: PartSpec[] = [
  { name: "tail", pivot: [37, 38], parent: "hindquarter", z: 46, R: 2.5, paints: [P({ kind: "poly", pts: [[35, 35], [39, 37], [37, 46], [35, 53], [30, 53], [31, 44]] }, "mane")] },
  { name: "tailTip", pivot: [33, 52], parent: "tail", z: 45, R: 2.5, paints: [P({ kind: "poly", pts: [[30, 52], [35.5, 52], [34.5, 62], [33, 71], [29, 70], [29, 60]] }, "mane")] },
  {
    name: "head", pivot: [101, 25], parent: "neck", z: 52, R: 3.5,
    paints: [
      P({ kind: "poly", pts: [[100, 19], [104, 14], [106, 13], [107, 19], [113, 25], [118, 31], [118, 35], [114, 37], [109, 35], [102, 33]] }, "coat"),
      P({ kind: "poly", pts: [[112, 30], [118, 31], [118, 35], [114, 37], [111, 35]] }, "muzzle"),
      P({ kind: "rect", x0: 106, y0: 22, x1: 108, y1: 23 }, "ink"),
    ],
  },
  { name: "mane", pivot: [84, 32], parent: "neck", z: 51, R: 1.5, paints: [P({ kind: "poly", pts: [[79, 31], [98, 15], [101, 17], [99, 20], [85, 33]] }, "mane")] },
  { name: "neck", pivot: [87, 40], parent: "chest", z: 50, R: 5, paints: [P({ kind: "poly", pts: [[79, 33], [98, 17], [102, 21], [102, 33], [95, 44], [82, 45]] }, "coat")] },
  { name: "foreNearHoof", pivot: [86.5, 82.5], parent: "foreNearLower", z: 64, R: 2, paints: [P({ kind: "poly", pts: [[84, 82], [88, 82], [90.5, 86], [84, 86]] }, "hoof")] },
  { name: "foreNearLower", pivot: [85, 68.5], parent: "foreNearUpper", z: 63, R: 2, paints: [P({ kind: "capsule", a: [85, 68.5], b: [86.3, 82.5], r: 2 }, "points")] },
  { name: "foreNearUpper", pivot: [85, 53.5], parent: "chest", z: 65, R: 2.5, paints: [P({ kind: "capsule", a: [85.5, 52], b: [85, 68.5], r: 3.2 }, "coat")] },
  { name: "hindNearHoof", pivot: [37, 82.5], parent: "hindNearLower", z: 61, R: 2, paints: [P({ kind: "poly", pts: [[35, 82], [39, 82], [41.5, 86], [35, 86]] }, "hoof")] },
  { name: "hindNearLower", pivot: [37.5, 66.5], parent: "hindNearUpper", z: 60, R: 2, paints: [P({ kind: "capsule", a: [37.5, 66.5], b: [37, 82.5], r: 2 }, "points")] },
  { name: "hindNearUpper", pivot: [45, 53], parent: "hindquarter", z: 62, R: 2.5, paints: [P({ kind: "capsule", a: [45, 52], b: [37.5, 66.5], r: 3.6 }, "coat")] },
  { name: "hindquarter", pivot: [55, 42], parent: "barrel", z: 40, R: 8, paints: [P({ kind: "ellipse", c: [47, 44], r: [12.5, 11.5] }, "coat")] },
  { name: "chest", pivot: [79, 42], parent: "barrel", z: 44, R: 8, paints: [P({ kind: "ellipse", c: [86, 45], r: [10, 10.5] }, "coat")] },
  {
    name: "barrel", pivot: [68, 45], parent: null, z: 42, R: 8,
    paints: [
      P({ kind: "ellipse", c: [67, 45.5], r: [14, 10.5] }, "coat"),
      P({ kind: "rect", x0: 58, y0: 34, x1: 78, y1: 48 }, "saddlecloth"),
      P({ kind: "rect", x0: 60, y0: 33, x1: 76, y1: 36 }, "tack"),
      P({ kind: "rect", x0: 70, y0: 36, x1: 72, y1: 56 }, "tack"),
    ],
  },
  {
    name: "jHead", pivot: [79.5, 18.5], parent: "jTorso", z: 84, R: 3,
    paints: [P({ kind: "ellipse", c: [82.5, 15.5], r: [3.6, 3.6] }, "skin"), P({ kind: "poly", pts: [[78.5, 15.5], [79.5, 11.5], [83, 10.5], [86, 12], [88, 15], [86, 15.5]] }, "cap")],
  },
  {
    name: "jArmNear", pivot: [76, 20], parent: "jTorso", z: 86, R: 2,
    paints: [P({ kind: "capsule", a: [76, 20], b: [85, 28.5], r: 1.8 }, "silksSecondary"), P({ kind: "ellipse", c: [86, 29.3], r: [1.6, 1.4] }, "skin")],
  },
  { name: "jTorso", pivot: [63, 24], parent: null, z: 82, R: 3, paints: [P({ kind: "capsule", a: [63, 22.5], b: [77, 17.5], r: 4.2 }, "silksPrimary")] },
  { name: "jThigh", pivot: [62, 26], parent: null, z: 80, R: 2, paints: [P({ kind: "capsule", a: [61, 26], b: [74.5, 33.5], r: 3 }, "breeches")] },
  {
    name: "jShin", pivot: [74.5, 34], parent: null, z: 79, R: 2,
    paints: [P({ kind: "capsule", a: [74.5, 34], b: [69, 41], r: 2 }, "breeches"), P({ kind: "capsule", a: [71.5, 37.5], b: [68, 44.5], r: 2.2 }, "boots")],
  },
];

const COPIES: { name: string; copyOf: string; parent: string; offset: Vec2; z: number }[] = [
  { name: "foreFarUpper", copyOf: "foreNearUpper", parent: "chest", offset: [-4, -1], z: 10 },
  { name: "foreFarLower", copyOf: "foreNearLower", parent: "foreFarUpper", offset: [-4, -1], z: 9 },
  { name: "foreFarHoof", copyOf: "foreNearHoof", parent: "foreFarLower", offset: [-4, -1], z: 11 },
  { name: "hindFarUpper", copyOf: "hindNearUpper", parent: "hindquarter", offset: [5, -1], z: 6 },
  { name: "hindFarLower", copyOf: "hindNearLower", parent: "hindFarUpper", offset: [5, -1], z: 5 },
  { name: "hindFarHoof", copyOf: "hindNearHoof", parent: "hindFarLower", offset: [5, -1], z: 7 },
  { name: "jArmFar", copyOf: "jArmNear", parent: "jTorso", offset: [2, -1], z: 20 },
];

/** 3-4 chamfer distance transform (px) inside a mask. */
export function chamferDistance(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e6;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? INF : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]!);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  for (let i = 0; i < w * h; i++) d[i] = d[i]! / 3;
  return d;
}

export interface GeneratedAtlas {
  def: RigDef;
  width: number;
  height: number;
  index: Uint8Array;
  normal: Uint8Array;
  aux: Uint8Array;
}

/** Build the fallback rig: definition + native-resolution RGBA atlases. */
export function generateFallbackRig(): GeneratedAtlas {
  interface Tile {
    spec: PartSpec;
    x0: number;
    y0: number;
    w: number;
    h: number;
    role: Uint8Array;
    t: Float32Array;
    n: Float32Array;
    hgt: Float32Array;
    aux: Uint8Array;
    rect?: [number, number, number, number];
  }
  const tiles: Tile[] = [];
  const legInfo: Record<string, { knee: number; hoofTop: number }> = {
    foreNear: { knee: 68.5, hoofTop: 82.5 },
    hindNear: { knee: 66.5, hoofTop: 82.5 },
  };
  for (const spec of SPECS) {
    const role = new Uint8Array(W * H);
    for (const p of spec.paints)
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) if (inside(p.shape, x + 0.5, y + 0.5)) role[y * W + x] = ROLE_ID[p.role];
    let x0 = W;
    let y0 = H;
    let x1 = 0;
    let y1 = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (role[y * W + x]) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x + 1);
          y1 = Math.max(y1, y + 1);
        }
    const w = x1 - x0;
    const h = y1 - y0;
    const mask = new Uint8Array(w * h);
    const r = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = role[(y + y0) * W + x + x0]!;
        r[y * w + x] = v;
        mask[y * w + x] = v ? 1 : 0;
      }
    const dist = chamferDistance(mask, w, h);
    const hgt = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const q = Math.min(dist[i]! / spec.R, 1);
      hgt[i] = mask[i] ? spec.R * Math.sqrt(Math.max(0, 1 - (1 - q) * (1 - q))) : 0;
    }
    const n = new Float32Array(w * h * 3);
    const t = new Float32Array(w * h);
    const aux = new Uint8Array(w * h * 3);
    const hv = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : hgt[y * w + x]!);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!mask[i]) continue;
        const gx = (hv(x + 1, y) - hv(x - 1, y)) / 2;
        const gy = (hv(x, y + 1) - hv(x, y - 1)) / 2;
        const len = Math.hypot(gx, gy, 1);
        n[i * 3] = -gx / len;
        n[i * 3 + 1] = gy / len; // image y down -> normal y up
        n[i * 3 + 2] = 1 / len;
        t[i] = 0.35 + 0.4 * (hgt[i]! / spec.R) * (0.6 + 0.4 * (1 - y / Math.max(1, h)));
        const sy = y + y0 + 0.5;
        if (spec.name === "head") {
          let xf = x;
          while (xf + 1 < w && mask[y * w + xf + 1]) xf++;
          aux[i * 3] = 1;
          aux[i * 3 + 1] = Math.round(Math.max(0, Math.min(1, (sy - 20) / 17)) * 255);
          aux[i * 3 + 2] = Math.round(Math.min(1, (xf - x) / 6) * 255);
        }
        const leg = /^(foreNear|hindNear)/.exec(spec.name)?.[1];
        if (leg) {
          const L = legInfo[leg]!;
          aux[i * 3] = 2;
          aux[i * 3 + 1] = Math.round(Math.max(0, Math.min(1, (L.hoofTop - sy) / (L.hoofTop - L.knee) / 2)) * 255);
        }
      }
    tiles.push({ spec, x0, y0, w, h, role: r, t, n, hgt, aux });
  }
  // shelf pack
  const AW = 128;
  let x = 1;
  let y = 1;
  let shelf = 0;
  for (const tl of [...tiles].sort((a, b) => b.h - a.h)) {
    if (x + tl.w + 1 > AW) {
      x = 1;
      y += shelf + 1;
      shelf = 0;
    }
    tl.rect = [x, y, tl.w, tl.h];
    x += tl.w + 1;
    shelf = Math.max(shelf, tl.h);
  }
  const AH = 2 ** Math.ceil(Math.log2(y + shelf + 1));
  const index = new Uint8Array(AW * AH * 4);
  const normal = new Uint8Array(AW * AH * 4);
  const aux = new Uint8Array(AW * AH * 4);
  for (const tl of tiles) {
    const [rx, ry] = tl.rect!;
    for (let yy = 0; yy < tl.h; yy++)
      for (let xx = 0; xx < tl.w; xx++) {
        const i = yy * tl.w + xx;
        const role = tl.role[i]!;
        if (!role) continue;
        const o = ((ry + yy) * AW + rx + xx) * 4;
        index[o] = role * 17;
        index[o + 1] = Math.round(tl.t[i]! * 255);
        index[o + 2] = 128;
        index[o + 3] = 255;
        normal[o] = Math.round((tl.n[i * 3]! * 0.5 + 0.5) * 255);
        normal[o + 1] = Math.round((tl.n[i * 3 + 1]! * 0.5 + 0.5) * 255);
        normal[o + 2] = Math.round((tl.n[i * 3 + 2]! * 0.5 + 0.5) * 255);
        normal[o + 3] = Math.round(Math.min(1, tl.hgt[i]! / 10) * 255);
        aux[o] = tl.aux[i * 3]! * 85;
        aux[o + 1] = tl.aux[i * 3 + 1]!;
        aux[o + 2] = tl.aux[i * 3 + 2]!;
        aux[o + 3] = 255;
      }
  }
  const byName = new Map(tiles.map((t) => [t.spec.name, t]));
  const parts: RigPartDef[] = tiles.map((t) => ({
    name: t.spec.name,
    rect: t.rect!,
    origin: [t.x0, t.y0],
    pivot: t.spec.pivot,
    parent: t.spec.parent,
    z: t.spec.z,
    side: "near",
  }));
  for (const c of COPIES) {
    const b = byName.get(c.copyOf)!;
    parts.push({
      name: c.name,
      rect: b.rect!,
      origin: [b.x0 + c.offset[0], b.y0 + c.offset[1]],
      pivot: [b.spec.pivot[0] + c.offset[0], b.spec.pivot[1] + c.offset[1]],
      parent: c.parent,
      z: c.z,
      side: "far",
      copyOf: c.copyOf,
    });
  }
  parts.sort((a, b) => a.z - b.z);
  const torso = byName.get("jTorso")!;
  const toAtlas = (p: Vec2): Vec2 => [p[0] - torso.x0 + torso.rect![0], p[1] - torso.y0 + torso.rect![1]];
  const def: RigDef = {
    version: 1,
    scale: 1,
    atlas: [AW, AH],
    canvas: [W, H],
    groundY: GROUND,
    roles: [...ROLES],
    parts,
    joints: {
      foreKnee: [85, 68.5],
      hindHock: [37.5, 66.5],
      bit: [113, 33],
      hand: [86, 29.5],
      jKnee: [74.5, 34],
      jAnkle: [68.5, 44],
      jShoulder: [76, 20],
      jNeck: [79.5, 18.5],
      saddle: [66, 36],
      cloth: [64, 39],
    },
    silksFrame: { origin: toAtlas([62, 25]), shoulder: toAtlas([78, 17]) },
    textures: { index: "", normal: "", aux: "" },
  };
  return { def, width: AW, height: AH, index, normal, aux };
}
