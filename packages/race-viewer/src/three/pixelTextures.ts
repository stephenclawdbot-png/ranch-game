/**
 * Pixel art drawn in code: every texture here is painted per pixel from a small
 * palette ramp with ordered (Bayer) dithering, never with smooth gradients. These
 * stand in for the PixelLab tiles / billboards (`race/tex-*.png`, `race/bb-*.png`)
 * until those exist; the scene swaps in the PNGs when the manifest lists them.
 */
import type { Surface, Weather } from "@thoroughbred/shared";
import { bayer, hexToRgb, mixHex, rng } from "./color";

export interface Look {
  /** Sky ramp from zenith to horizon. */
  sky: string[];
  sunColor: string;
  sunIntensity: number;
  /** Direction towards the sun (x along the track, y up, z towards the camera side). */
  sunDir: [number, number, number];
  sunDisc: string | null;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  fog: string;
  fogNear: number;
  fogFar: number;
  turf: string[];
  dirt: string[];
  grass: string[];
  hedge: string[];
  hills: string[];
  trees: string[];
  cloud: string[];
  /** Colour multiplier for unlit billboards. */
  billboardTint: string;
  /** Final grade: lift/gain tint and saturation. */
  grade: { tint: [number, number, number]; saturation: number; contrast: number };
  bloom: number;
  rain: boolean;
  cloudCount: number;
}

export const LOOKS: Record<Weather, Look> = {
  clear: {
    sky: ["#3d6fb8", "#5a8fd0", "#86b2e0", "#b9d3e6", "#f3dcae"],
    sunColor: "#ffe3b0",
    sunIntensity: 2.6,
    sunDir: [-0.55, 0.42, -0.72],
    sunDisc: "#fff3d2",
    hemiSky: "#c9dcf0",
    hemiGround: "#6b7a3a",
    hemiIntensity: 1.25,
    fog: "#e9dcb8",
    fogNear: 140,
    fogFar: 1500,
    turf: ["#3f6e25", "#4d8030", "#5b9136", "#6aa23e", "#80b54c"],
    dirt: ["#6e4428", "#82522f", "#966238", "#a87245", "#bd8a5a"],
    grass: ["#37601f", "#436f27", "#517f2e", "#5f8f35"],
    hedge: ["#1f3d17", "#2a5020", "#36632a", "#467a34"],
    hills: ["#8fa7b8", "#7d97a6", "#6c8a74", "#58765c", "#45613f"],
    trees: ["#1f3a18", "#2c4f21", "#3b652a", "#507d36", "#6b9443"],
    cloud: ["#d9dee6", "#eef1f4", "#ffffff"],
    billboardTint: "#fff4e0",
    grade: { tint: [1.04, 1.0, 0.92], saturation: 1.08, contrast: 1.05 },
    bloom: 0.14,
    rain: false,
    cloudCount: 14,
  },
  dusk: {
    sky: ["#1e1d48", "#3d2a62", "#7a3f72", "#d9675a", "#f6a65a"],
    sunColor: "#ffb070",
    sunIntensity: 2.2,
    sunDir: [-0.7, 0.16, -0.69],
    sunDisc: "#ffd28a",
    hemiSky: "#a77ea8",
    hemiGround: "#4a3f2a",
    hemiIntensity: 1.0,
    fog: "#e48a62",
    fogNear: 110,
    fogFar: 1200,
    turf: ["#334f22", "#3f612a", "#4c7231", "#5a8238", "#6e9244"],
    dirt: ["#5c3725", "#71452c", "#875535", "#9a6440", "#ad7650"],
    grass: ["#2c4a1d", "#365823", "#41662a", "#4c7330"],
    hedge: ["#1a2e14", "#24401b", "#2f5123", "#3b622c"],
    hills: ["#7b5a86", "#694c76", "#56405e", "#463650", "#352a3e"],
    trees: ["#1d2419", "#273320", "#33432a", "#405334", "#4f633e"],
    cloud: ["#b9607a", "#e08a80", "#f6b48a"],
    billboardTint: "#ffd6b8",
    grade: { tint: [1.08, 0.96, 0.9], saturation: 1.12, contrast: 1.06 },
    bloom: 0.22,
    rain: false,
    cloudCount: 10,
  },
  overcast: {
    sky: ["#7d8894", "#929ca7", "#a8b1b9", "#bcc3c9", "#ccd1d4"],
    sunColor: "#e4e8ec",
    sunIntensity: 1.1,
    sunDir: [-0.3, 0.75, -0.6],
    sunDisc: null,
    hemiSky: "#d4dae0",
    hemiGround: "#5d6a4a",
    hemiIntensity: 1.7,
    fog: "#c4cace",
    fogNear: 170,
    fogFar: 1700,
    turf: ["#3b5f2c", "#466d33", "#517b3a", "#5c8842", "#6c974d"],
    dirt: ["#5f4532", "#715239", "#836043", "#946e4e", "#a67f5d"],
    grass: ["#34532a", "#3e6031", "#486d37", "#527a3e"],
    hedge: ["#203820", "#2a4628", "#345530", "#406439"],
    hills: ["#99a3ab", "#8a959c", "#77857c", "#677568", "#566356"],
    trees: ["#24382a", "#2e4532", "#38533b", "#456246", "#557353"],
    cloud: ["#9aa3ac", "#b4bcc3", "#cdd3d8"],
    billboardTint: "#e6eaee",
    grade: { tint: [0.97, 1.0, 1.03], saturation: 0.9, contrast: 1.02 },
    bloom: 0.07,
    rain: false,
    cloudCount: 22,
  },
  rain: {
    sky: ["#3c454f", "#4c5660", "#5d6771", "#707a83", "#848d94"],
    sunColor: "#c8d0d8",
    sunIntensity: 0.8,
    sunDir: [-0.2, 0.8, -0.55],
    sunDisc: null,
    hemiSky: "#aeb8c2",
    hemiGround: "#3f4b38",
    hemiIntensity: 1.5,
    fog: "#8a939a",
    fogNear: 110,
    fogFar: 1150,
    turf: ["#2f4d25", "#38592b", "#426631", "#4c7337", "#578040"],
    dirt: ["#4a3426", "#59402e", "#684c37", "#775940", "#86664b"],
    grass: ["#2a4422", "#325028", "#3a5c2e", "#436834"],
    hedge: ["#18291a", "#213521", "#2a4228", "#345030"],
    hills: ["#6d7880", "#626d74", "#56645c", "#4a574f", "#3e4a42"],
    trees: ["#1b2a1f", "#233626", "#2c432e", "#365137", "#425f41"],
    cloud: ["#4d5660", "#5d6670", "#6e7780"],
    billboardTint: "#c8d0d6",
    grade: { tint: [0.95, 0.99, 1.05], saturation: 0.82, contrast: 1.04 },
    bloom: 0.05,
    rain: true,
    cloudCount: 26,
  },
};

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D, ImageData] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  return [c, ctx, ctx.createImageData(w, h)];
}

function put(img: ImageData, x: number, y: number, hex: string | [number, number, number], a = 255): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const [r, g, b] = typeof hex === "string" ? hexToRgb(hex) : hex;
  const i = (y * img.width + x) * 4;
  img.data[i] = r;
  img.data[i + 1] = g;
  img.data[i + 2] = b;
  img.data[i + 3] = a;
}

/** Pick a ramp entry for a continuous value v (0..1) with ordered dithering. */
function dither(ramp: string[], v: number, x: number, y: number): string {
  const f = Math.min(0.9999, Math.max(0, v)) * (ramp.length - 1);
  const i = Math.floor(f);
  return ramp[Math.min(ramp.length - 1, f - i > bayer(x, y) ? i + 1 : i)]!;
}

/** Tileable value noise on an integer lattice (periods px x py). */
function tileNoise(seed: number, px: number, py = px): (x: number, y: number) => number {
  const r = rng(seed);
  const g = Array.from({ length: px * py }, () => r());
  const at = (x: number, y: number) => g[(((y % py) + py) % py) * px + (((x % px) + px) % px)]!;
  return (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}

/** Synthetic (all-weather) surface: dark red-brown granular fibre/rubber mix. */
const SYNTHETIC = ["#2a1c1a", "#382521", "#46302a", "#553a32", "#64463c"];

/**
 * Track surface tile. u (x) runs along the track, v across it. Turf: two mowing
 * stripes per tile. Dirt: harrow lines + hoof prints. 128 x 64 px.
 */
export function surfaceTile(look: Look, surface: Surface, seed = 3): HTMLCanvasElement {
  // 128 px = 1.33 m at 96 px/m; broad mowing stripes come from the geometry.
  const W = 128;
  const H = 128;
  const [c, ctx, img] = canvas(W, H);
  const n1 = tileNoise(seed, 8, 8);
  const n2 = tileNoise(seed + 9, 32, 32);
  const r = rng(seed + 1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nz = n1((x / W) * 8, (y / H) * 8) * 0.6 + n2((x / W) * 32, (y / H) * 32) * 0.4;
      let v: number;
      if (surface === "turf") {
        v = 0.5 + (nz - 0.5) * 0.5;
      } else if (surface === "synthetic") {
        // Fine granules: mostly per-pixel grain over a gentle large-scale variation.
        v = 0.5 + (r() - 0.5) * 0.7 + (nz - 0.5) * 0.25;
      } else {
        const harrow = (y % 3 === 0 ? -0.12 : 0) + (y % 7 === 3 ? 0.08 : 0);
        v = 0.5 + (nz - 0.5) * 0.55 + harrow;
      }
      const ramp = surface === "turf" ? look.turf : surface === "synthetic" ? SYNTHETIC : look.dirt;
      put(img, x, y, dither(ramp, v, x, y));
    }
  }
  // Specks: grass tips / pebbles / hoof prints.
  const ramp = surface === "turf" ? look.turf : surface === "synthetic" ? SYNTHETIC : look.dirt;
  for (let i = 0; i < (surface === "turf" ? 420 : surface === "synthetic" ? 900 : 260); i++) {
    const x = Math.floor(r() * W);
    const y = Math.floor(r() * H);
    if (surface === "turf") {
      put(img, x, y, ramp[ramp.length - 1]!);
    } else {
      put(img, x, y, ramp[0]!);
      put(img, x + 1, y, ramp[0]!);
      if (r() < 0.4) put(img, x, y + 1, ramp[1]!);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Infield / outfield grass. 64 x 64 px. */
export function grassTile(look: Look, seed = 11): HTMLCanvasElement {
  const S = 128;
  const [c, ctx, img] = canvas(S, S);
  const n = tileNoise(seed, 8);
  const m = tileNoise(seed + 3, 64);
  const r = rng(seed);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) put(img, x, y, dither(look.grass, n((x / S) * 8, (y / S) * 8) * 0.6 + m((x / S) * 64, (y / S) * 64) * 0.4, x, y));
  for (let i = 0; i < 360; i++) put(img, Math.floor(r() * S), Math.floor(r() * S), look.grass[look.grass.length - 1]!);
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Hedge side texture (leafy clusters), 64 x 32 px, tileable in x. */
export function hedgeTile(look: Look, seed = 21): HTMLCanvasElement {
  const W = 64;
  const H = 32;
  const [c, ctx, img] = canvas(W, H);
  const n = tileNoise(seed, 16, 8);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = n((x / W) * 16, (y / H) * 8) * 0.8 + (1 - y / H) * 0.35 - 0.1;
      put(img, x, y, dither(look.hedge, v, x, y));
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Sky dome gradient (zenith at the top), dithered bands. 4 x 256 px. */
export function skyStrip(look: Look): HTMLCanvasElement {
  const H = 256;
  const [c, ctx, img] = canvas(4, H);
  for (let y = 0; y < H; y++) {
    // Rows 0..127 = upper hemisphere (zenith -> horizon); the rest repeats the horizon.
    const v = Math.min(1, y / 128);
    for (let x = 0; x < 4; x++) put(img, x, y, dither(look.sky, Math.pow(v, 1.6), x, y));
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Distant hills: two dithered ridges, seamless. 512 x 96 px. */
export function hillsStrip(look: Look, seed = 31): HTMLCanvasElement {
  const W = 512;
  const H = 96;
  const [c, ctx, img] = canvas(W, H);
  const r = rng(seed);
  const ph = [r(), r(), r(), r(), r(), r()].map((p) => p * Math.PI * 2);
  const far = (x: number) => 30 + Math.sin((x / W) * Math.PI * 2 * 2 + ph[0]!) * 12 + Math.sin((x / W) * Math.PI * 2 * 5 + ph[1]!) * 5 + Math.sin((x / W) * Math.PI * 2 * 11 + ph[2]!) * 2;
  const near = (x: number) => 58 + Math.sin((x / W) * Math.PI * 2 * 3 + ph[3]!) * 8 + Math.sin((x / W) * Math.PI * 2 * 7 + ph[4]!) * 4 + Math.sin((x / W) * Math.PI * 2 * 19 + ph[5]!) * 2;
  for (let x = 0; x < W; x++) {
    const fy = Math.round(far(x));
    const ny = Math.round(near(x));
    for (let y = fy; y < H; y++) {
      const nearRidge = y >= ny;
      const t = nearRidge ? 0.55 + ((y - ny) / (H - ny)) * 0.45 : ((y - fy) / Math.max(1, ny - fy)) * 0.45;
      put(img, x, y, dither(look.hills, t, x, y));
    }
  }
  // Tree bumps along the near ridge.
  for (let x = 0; x < W; x += 2 + Math.floor(r() * 4)) {
    const ny = Math.round(near(x));
    const rad = 2 + Math.floor(r() * 3);
    for (let dy = -rad; dy <= 0; dy++) for (let dx = -rad; dx <= rad; dx++) if (dx * dx + dy * dy <= rad * rad) put(img, (x + dx + W) % W, ny + dy, look.hills[look.hills.length - 1]!);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Pixel cloud billboard, 96 x 40 px. */
export function cloudSprite(look: Look, seed: number): HTMLCanvasElement {
  const W = 96;
  const H = 40;
  const [c, ctx, img] = canvas(W, H);
  const r = rng(seed);
  const blobs = Array.from({ length: 7 }, () => ({ x: 14 + r() * 68, y: 18 + r() * 12, rad: 7 + r() * 11 }));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let d = 0;
      for (const b of blobs) d = Math.max(d, 1 - Math.hypot(x - b.x, (y - b.y) * 1.5) / b.rad);
      if (d <= 0.02) continue;
      const shade = 1 - y / H + d * 0.4;
      put(img, x, y, dither(look.cloud, shade, x, y));
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Sun disc with two dithered glow rings, 48 x 48 px. */
export function sunSprite(look: Look): HTMLCanvasElement {
  const S = 48;
  const [c, ctx, img] = canvas(S, S);
  const disc = look.sunDisc ?? "#ffffff";
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - S / 2 + 0.5, y - S / 2 + 0.5);
      if (d < 7) put(img, x, y, disc);
      else if (d < 11 && bayer(x, y) < 0.6) put(img, x, y, mixHex(disc, look.sky[look.sky.length - 1]!, 0.35), 220);
      else if (d < 18 && bayer(x, y) < 0.22) put(img, x, y, mixHex(disc, look.sky[look.sky.length - 1]!, 0.5), 160);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Tree billboards: 0 = round oak, 1 = poplar, 2 = bush. ~40 x 56 px. */
export function treeSprite(look: Look, kind: number, seed: number): HTMLCanvasElement {
  const W = kind === 1 ? 28 : 44;
  const H = kind === 2 ? 26 : 60;
  const [c, ctx, img] = canvas(W, H);
  const r = rng(seed);
  const trunk = ["#2b1f17", "#3d2c20", "#4f3a2a"];
  if (kind !== 2) for (let y = H - 16; y < H; y++) for (let x = W / 2 - 2; x < W / 2 + 2; x++) put(img, x, y, trunk[x < W / 2 ? 0 : 1]!);
  const blobs =
    kind === 0
      ? Array.from({ length: 9 }, () => ({ x: W / 2 + (r() - 0.5) * 26, y: 18 + r() * 22, rad: 7 + r() * 6 }))
      : kind === 1
        ? Array.from({ length: 8 }, (_, i) => ({ x: W / 2 + (r() - 0.5) * 6, y: 6 + i * 6, rad: 6 + r() * 3 }))
        : Array.from({ length: 6 }, () => ({ x: W / 2 + (r() - 0.5) * 26, y: 14 + r() * 6, rad: 6 + r() * 5 }));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let d = 0;
      let lit = 0;
      for (const b of blobs) {
        const k = 1 - Math.hypot(x - b.x, y - b.y) / b.rad;
        if (k > d) {
          d = k;
          // Light from the upper left.
          lit = 0.5 + ((b.x - x) / b.rad) * 0.25 + ((b.y - y) / b.rad) * 0.35;
        }
      }
      if (d <= 0) continue;
      put(img, x, y, dither(look.trees, Math.min(1, lit * 0.8 + d * 0.3), x, y));
    }
  }
  // Selective outline.
  outline(img, look.trees[0]!);
  ctx.putImageData(img, 0, 0);
  return c;
}

function outline(img: ImageData, color: string): void {
  const { width: w, height: h, data } = img;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3]! > 0;
  const marks: [number, number][] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) marks.push([x, y]);
  for (const [x, y] of marks) put(img, x, y, color);
}

/**
 * Grandstand module (tileable in x): striped roof with bunting, tiers of crowd,
 * hospitality boxes and advertising boards. 256 x 128 px; `frame` jiggles the crowd.
 */
export function grandstandSprite(look: Look, frame: number, seed = 41): HTMLCanvasElement {
  const W = 256;
  const H = 128;
  const [c, ctx, img] = canvas(W, H);
  const tint = (h: string) => mixHex(h, look.fog, 0.1);
  // Roof canopy: cream/green stripes with a dark fascia.
  for (let x = 0; x < W; x++) {
    put(img, x, 2, tint("#f4efe2"));
    for (let y = 3; y < 18; y++) put(img, x, y, tint(Math.floor(x / 12) % 2 ? (y < 6 ? "#fbf6ea" : "#e9e2cf") : y < 6 ? "#3c7552" : "#2d5a3d"));
    put(img, x, 18, tint("#1c2a22"));
    put(img, x, 19, tint("#1c2a22"));
  }
  const bunting = ["#c8102e", "#f2c230", "#1d3f8f", "#ffffff"];
  for (let x = 1; x < W; x += 7) {
    const col = tint(bunting[Math.floor(x / 7) % bunting.length]!);
    for (let k = 0; k < 4; k++) put(img, x + k, 20, col);
    put(img, x + 1, 21, col);
    put(img, x + 2, 21, col);
    put(img, x + 2, 22, col);
  }
  // Shaded tiers.
  for (let y = 20; y < 92; y++) for (let x = 0; x < W; x++) put(img, x, y, tint(dither(["#1b2023", "#252b2f", "#30373b", "#3b4347"], (y - 20) / 72, x, y)));
  const shirts = ["#e8e2d6", "#c0392b", "#2c3e50", "#f1c40f", "#16a085", "#8e44ad", "#d35400", "#ecf0f1", "#2980b9", "#f5b7b1", "#27ae60", "#e67e22"];
  const hats = ["#3b2a20", "#e8e2d6", "#1d1d1b", "#c8102e"];
  const skins = ["#e0b48c", "#c58e64", "#8d5a3b", "#5e3b28"];
  const rr = rng(seed);
  for (let row = 0; row < 12; row++) {
    const y = 26 + row * 5 + Math.floor(row / 4);
    for (let y2 = y + 4; y2 < y + 5; y2++) for (let x = 0; x < W; x++) put(img, x, y2, tint("#15191b"));
    for (let x = 1; x < W - 1; x += 3) {
      const skip = rr() < 0.08;
      const bob = frame === 1 && rr() < 0.35 ? -1 : 0;
      const shirt = tint(shirts[Math.floor(rr() * shirts.length)]!);
      const skin = tint(skins[Math.floor(rr() * skins.length)]!);
      const hat = rr() < 0.3 ? tint(hats[Math.floor(rr() * hats.length)]!) : null;
      if (skip) continue;
      put(img, x, y + 2 + bob, shirt);
      put(img, x + 1, y + 2 + bob, shirt);
      put(img, x, y + 3 + bob, shirt);
      put(img, x + 1, y + 3 + bob, shirt);
      put(img, x, y + 1 + bob, skin);
      put(img, x + 1, y + 1 + bob, skin);
      if (hat) {
        put(img, x, y + bob, hat);
        put(img, x + 1, y + bob, hat);
      }
      if (frame === 1 && rr() < 0.06) put(img, x + (rr() < 0.5 ? -1 : 2), y + bob, skin); // waving arm
    }
  }
  // Columns.
  for (let x = 30; x < W; x += 64) for (let y = 20; y < 92; y++) {
    put(img, x, y, tint("#e6e2d6"));
    put(img, x + 1, y, tint("#e6e2d6"));
    put(img, x + 2, y, tint("#a9a59a"));
  }
  // Hospitality boxes with glass, then ad boards and the lawn wall.
  for (let x = 0; x < W; x++) {
    for (let y = 92; y < 106; y++) {
      const glass = x % 32 > 2 && x % 32 < 29 && y > 94 && y < 104;
      put(img, x, y, tint(glass ? (y < 98 ? "#b9d4e4" : y < 101 ? "#86a9bf" : "#5d7f96") : y === 92 ? "#f2eee4" : "#d6d0c2"));
    }
    const ad = ["#0b5394", "#c8102e", "#1d1d1b", "#0f6b3a", "#d9a441"][Math.floor(x / 51) % 5]!;
    for (let y = 106; y < 120; y++) {
      const letter = y > 109 && y < 116 && x % 51 > 6 && x % 51 < 44 && (x % 6 < 4) && !(y === 112 && x % 6 === 1);
      put(img, x, y, tint(letter ? "#ffffff" : ad));
    }
    for (let y = 120; y < H; y++) put(img, x, y, tint(y === 120 ? "#ffffff" : "#b9b4aa"));
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Spectators standing along the rail (tileable strip), 128 x 24 px, 2 frames. */
export function railCrowdSprite(look: Look, frame: number, seed = 87): HTMLCanvasElement {
  const W = 128;
  const H = 24;
  const [c, ctx, img] = canvas(W, H);
  const r = rng(seed);
  const shirts = ["#e8e2d6", "#c0392b", "#2c3e50", "#f1c40f", "#16a085", "#8e44ad", "#d35400", "#2980b9", "#f5b7b1", "#27ae60"];
  const skins = ["#e0b48c", "#c58e64", "#8d5a3b", "#5e3b28"];
  for (let x = 1; x < W - 3; x += 3 + Math.floor(r() * 3)) {
    const h = 15 + Math.floor(r() * 5);
    const top = H - h;
    const shirt = shirts[Math.floor(r() * shirts.length)]!;
    const skin = skins[Math.floor(r() * skins.length)]!;
    const legs = r() < 0.5 ? "#2c3440" : "#5a4a3a";
    const jump = frame === 1 && r() < 0.3 ? -1 : 0;
    for (let y = top + 3; y < H - 6; y++) for (let k = 0; k < 3; k++) put(img, x + k, y + jump, k === 2 ? mixHex(shirt, "#000000", 0.25) : shirt);
    for (let y = H - 6; y < H; y++) {
      put(img, x, y, legs);
      put(img, x + 2, y, legs);
    }
    put(img, x, top + jump, skin);
    put(img, x + 1, top + jump, skin);
    put(img, x, top + 1 + jump, skin);
    put(img, x + 1, top + 1 + jump, skin);
    put(img, x, top + 2 + jump, skin);
    put(img, x + 1, top + 2 + jump, skin);
    if (frame === 1 && r() < 0.25) {
      put(img, x + 3, top + 1 + jump, skin);
      put(img, x + 3, top + 2 + jump, shirt);
    }
  }
  outline(img, "#1a1512");
  void look;
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Waving flag frames (4) for the stand roof. 12 x 8 px each, laid out in a strip. */
export function flagStrip(color: string): HTMLCanvasElement {
  const [c, ctx, img] = canvas(48, 10);
  for (let f = 0; f < 4; f++) {
    for (let x = 0; x < 10; x++) {
      const off = Math.round(Math.sin(f * 1.57 + x * 0.7) * 1.2 * (x / 10));
      for (let y = 1; y < 7; y++) put(img, f * 12 + x + 1, y + off + 1, x > 6 && y > 3 ? mixHex(color, "#000000", 0.25) : color);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Red/white roundel for the winning post: ~1.2 m at 96 px/m, drawn per pixel. */
export function roundelSprite(size = 112): HTMLCanvasElement {
  const [c, ctx, img] = canvas(size, size);
  const R = size / 2 - 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - R, y - R) / R;
      if (d > 1) continue;
      // Light from the upper left: shade the rim a step darker on the lower right.
      const shade = (x - R + (y - R)) / (2 * R) > 0.35;
      let col = d < 0.3 ? "#d71920" : d < 0.66 ? "#f7f4ec" : "#d71920";
      if (shade) col = d < 0.3 ? "#a8121a" : d < 0.66 ? "#d9d4c8" : "#a8121a";
      if (d > 0.93) col = "#5e0a0e";
      if (d > 0.62 && d < 0.66) col = "#7a0c10";
      put(img, x, y, col);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Contact shadow: hard-edged two-step pixel ellipse, 32 x 10. */
export function blobShadow(): HTMLCanvasElement {
  const [c, ctx, img] = canvas(32, 10);
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 32; x++) {
      const d = Math.hypot((x - 15.5) / 16, (y - 4.5) / 5);
      if (d < 0.62) put(img, x, y, "#000000", 120);
      else if (d < 1) put(img, x, y, "#000000", 60);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Furlong-pole sign ("3f") at 96 px/m: crisp pixel text (canvas glyphs thresholded,
 * no anti-aliasing) on a bordered green plate, ~0.9 x 0.55 m.
 */
export function signSprite(text: string, plate = "#0f3b28"): HTMLCanvasElement {
  const W = 86;
  const H = 53;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = "#000";
  ctx.font = "bold 38px ui-monospace, Menlo, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, H / 2 + 2);
  const glyph = ctx.getImageData(0, 0, W, H);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const border = x < 3 || y < 3 || x >= W - 3 || y >= H - 3;
      const inner = x === 3 || y === 3 || x === W - 4 || y === H - 4;
      const g = glyph.data[(y * W + x) * 4 + 3]! >= 128;
      const shadow = !g && x > 0 && y > 0 && glyph.data[((y - 2) * W + (x - 2)) * 4 + 3]! >= 128;
      put(img, x, y, border ? "#f3e7c9" : inner ? "#082417" : g ? "#ffffff" : shadow ? "#082417" : y < H / 2 ? plate : "#0c3121");
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** White rail texture with a pixel shadow line (tileable). 16 x 4. */
export function railTile(): HTMLCanvasElement {
  const [c, ctx, img] = canvas(16, 4);
  for (let x = 0; x < 16; x++) {
    put(img, x, 0, "#ffffff");
    put(img, x, 1, "#f1f1ec");
    put(img, x, 2, x % 8 === 0 ? "#cfd0ca" : "#e4e4de");
    put(img, x, 3, "#b9bab4");
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Starting stall padding at 96 px/m: quilted green vinyl with stitching, 128 x 96 tile. */
export function gatePanelTile(): HTMLCanvasElement {
  const W = 128;
  const H = 96;
  const [c, ctx, img] = canvas(W, H);
  const ramp = ["#123f29", "#1a5a39", "#227048", "#2c8556", "#3d9c69"];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Quilted cells 32 x 24: lighter at the top-left of each pillow.
      const cx = (x % 32) / 32;
      const cy = (y % 24) / 24;
      const pillow = 0.75 - Math.hypot(cx - 0.4, cy - 0.35) * 0.9;
      let col = dither(ramp, pillow, x, y);
      if (x % 32 === 0 || y % 24 === 0) col = ramp[0]!;
      if ((x % 32 === 1 || y % 24 === 1) && (x + y) % 3 === 0) col = "#b9d8c4"; // stitching
      if (y < 3) col = y === 0 ? "#7fc39a" : "#4fb07c";
      if (y > H - 4) col = "#0b2a1b";
      put(img, x, y, col);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
