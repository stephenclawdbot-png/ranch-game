/**
 * Procedural textures painted with Canvas 2D once at startup. Each one stands in
 * for a manifest slot (track.sky, track.grandstand, ...) until approved art exists.
 */
import { CanvasSource, Texture } from "pixi.js";
import type { Silks, Surface, Weather } from "@thoroughbred/shared";
import { rng } from "./draw";

export interface WeatherLook {
  skyStops: [number, string][];
  sun: { x: number; y: number; r: number; color: string; glow: string } | null;
  cloud: string;
  cloudAlpha: number;
  farHills: string;
  nearHills: string;
  treeline: string;
  skyline: string;
  apron: string;
  turfA: string;
  turfB: string;
  dirt: string;
  hedge: string;
  /** Multiplicative scene tint (0xRRGGBB). */
  tint: number;
  /** Haze colour for distant layers. */
  haze: string;
  shadowAlpha: number;
}

export const WEATHER_LOOKS: Record<Weather, WeatherLook> = {
  clear: {
    skyStops: [
      [0, "#2f6fc4"],
      [0.55, "#79aee3"],
      [1, "#d4ecf7"],
    ],
    sun: { x: 0.8, y: 0.16, r: 26, color: "rgba(255,252,235,1)", glow: "rgba(255,244,210,0.55)" },
    cloud: "#ffffff",
    cloudAlpha: 0.85,
    farHills: "#93b4c9",
    nearHills: "#6f9a80",
    treeline: "#3f6a3a",
    skyline: "#7f97a6",
    apron: "#4f8a3a",
    turfA: "#5a9a3a",
    turfB: "#4f8c33",
    dirt: "#9a6a43",
    hedge: "#2f5a26",
    tint: 0xffffff,
    haze: "#cfe3ef",
    shadowAlpha: 0.42,
  },
  overcast: {
    skyStops: [
      [0, "#7c8792"],
      [0.6, "#a9b2ba"],
      [1, "#d3d8dc"],
    ],
    sun: null,
    cloud: "#e9ecef",
    cloudAlpha: 0.75,
    farHills: "#9aa6ae",
    nearHills: "#76877c",
    treeline: "#4a5f45",
    skyline: "#8b969e",
    apron: "#55784a",
    turfA: "#5a8a44",
    turfB: "#4f7d3c",
    dirt: "#8d6a4c",
    hedge: "#34522c",
    tint: 0xe7eaee,
    haze: "#d0d6db",
    shadowAlpha: 0.26,
  },
  rain: {
    skyStops: [
      [0, "#3e4852"],
      [0.6, "#68737d"],
      [1, "#9aa3aa"],
    ],
    sun: null,
    cloud: "#5d6670",
    cloudAlpha: 0.9,
    farHills: "#76838c",
    nearHills: "#5c6c63",
    treeline: "#3a4a38",
    skyline: "#6d7880",
    apron: "#466341",
    turfA: "#4c7a3c",
    turfB: "#436e35",
    dirt: "#6e4f38",
    hedge: "#2b4426",
    tint: 0xc9d0d6,
    haze: "#a4adb4",
    shadowAlpha: 0.2,
  },
  dusk: {
    skyStops: [
      [0, "#232456"],
      [0.42, "#7c3f78"],
      [0.75, "#e0705a"],
      [1, "#f7b35e"],
    ],
    sun: { x: 0.18, y: 0.42, r: 34, color: "rgba(255,214,140,1)", glow: "rgba(255,150,80,0.6)" },
    cloud: "#f2a07a",
    cloudAlpha: 0.6,
    farHills: "#6a4a74",
    nearHills: "#4f3c5a",
    treeline: "#2e2a36",
    skyline: "#4a3a56",
    apron: "#3f5a33",
    turfA: "#4e7a35",
    turfB: "#45702f",
    dirt: "#86583a",
    hedge: "#233a1f",
    tint: 0xffe2c8,
    haze: "#d58a7a",
    shadowAlpha: 0.32,
  },
};

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement, repeat = false): Texture {
  return new Texture({
    source: new CanvasSource({ resource: c, addressMode: repeat ? "repeat" : "clamp-to-edge", scaleMode: "linear" }),
  });
}

/** Periodic 1-D noise over [0, 1) (seamless for tiling). */
function periodic(seed: number, octaves: [number, number][]): (u: number) => number {
  const r = rng(seed);
  const phases = octaves.map(() => r() * Math.PI * 2);
  return (u) => octaves.reduce((acc, [freq, amp], i) => acc + Math.sin(u * Math.PI * 2 * freq + phases[i]!) * amp, 0);
}

export function skyTexture(look: WeatherLook): Texture {
  const [c, ctx] = canvas(512, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  for (const [o, col] of look.skyStops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  if (look.sun) {
    const sx = look.sun.x * 512;
    const sy = look.sun.y * 512;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 220);
    glow.addColorStop(0, look.sun.glow);
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = look.sun.color;
    ctx.beginPath();
    ctx.arc(sx, sy, look.sun.r * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c);
}

export function cloudTexture(look: WeatherLook, seed: number): Texture {
  const W = 1024;
  const H = 256;
  const [c, ctx] = canvas(W, H);
  const r = rng(seed);
  const n = look.cloudAlpha > 0.8 ? 26 : 14;
  for (let i = 0; i < n; i++) {
    const cx = r() * W;
    const cy = 50 + r() * 140;
    const w = 90 + r() * 200;
    for (let k = 0; k < 9; k++) {
      const x = cx + (r() - 0.5) * w;
      const y = cy + (r() - 0.5) * 26;
      const rad = 18 + r() * 34;
      for (const dx of [-W, 0, W]) {
        const g = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, rad);
        g.addColorStop(0, hexA(look.cloud, 0.55 * look.cloudAlpha));
        g.addColorStop(1, hexA(look.cloud, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - rad, y - rad, rad * 2, rad * 2);
      }
    }
  }
  return toTexture(c, true);
}

function hexA(h: string, a: number): string {
  const n = Number.parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Two ridges (distant blue hills, nearer treeline), solid below. Seamless. */
export function hillsTexture(look: WeatherLook, seed: number): Texture {
  const W = 1024;
  const H = 256;
  const [c, ctx] = canvas(W, H);
  const far = periodic(seed, [
    [1, 18],
    [3, 10],
    [7, 4],
  ]);
  const near = periodic(seed + 1, [
    [2, 10],
    [5, 6],
    [13, 3],
    [31, 2],
  ]);
  ctx.fillStyle = look.farHills;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 4) ctx.lineTo(x, 90 + far(x / W));
  ctx.lineTo(W, H);
  ctx.fill();
  // Haze toward the base of the far hills.
  const hz = ctx.createLinearGradient(0, 80, 0, H);
  hz.addColorStop(0, hexA(look.haze, 0));
  hz.addColorStop(1, hexA(look.haze, 0.55));
  ctx.fillStyle = hz;
  ctx.fillRect(0, 60, W, H);
  ctx.fillStyle = look.nearHills;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 3) ctx.lineTo(x, 150 + near(x / W));
  ctx.lineTo(W, H);
  ctx.fill();
  // Treeline: bumpy canopy.
  const r = rng(seed + 2);
  ctx.fillStyle = look.treeline;
  ctx.fillRect(0, 196, W, H - 196);
  for (let x = -20; x < W + 20; x += 7 + r() * 9) {
    const rad = 8 + r() * 12;
    const y = 196 - r() * 10;
    for (const dx of [-W, 0, W]) {
      ctx.beginPath();
      ctx.arc(x + dx, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return toTexture(c, true);
}

/** Distant town / stand silhouettes with light poles. Seamless. */
export function skylineTexture(look: WeatherLook, seed: number): Texture {
  const W = 1024;
  const H = 200;
  const [c, ctx] = canvas(W, H);
  const r = rng(seed);
  ctx.fillStyle = look.skyline;
  let x = 0;
  while (x < W) {
    const w = 20 + r() * 60;
    const h = 20 + r() * 70 * (r() < 0.2 ? 1.8 : 1);
    if (r() < 0.72) {
      ctx.fillRect(x, H - h, Math.min(w, W - x), h);
      if (r() < 0.3) ctx.fillRect(x + w * 0.4, H - h - 18, 3, 18);
    }
    x += w + r() * 18;
  }
  // Light towers.
  for (let i = 0; i < 4; i++) {
    const lx = (i + 0.3 + r() * 0.4) * (W / 4);
    ctx.fillRect(lx, H - 150, 3, 150);
    ctx.fillRect(lx - 12, H - 156, 27, 10);
  }
  const hz = ctx.createLinearGradient(0, 0, 0, H);
  hz.addColorStop(0, hexA(look.haze, 0.1));
  hz.addColorStop(1, hexA(look.haze, 0.45));
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = hz;
  ctx.fillRect(0, 0, W, H);
  return toTexture(c, true);
}

/** Repeating grandstand module: roof, tiers of crowd, boxes, ad boards. */
export function grandstandTexture(look: WeatherLook, seed: number): Texture {
  const W = 512;
  const H = 300;
  const [c, ctx] = canvas(W, H);
  const r = rng(seed);
  const dusk = look.sun && look.sun.y > 0.3;
  // Back wall.
  ctx.fillStyle = "#c9c3b8";
  ctx.fillRect(0, 60, W, H - 60);
  // Roof canopy.
  const roof = ctx.createLinearGradient(0, 18, 0, 70);
  roof.addColorStop(0, "#eef0f2");
  roof.addColorStop(1, "#9aa3ab");
  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.moveTo(0, 26);
  ctx.lineTo(W, 26);
  ctx.lineTo(W, 62);
  ctx.lineTo(0, 62);
  ctx.fill();
  ctx.fillStyle = "#5c656e";
  ctx.fillRect(0, 62, W, 6);
  // Shadowed seating area under the roof.
  const shade = ctx.createLinearGradient(0, 68, 0, 220);
  shade.addColorStop(0, "#2e3236");
  shade.addColorStop(1, "#5c5f62");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 68, W, 152);
  // Crowd specks on tiers.
  const shirts = ["#e8e2d6", "#c0392b", "#2c3e50", "#f1c40f", "#16a085", "#8e44ad", "#d35400", "#ecf0f1", "#34495e", "#7f8c8d", "#2980b9", "#f5b7b1"];
  for (let row = 0; row < 13; row++) {
    const y = 78 + row * 11;
    ctx.fillStyle = `rgba(0,0,0,${0.18 + row * 0.01})`;
    ctx.fillRect(0, y + 8, W, 2);
    for (let px = 2; px < W - 2; px += 4 + r() * 2.5) {
      if (r() < 0.12) continue;
      ctx.fillStyle = shirts[Math.floor(r() * shirts.length)]!;
      ctx.fillRect(px, y + 2, 3.2, 6);
      ctx.fillStyle = r() < 0.5 ? "#e0b48c" : r() < 0.5 ? "#8d5a3b" : "#3b2a20";
      ctx.fillRect(px + 0.4, y - 1.2, 2.4, 2.6);
    }
  }
  // Columns.
  ctx.fillStyle = "#e8e8e6";
  for (let px = 32; px < W; px += 128) ctx.fillRect(px, 62, 6, 160);
  // Hospitality boxes with glass.
  ctx.fillStyle = "#d9d4ca";
  ctx.fillRect(0, 220, W, 34);
  for (let px = 8; px < W; px += 64) {
    const glass = ctx.createLinearGradient(0, 224, 0, 250);
    glass.addColorStop(0, dusk ? "#ffcf8a" : "#9cc3dc");
    glass.addColorStop(1, dusk ? "#c9844a" : "#4e6f86");
    ctx.fillStyle = glass;
    ctx.fillRect(px, 225, 52, 24);
  }
  // Ad boards / rail line at the base.
  const ads = ["#0b5394", "#c8102e", "#1d1d1b", "#0f6b3a", "#f2c230"];
  for (let px = 0, i = 0; px < W; px += 128, i++) {
    ctx.fillStyle = ads[i % ads.length]!;
    ctx.fillRect(px, 258, 126, 26);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (let k = 0; k < 5; k++) ctx.fillRect(px + 16 + k * 20, 266, 12, 10);
  }
  ctx.fillStyle = "#b9b4aa";
  ctx.fillRect(0, 284, W, H - 284);
  // Atmospheric haze.
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = hexA(look.haze, 0.18);
  ctx.fillRect(0, 0, W, H);
  return toTexture(c, true);
}

export function treeTexture(look: WeatherLook, seed: number): Texture {
  const W = 160;
  const H = 200;
  const [c, ctx] = canvas(W, H);
  const r = rng(seed);
  ctx.fillStyle = "#3b2c22";
  ctx.fillRect(W / 2 - 5, H - 60, 10, 60);
  const base = look.treeline;
  for (let i = 0; i < 26; i++) {
    const x = W / 2 + (r() - 0.5) * 100;
    const y = 30 + r() * 110;
    const rad = 16 + r() * 22;
    ctx.fillStyle = i % 3 === 0 ? shadeHex(base, 1.25) : i % 3 === 1 ? base : shadeHex(base, 0.8);
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c);
}

function shadeHex(h: string, k: number): string {
  const n = Number.parseInt(h.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/**
 * Track surface. u = along the track (one tile = TRACK_TILE_M metres), v = across
 * the track from the inner rail (0) to the outer rail (1).
 */
export const TRACK_TILE_M = 16;

export function trackTexture(look: WeatherLook, surface: Surface, seed: number): Texture {
  const W = 1024;
  const H = 256;
  const [c, ctx] = canvas(W, H);
  const r = rng(seed);
  const turf = surface === "turf";
  if (turf) {
    // Mowing stripes (two per tile), slightly feathered.
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const s = 0.5 + 0.5 * Math.sin(u * Math.PI * 4);
      const k = s > 0.5 ? 1 : 0;
      ctx.fillStyle = k ? look.turfA : look.turfB;
      ctx.fillRect(x, 0, 1, H);
    }
    // Worn racing line near the rail.
    const wear = ctx.createLinearGradient(0, 0, 0, H);
    wear.addColorStop(0, "rgba(120,100,60,0.0)");
    wear.addColorStop(0.08, "rgba(120,100,60,0.18)");
    wear.addColorStop(0.32, "rgba(120,100,60,0.08)");
    wear.addColorStop(0.6, "rgba(120,100,60,0.0)");
    ctx.fillStyle = wear;
    ctx.fillRect(0, 0, W, H);
    // Grass grain.
    for (let i = 0; i < 9000; i++) {
      const x = r() * W;
      const y = r() * H;
      ctx.fillStyle = r() < 0.5 ? "rgba(255,255,220,0.07)" : "rgba(0,30,0,0.09)";
      ctx.fillRect(x, y, 2 + r() * 3, 1);
    }
    // Divots / hoof scuffs.
    for (let i = 0; i < 140; i++) {
      const x = r() * W;
      const y = H * (0.05 + r() * 0.7);
      ctx.fillStyle = `rgba(90,60,30,${0.12 + r() * 0.16})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 3 + r() * 4, 1.2 + r(), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = surface === "synthetic" ? "#6d5a4a" : look.dirt;
    ctx.fillRect(0, 0, W, H);
    // Harrow lines run along the track.
    for (let y = 0; y < H; y += 3) {
      ctx.fillStyle = `rgba(${r() < 0.5 ? "255,230,200" : "40,20,10"},${0.04 + r() * 0.06})`;
      ctx.fillRect(0, y, W, 1);
    }
    for (let i = 0; i < 12000; i++) {
      const x = r() * W;
      const y = r() * H;
      ctx.fillStyle = r() < 0.5 ? "rgba(255,235,210,0.08)" : "rgba(30,15,5,0.12)";
      ctx.fillRect(x, y, 1 + r() * 2, 1 + r());
    }
    // Hoof prints, mostly along the inside lanes.
    for (let i = 0; i < 260; i++) {
      const x = r() * W;
      const y = H * Math.pow(r(), 1.6) * 0.85;
      ctx.fillStyle = `rgba(45,25,12,${0.18 + r() * 0.2})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 2.5 + r() * 2, 1 + r() * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Darken toward the far rail for depth.
  const depth = ctx.createLinearGradient(0, 0, 0, H);
  depth.addColorStop(0, "rgba(0,0,0,0.16)");
  depth.addColorStop(0.5, "rgba(0,0,0,0.0)");
  depth.addColorStop(1, "rgba(0,0,0,0.05)");
  ctx.fillStyle = depth;
  ctx.fillRect(0, 0, W, H);
  return toTexture(c, true);
}

/** Foreground hedge with a bushy top edge. Seamless. */
export function hedgeTexture(look: WeatherLook, seed: number): Texture {
  const W = 512;
  const H = 160;
  const [c, ctx] = canvas(W, H);
  const r = rng(seed);
  ctx.fillStyle = look.hedge;
  ctx.fillRect(0, 40, W, H - 40);
  for (let i = 0; i < 420; i++) {
    const x = r() * W;
    const y = 26 + r() * (H - 20);
    const rad = 5 + r() * 12;
    ctx.fillStyle = shadeHex(look.hedge, 0.7 + r() * 0.75);
    for (const dx of [-W, 0, W]) {
      ctx.beginPath();
      ctx.arc(x + dx, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const sh = ctx.createLinearGradient(0, 0, 0, H);
  sh.addColorStop(0, "rgba(0,0,0,0)");
  sh.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = sh;
  ctx.fillRect(0, 0, W, H);
  return toTexture(c, true);
}

export function softDotTexture(): Texture {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.5, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(c);
}

export function clodTexture(): Texture {
  const [c, ctx] = canvas(16, 16);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(3, 8);
  ctx.lineTo(7, 2);
  ctx.lineTo(13, 5);
  ctx.lineTo(12, 12);
  ctx.lineTo(5, 14);
  ctx.closePath();
  ctx.fill();
  return toTexture(c);
}

export function streakTexture(): Texture {
  const [c, ctx] = canvas(4, 64);
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(1, "rgba(255,255,255,0.9)");
  ctx.fillStyle = g;
  ctx.fillRect(1, 0, 2, 64);
  return toTexture(c);
}

export function vignetteTexture(): Texture {
  const [c, ctx] = canvas(256, 256);
  const g = ctx.createRadialGradient(128, 128, 60, 128, 128, 182);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return toTexture(c);
}

/**
 * Jockey silks: the jockey is crouched horizontally, so hoops (rings around the
 * body) run across the torso and stripes run along it.
 */
export function silksTexture(silks: Silks): Texture {
  const W = 96;
  const H = 48;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = silks.primary;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = silks.secondary;
  switch (silks.pattern) {
    case "hoops":
      for (let x = 10; x < W; x += 22) ctx.fillRect(x, 0, 10, H);
      break;
    case "stripes":
      for (let y = 4; y < H; y += 12) ctx.fillRect(0, y, W, 5);
      break;
    case "chevron":
      ctx.lineWidth = 7;
      ctx.strokeStyle = silks.secondary;
      for (let x = 14; x < W + 20; x += 30) {
        ctx.beginPath();
        ctx.moveTo(x - 14, 0);
        ctx.lineTo(x, H / 2);
        ctx.lineTo(x - 14, H);
        ctx.stroke();
      }
      break;
    case "diamonds":
      for (let x = 12; x < W; x += 24) {
        for (let y = 12; y < H + 12; y += 24) {
          ctx.beginPath();
          ctx.moveTo(x, y - 9);
          ctx.lineTo(x + 8, y);
          ctx.lineTo(x, y + 9);
          ctx.lineTo(x - 8, y);
          ctx.fill();
        }
      }
      break;
    case "sash":
      ctx.beginPath();
      ctx.moveTo(W * 0.3, 0);
      ctx.lineTo(W * 0.55, 0);
      ctx.lineTo(W * 0.75, H);
      ctx.lineTo(W * 0.5, H);
      ctx.fill();
      break;
    case "quartered":
      ctx.fillRect(0, 0, W / 2, H / 2);
      ctx.fillRect(W / 2, H / 2, W / 2, H / 2);
      break;
    case "stars":
      for (const [sx, sy] of [
        [18, 14],
        [50, 30],
        [80, 12],
        [30, 38],
        [70, 40],
      ] as const) {
        star(ctx, sx, sy, 7, 3);
      }
      break;
    default:
      break;
  }
  return toTexture(c);
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r : R;
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
}
