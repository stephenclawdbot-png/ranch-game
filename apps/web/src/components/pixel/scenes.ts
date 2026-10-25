/**
 * Code-drawn pixel-art scene layers (golden-hour racecourse). Each layer is painted with
 * fillRect on a small canvas (W x H native pixels), then shown with nearest-neighbour
 * upscaling. All horizontal features are periodic in W so layers tile seamlessly.
 */
export const SCENE_W = 384;
export const SCENE_H = 96;

export type SceneVariant = "paddock" | "stable" | "grandstand" | "barn";
export type LayerName = "sky" | "far" | "mid" | "near";
type Ctx = CanvasRenderingContext2D;

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number) => (BAYER[(y % 4) * 4 + (x % 4)]! + 0.5) / 16;
const TAU = Math.PI * 2;
/** Periodic wave over W. */
const wave = (x: number, k: number, phase = 0) => Math.sin((x / SCENE_W) * TAU * k + phase);

function px(ctx: Ctx, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}
/** Draw at x and also wrapped copies so the layer tiles. */
function wrapX(x: number, w: number, draw: (x: number) => void) {
  const xx = ((x % SCENE_W) + SCENE_W) % SCENE_W;
  draw(xx);
  if (xx + w > SCENE_W) draw(xx - SCENE_W);
}

/** Banded sky with ordered dithering between bands. */
function sky(ctx: Ctx, bands: string[], sun?: { x: number; y: number; r: number; colors: string[] }) {
  const n = bands.length - 1;
  for (let y = 0; y < SCENE_H; y++) {
    const t = (y / (SCENE_H - 1)) * n;
    const i = Math.min(n - 1, Math.floor(t));
    const f = t - i;
    for (let x = 0; x < SCENE_W; x++) {
      // solid bands with a short 2-step dither seam between them (cleaner than full dithering)
      const g = f < 0.72 ? 0 : f > 0.9 ? 1 : (x + y) % 2 === 0 ? 1 : 0;
      px(ctx, x, y, 1, 1, g ? bands[i + 1]! : bands[i]!);
    }
  }
  if (sun) {
    sun.colors.forEach((c, k) => {
      const r = sun.r * (1 + (sun.colors.length - 1 - k) * 0.55);
      for (let y = -Math.ceil(r); y <= r; y++)
        for (let x = -Math.ceil(r); x <= r; x++) {
          const d = Math.hypot(x, y);
          if (d <= r && (k === sun.colors.length - 1 || bayer(x + 64, y + 64) < 0.5 + 0.5 * (1 - d / r))) px(ctx, sun.x + x, sun.y + y, 1, 1, c);
        }
    });
  }
  // a few flat pixel clouds
  const rand = rng(7);
  for (let i = 0; i < 6; i++) {
    const cx = Math.floor(rand() * SCENE_W);
    const cy = 8 + Math.floor(rand() * 26);
    const w = 18 + Math.floor(rand() * 26);
    wrapX(cx, w, (x) => {
      px(ctx, x + 4, cy, w - 8, 2, "#fbe7c0");
      px(ctx, x, cy + 2, w, 3, "#f6d9a8");
      px(ctx, x + 2, cy + 5, w - 4, 1, "#e6b98a");
    });
  }
}

function hills(ctx: Ctx, base: number, amp: number, k: number[], color: string, rim: string, seed: number) {
  for (let x = 0; x < SCENE_W; x++) {
    let h = 0;
    k.forEach((kk, i) => (h += wave(x, kk, seed + i * 1.7) / (i + 1)));
    const top = Math.round(base - amp * (0.5 + 0.5 * h));
    px(ctx, x, top, 1, SCENE_H - top, color);
    px(ctx, x, top, 1, 1, rim);
  }
}

function treeLine(ctx: Ctx, base: number, seed: number, dark: string, mid: string, light: string, count = 22) {
  const rand = rng(seed);
  for (let i = 0; i < count; i++) {
    const cx = Math.floor((i / count) * SCENE_W + rand() * 10);
    const r = 4 + Math.floor(rand() * 6);
    wrapX(cx - r, r * 2 + 1, (x0) => {
      const cxx = x0 + r;
      for (let y = -r; y <= r; y++)
        for (let x = -r; x <= r; x++) {
          const d = Math.hypot(x, y * 1.15);
          if (d > r) continue;
          const lit = x + y < -r * 0.4 ? light : x + y > r * 0.5 ? dark : mid;
          px(ctx, cxx + x, base - r + y, 1, 1, lit);
        }
      px(ctx, cxx, base, 1, 3, "#3b2a1a");
    });
  }
}

function fence(ctx: Ctx, y: number, spacing = 24) {
  for (let x = 0; x < SCENE_W; x++) {
    px(ctx, x, y, 1, 2, "#f6efdc");
    px(ctx, x, y + 2, 1, 1, "#a9a28f");
    px(ctx, x, y + 6, 1, 2, "#f6efdc");
    px(ctx, x, y + 8, 1, 1, "#a9a28f");
  }
  for (let x = 0; x < SCENE_W; x += spacing) {
    px(ctx, x, y - 2, 3, 14, "#f6efdc");
    px(ctx, x + 2, y - 2, 1, 14, "#b8b09b");
    px(ctx, x, y - 3, 3, 1, "#ffffff");
  }
}

const HORSE = [
  "............hh..",
  "...........hhhh.",
  "..........hhhhhh",
  "..hhhhhhhhhhh.hh",
  ".hhhhhhhhhhhh...",
  "hhhhhhhhhhhh....",
  "h.hhhhhhhhhh....",
  "..hh.....hh.....",
  "..h.h....h.h....",
  "..h.h....h.h....",
  "..h.h....h.h....",
];
function sprite(ctx: Ctx, rows: string[], x: number, y: number, pal: Record<string, string>, flip = false) {
  rows.forEach((r, yy) =>
    [...r].forEach((ch, xx) => {
      const c = pal[ch];
      if (c) px(ctx, flip ? x + r.length - 1 - xx : x + xx, y + yy, 1, 1, c);
    }),
  );
}

function grass(ctx: Ctx, top: number, seed: number, a = "#3f8558", b = "#367a4e", tuft = "#5aa66f") {
  for (let y = top; y < SCENE_H; y++)
    for (let x = 0; x < SCENE_W; x++) {
      const stripe = Math.floor((x + (y - top) * 2) / 32) % 2 === 0;
      px(ctx, x, y, 1, 1, stripe ? a : b);
    }
  const rand = rng(seed);
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(rand() * SCENE_W);
    const y = top + 2 + Math.floor(rand() * (SCENE_H - top - 3));
    px(ctx, x, y, 1, 2, tuft);
    px(ctx, x + 1, y + 1, 1, 1, tuft);
  }
  px(ctx, 0, top, SCENE_W, 1, "#6fbf7f");
}

function stableBlock(ctx: Ctx, x0: number, base: number, w: number) {
  const wall = "#efe0bb";
  const wallShade = "#cdb98f";
  const roofTop = base - 34;
  // roof
  for (let i = 0; i < 10; i++) px(ctx, x0 - 4 + i, roofTop + 10 - i, w + 8 - i * 2, 1, i % 3 === 0 ? "#3a4a52" : "#2c3a41");
  px(ctx, x0 - 4, roofTop + 10, w + 8, 2, "#1d282d");
  // walls
  px(ctx, x0, roofTop + 12, w, base - roofTop - 12, wall);
  px(ctx, x0, roofTop + 12, w, 2, wallShade);
  // stable doors (dutch doors) in green with brass hinges, each with a horse looking out
  for (let d = 6; d + 12 < w; d += 18) {
    const dx = x0 + d;
    px(ctx, dx - 1, base - 19, 14, 19, "#0f2a1d");
    px(ctx, dx, base - 18, 12, 7, "#120d09");
    px(ctx, dx, base - 10, 12, 10, "#1f4d35");
    px(ctx, dx, base - 10, 12, 1, "#3f8558");
    px(ctx, dx + 1, base - 7, 10, 1, "#163a28");
    px(ctx, dx + 1, base - 4, 10, 1, "#163a28");
    px(ctx, dx + 9, base - 9, 2, 1, "#d9a441");
    // horse head over the door
    if ((d / 18) % 2 === 0) {
      const coat = ["#7a3f1e", "#3b2416", "#a0602c", "#8b8f93"][(dx >> 3) % 4]!;
      px(ctx, dx + 4, base - 17, 4, 7, coat);
      px(ctx, dx + 3, base - 15, 1, 3, coat);
      px(ctx, dx + 4, base - 18, 1, 1, coat);
      px(ctx, dx + 7, base - 18, 1, 1, coat);
      px(ctx, dx + 5, base - 15, 1, 1, "#0b0f0c");
      px(ctx, dx + 4, base - 12, 3, 2, "#2a1a10");
    }
  }
  // cupola + clock
  const cx = x0 + Math.floor(w / 2) - 5;
  px(ctx, cx, roofTop - 6, 10, 8, wall);
  px(ctx, cx - 1, roofTop - 8, 12, 2, "#2c3a41");
  px(ctx, cx + 3, roofTop - 4, 4, 4, "#f6efdc");
  px(ctx, cx + 4, roofTop - 4, 1, 2, "#0b0f0c");
  px(ctx, cx + 4, roofTop - 3, 2, 1, "#0b0f0c");
  px(ctx, cx + 4, roofTop - 14, 1, 6, "#9a6b22");
  px(ctx, cx + 2, roofTop - 13, 5, 1, "#d9a441");
}

function grandstand(ctx: Ctx, base: number) {
  const rand = rng(31);
  const top = base - 46;
  const crowd = ["#f3e7c9", "#d9a441", "#7a1f1f", "#2346a8", "#c8242f", "#e47aa5", "#1f9d5c", "#e8742a", "#f4efe3", "#5b2f8f"];
  // structure
  px(ctx, 0, top + 8, SCENE_W, base - top - 8, "#d8cdb2");
  // tiers with crowd
  for (let row = 0; row < 7; row++) {
    const y = top + 14 + row * 4;
    px(ctx, 0, y + 3, SCENE_W, 1, "#a99d82");
    for (let x = 1; x < SCENE_W; x += 2) {
      if (rand() < 0.86) {
        px(ctx, x, y, 1, 1, "#e0b48a");
        px(ctx, x, y + 1, 1, 2, crowd[Math.floor(rand() * crowd.length)]!);
      }
    }
  }
  // far rail and turf in front of the stand
  px(ctx, 0, base, SCENE_W, SCENE_H - base, "#3f7f50");
  px(ctx, 0, base + 1, SCENE_W, 1, "#f6efdc");
  // pillars
  for (let x = 0; x < SCENE_W; x += 48) px(ctx, x, top + 8, 3, base - top - 8, "#f6efdc");
  // striped awning roof
  for (let x = 0; x < SCENE_W; x++) {
    const stripe = Math.floor(x / 6) % 2 === 0 ? "#1f4d35" : "#f3e7c9";
    px(ctx, x, top, 1, 7, stripe);
    px(ctx, x, top + 7, 1, 1, x % 6 < 3 ? stripe : "transparent");
    px(ctx, x, top - 2, 1, 2, "#0f2a1d");
  }
  // bunting
  const flags = ["#7a1f1f", "#d9a441", "#2346a8", "#f3e7c9"];
  for (let x = 0; x < SCENE_W; x += 8) {
    const sag = Math.round(Math.abs(Math.sin(((x % 48) / 48) * Math.PI)) * 3);
    const c = flags[(x / 8) % flags.length]!;
    px(ctx, x + 1, top + 9 + sag, 4, 1, c);
    px(ctx, x + 2, top + 10 + sag, 2, 1, c);
  }
  // flagpoles
  for (let x = 24; x < SCENE_W; x += 96) {
    px(ctx, x, top - 16, 1, 16, "#f6efdc");
    px(ctx, x + 1, top - 16, 7, 4, x % 192 === 24 ? "#7a1f1f" : "#d9a441");
  }
}

function cobbles(ctx: Ctx, top: number) {
  for (let y = top; y < SCENE_H; y++)
    for (let x = 0; x < SCENE_W; x++) {
      const row = Math.floor((y - top) / 3);
      const off = row % 2 ? 2 : 0;
      const edge = (y - top) % 3 === 2 || (x + off) % 5 === 0;
      px(ctx, x, y, 1, 1, edge ? "#6e6450" : (x * 7 + row * 3) % 11 < 2 ? "#b3a582" : "#9c8f70");
    }
  px(ctx, 0, top, SCENE_W, 1, "#c9bb94");
}

function track(ctx: Ctx, top: number) {
  for (let y = top; y < SCENE_H; y++)
    for (let x = 0; x < SCENE_W; x++) {
      const stripe = Math.floor((x - (y - top) * 3) / 40) % 2 === 0;
      px(ctx, x, y, 1, 1, stripe ? "#4d9a5f" : "#448a55");
    }
  // near rail
  for (let x = 0; x < SCENE_W; x++) {
    px(ctx, x, top + 10, 1, 2, "#ffffff");
    px(ctx, x, top + 12, 1, 1, "#9ea99f");
  }
  for (let x = 6; x < SCENE_W; x += 32) {
    px(ctx, x, top + 10, 2, 12, "#f6efdc");
    px(ctx, x + 1, top + 12, 1, 10, "#b8b09b");
  }
  // furlong pole
  for (let x = 120; x < SCENE_W; x += 384) {
    px(ctx, x, top - 10, 2, 22, "#f6efdc");
    px(ctx, x - 2, top - 12, 6, 3, "#7a1f1f");
  }
}

function barnInterior(ctx: Ctx, layer: LayerName) {
  if (layer === "sky") {
    for (let y = 0; y < SCENE_H; y++)
      for (let x = 0; x < SCENE_W; x++) {
        const plank = Math.floor(x / 12);
        const c = (x % 12 === 0) ? "#2a170c" : plank % 3 === 0 ? "#6b3f22" : plank % 3 === 1 ? "#5e371d" : "#734628";
        px(ctx, x, y, 1, 1, (y + plank * 7) % 37 === 0 ? "#3d2414" : c);
      }
    // light shafts
    for (let y = 0; y < SCENE_H; y++)
      for (let x = 0; x < SCENE_W; x++) if ((x - y * 0.6 + 400) % 96 < 18 && bayer(x, y) < 0.35) px(ctx, x, y, 1, 1, "#e9b56c");
  }
  if (layer === "mid") {
    for (let x = 0; x < SCENE_W; x += 64) {
      px(ctx, x, 30, 6, 66, "#3d2414");
      px(ctx, x + 1, 30, 1, 66, "#8a5a32");
    }
    px(ctx, 0, 28, SCENE_W, 4, "#3d2414");
  }
  if (layer === "near") {
    for (let y = 78; y < SCENE_H; y++)
      for (let x = 0; x < SCENE_W; x++) px(ctx, x, y, 1, 1, (x * 13 + y * 7) % 9 < 3 ? "#e8c46a" : (x + y) % 5 === 0 ? "#b98a3a" : "#d2a64e");
  }
}

export function drawLayer(ctx: Ctx, variant: SceneVariant, layer: LayerName): void {
  ctx.clearRect(0, 0, SCENE_W, SCENE_H);
  if (variant === "barn") return barnInterior(ctx, layer);
  const golden = ["#2d5a78", "#4f86a0", "#86b4b8", "#d9c48a", "#f2c27a", "#f6d79b"];
  if (layer === "sky") {
    sky(ctx, golden, { x: variant === "stable" ? 300 : 70, y: 60, r: 6, colors: ["#f9d58c", "#fde7b0", "#fff6da"] });
    return;
  }
  if (layer === "far") {
    hills(ctx, 62, 18, [1, 3, 5], "#5c8a72", "#7aa48a", 0.3);
    hills(ctx, 70, 12, [2, 4, 7], "#3e6e52", "#5b8c69", 2.1);
    if (variant !== "grandstand") treeLine(ctx, 70, 11, "#1c4430", "#255a3c", "#34734d", 18);
    return;
  }
  if (layer === "mid") {
    if (variant === "paddock") {
      treeLine(ctx, 66, 5, "#163a28", "#1f4d35", "#2c6645", 10);
      grass(ctx, 66, 2, "#4d9a5f", "#448a55", "#62ad6e");
      sprite(ctx, HORSE, 92, 56, { h: "#6b3a1c" });
      sprite(ctx, HORSE, 240, 58, { h: "#2b1a10" }, true);
      sprite(ctx, HORSE, 330, 57, { h: "#9a9ea2" });
      fence(ctx, 70);
    } else if (variant === "stable") {
      stableBlock(ctx, 20, 76, 150);
      stableBlock(ctx, 212, 76, 150);
    } else {
      grandstand(ctx, 70);
    }
    return;
  }
  // near
  if (variant === "paddock") {
    grass(ctx, 84, 9, "#2c6645", "#28603f", "#3f8558");
    const rand = rng(4);
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(rand() * SCENE_W);
      const y = 86 + Math.floor(rand() * 9);
      px(ctx, x, y, 1, 1, ["#f3e7c9", "#d9a441", "#e47aa5"][i % 3]!);
    }
  } else if (variant === "stable") {
    cobbles(ctx, 80);
    // hay bales and buckets
    for (let x = 96; x < SCENE_W; x += 192) {
      px(ctx, x, 72, 16, 9, "#d2a64e");
      px(ctx, x, 72, 16, 1, "#f0cf7a");
      px(ctx, x, 75, 16, 1, "#9a6b22");
      px(ctx, x + 22, 75, 6, 6, "#7a1f1f");
      px(ctx, x + 22, 75, 6, 1, "#b0392e");
    }
  } else {
    track(ctx, 74);
  }
}
