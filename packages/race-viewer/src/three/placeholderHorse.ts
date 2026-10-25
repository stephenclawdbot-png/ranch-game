/**
 * PLACEHOLDER pixel horse until @thoroughbred/pixel-rig lands.
 *
 * Paints a 12-frame keyed gallop strip with Canvas2D at native sprite resolution, then
 * snaps every pixel to an exact key palette (no anti-aliasing), adds a selective
 * 1px outline, and recolours it per horse through the same key-palette path as
 * PixelLab art. Implements the pixel-rig `HorseRig` contract.
 */
import type { HorseAppearance } from "@thoroughbred/shared";
import { bodyMotion, hoofTarget, legPhase, solveTwoBone, type LegId } from "../scene/horse/gait";
import { hexToRgb } from "./color";
import { appearanceKey, applyRecolor, buildRecolorPlan, type KeyPalette } from "./recolor";

export const PH_FRAMES = 12;
export const PH_W = 120;
export const PH_H = 100;
/** Pixels per centimetre of the painted horse (=> 2.5 cm per pixel). */
export const PH_SCALE = 0.4;
/** Nose tip on the ground, in frame pixels. */
export const PH_ANCHOR = { x: 112, y: 96 };

export const PLACEHOLDER_KEYS: Required<KeyPalette> = {
  coat: ["#3a1c10", "#5a2a16", "#8a4527", "#b5683d"],
  mane: ["#120c0a", "#2a1c16", "#3e2a20"],
  points: ["#140e0b", "#241a15"],
  hoof: ["#2b2522"],
  silksPrimary: ["#70105a", "#b8148c", "#ff52d6"],
  silksSecondary: ["#0d4f6a", "#1497c0", "#5fe3ff"],
  cap: ["#6b2b00", "#d06a00", "#ffb050"],
};
const BREECHES = ["#c9c6bb", "#f2f0e8"];
const BOOT = ["#141110", "#2e2724"];
const SKIN = ["#b07a58", "#e0ad86"];
const BIT = "#b8bcc0";
const OUTLINE_FIXED = "#17110e";

type Pt = [number, number];

interface Leg {
  id: LegId;
  kind: "fore" | "hind";
  pivot: Pt;
  upper: number;
  lower: number;
  pastern: number;
  near: boolean;
  stance: number;
  flexRel: number;
}
const DEG = Math.PI / 180;
const LEGS: Leg[] = [
  { id: "HL", kind: "hind", pivot: [-206, -124], upper: 60, lower: 52, pastern: 17, near: false, stance: 64 * DEG, flexRel: 55 * DEG },
  { id: "FL", kind: "fore", pivot: [-90, -120], upper: 62, lower: 46, pastern: 17, near: false, stance: 60 * DEG, flexRel: 75 * DEG },
  { id: "HR", kind: "hind", pivot: [-212, -124], upper: 60, lower: 52, pastern: 17, near: true, stance: 64 * DEG, flexRel: 55 * DEG },
  { id: "FR", kind: "fore", pivot: [-96, -120], upper: 62, lower: 46, pastern: 17, near: true, stance: 60 * DEG, flexRel: 75 * DEG },
];
const T0: Pt = [-150, -122];
const NECK_PIVOT: Pt = [-104, -146];

const BODY: Pt[] = [
  [-110, -162], [-128, -156], [-150, -151], [-176, -153], [-200, -160], [-224, -157], [-240, -146], [-250, -128], [-247, -110],
  [-232, -96], [-206, -97], [-180, -96], [-152, -92], [-124, -93], [-104, -98], [-88, -108], [-80, -124], [-80, -138], [-90, -152],
];
const BELLY: Pt[] = [[-238, -116], [-214, -106], [-180, -102], [-150, -98], [-118, -100], [-92, -110], [-88, -104], [-104, -97], [-124, -92], [-152, -91], [-180, -95], [-206, -97], [-232, -98]];
const TOPLINE: Pt[] = [[-112, -160], [-150, -150], [-176, -152], [-202, -159], [-226, -155], [-236, -147], [-222, -151], [-200, -155], [-176, -148], [-150, -146], [-122, -154]];
const QUARTER: Pt[] = [[-206, -150], [-228, -146], [-240, -130], [-234, -114], [-216, -110], [-204, -124]];
const NECK: Pt[] = [[-128, -157], [-106, -170], [-86, -179], [-66, -184], [-47, -187], [-37, -172], [-38, -156], [-48, -146], [-61, -133], [-74, -117], [-88, -103], [-108, -112]];
const NECK_SHADE: Pt[] = [[-40, -156], [-52, -147], [-66, -135], [-80, -118], [-90, -106], [-80, -124], [-64, -142], [-48, -154]];
const HEAD: Pt[] = [[-50, -182], [-38, -184], [-28, -177], [-18, -164], [-9, -149], [-2, -138], [0, -131], [-2, -125], [-8, -122], [-15, -122], [-24, -128], [-34, -138], [-44, -150], [-50, -164]];
const EAR: Pt[] = [[-40, -181], [-44, -192], [-52, -199], [-50, -188], [-47, -181]];
const THIGH: Pt[] = [[-168, -190], [-148, -194], [-116, -184], [-108, -175], [-116, -168], [-150, -176], [-166, -178]];
const BOOT_PTS: Pt[] = [[-118, -180], [-108, -175], [-118, -150], [-121, -139], [-130, -140], [-126, -152]];
const TORSO: Pt[] = [[-172, -190], [-160, -199], [-138, -205], [-116, -210], [-104, -203], [-106, -192], [-122, -184], [-150, -180], [-168, -181]];
const TORSO_SHADE: Pt[] = [[-168, -184], [-150, -181], [-122, -185], [-108, -192], [-112, -186], [-130, -181], [-150, -178], [-166, -179]];
const CAP: Pt[] = [[-104, -214], [-96, -224], [-86, -221], [-84, -213], [-92, -211], [-102, -209]];
const ARM: Pt[] = [[-120, -205], [-108, -205], [-96, -188], [-84, -172], [-88, -167], [-102, -182], [-118, -194]];
// Saddle-relative jockey offset (rider sits slightly down into the saddle).
const RIDER_D: Pt = [6, 13];

function poly(ctx: CanvasRenderingContext2D, pts: Pt[], color: string, d: Pt = [0, 0]): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + d[0], y + d[1]) : ctx.moveTo(x + d[0], y + d[1])));
  ctx.closePath();
  ctx.fill();
}

function seg(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, w: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
}

/** Paint one keyed frame (horse-local cm, transformed into the frame). */
function paintFrame(ctx: CanvasRenderingContext2D, ox: number, phase: number): void {
  const K = PLACEHOLDER_KEYS;
  const m = bodyMotion(phase, 1);
  const rise = m.rise;
  const pitch = m.pitch;
  ctx.save();
  ctx.translate(ox + PH_ANCHOR.x, PH_ANCHOR.y);
  ctx.scale(PH_SCALE, PH_SCALE);
  const cos = Math.cos(pitch);
  const sin = Math.sin(pitch);
  const tx = (p: Pt): Pt => {
    const lx = p[0] - T0[0];
    const ly = p[1] - T0[1];
    return [T0[0] + lx * cos - ly * sin, T0[1] - rise + lx * sin + ly * cos];
  };
  const body = (pts: Pt[]) => pts.map(tx);

  // Legs (IK, same maths as the HD rig: planted hooves never slide).
  const sweep = 7.2 * 100 * 0.18;
  const legGeo = LEGS.map((s) => {
    const tgt = hoofTarget(s.kind, legPhase(phase, s.id), sweep, 1);
    const [px, py] = tx([s.pivot[0] + tgt.pivotDx, s.pivot[1]]);
    const hx = s.pivot[0] + tgt.x;
    const hy = -tgt.lift;
    const fx = hx - Math.cos(s.stance) * s.pastern;
    const fy = hy - Math.sin(s.stance) * s.pastern;
    const ik = solveTwoBone(px, py, fx, fy, s.upper, s.lower, s.kind === "fore" ? -1 : 1);
    const pa = s.stance + (ik.lower + s.flexRel - s.stance) * tgt.flex;
    const hoof: Pt = [ik.endX + Math.cos(pa) * s.pastern, ik.endY + Math.sin(pa) * s.pastern];
    return { s, pivot: [px, py] as Pt, knee: [ik.kneeX, ik.kneeY] as Pt, fet: [ik.endX, ik.endY] as Pt, hoof, pa };
  });
  const drawLeg = (g: (typeof legGeo)[number]) => {
    const far = !g.s.near;
    const coat = far ? K.coat[1]! : K.coat[2]!;
    const pts = far ? K.points[0]! : K.points[1]!;
    const thick = g.s.kind === "hind" ? 17 : 14;
    seg(ctx, g.pivot, g.knee, thick, coat);
    seg(ctx, g.knee, g.fet, 7, pts);
    seg(ctx, g.fet, g.hoof, 6, pts);
    // Hoof: small block along the pastern direction.
    const hx = g.hoof[0] + Math.cos(g.pa) * 3;
    const hy = g.hoof[1] + Math.sin(g.pa) * 3;
    seg(ctx, g.hoof, [hx, hy], 9, K.hoof[0]!);
  };
  for (const g of legGeo) if (!g.s.near) drawLeg(g);

  // Tail streams back, waving with the stride.
  const tau = Math.PI * 2;
  const root = tx([-238, -150]);
  const w1 = Math.sin(tau * (phase - 0.15)) * 6;
  const w2 = Math.sin(tau * (phase - 0.3)) * 9;
  ctx.strokeStyle = K.mane[1]!;
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(root[0], root[1]);
  ctx.quadraticCurveTo(root[0] - 22, root[1] + 4 + w1, root[0] - 44, root[1] + 22 + w2);
  ctx.stroke();
  ctx.strokeStyle = K.mane[2]!;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(root[0] - 4, root[1] - 2);
  ctx.quadraticCurveTo(root[0] - 22, root[1] + w1, root[0] - 40, root[1] + 16 + w2);
  ctx.stroke();

  poly(ctx, body(BODY), K.coat[2]!);
  poly(ctx, body(BELLY), K.coat[1]!);
  poly(ctx, body(QUARTER), K.coat[3]!);
  poly(ctx, body(TOPLINE), K.coat[3]!);

  // Neck + head nod around the neck pivot.
  const np = tx(NECK_PIVOT);
  ctx.save();
  ctx.translate(np[0], np[1]);
  ctx.rotate(pitch + m.neck);
  ctx.translate(-NECK_PIVOT[0], -NECK_PIVOT[1]);
  // Mane strip along the crest.
  ctx.strokeStyle = K.mane[1]!;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(-124, -162);
  ctx.quadraticCurveTo(-86, -186, -50, -191);
  ctx.stroke();
  poly(ctx, NECK, K.coat[2]!);
  poly(ctx, NECK_SHADE, K.coat[1]!);
  poly(ctx, HEAD, K.coat[2]!);
  poly(ctx, [[-24, -130], [-12, -124], [-3, -127], [-6, -134], [-16, -138]], K.coat[1]!);
  poly(ctx, EAR, K.coat[2]!);
  ctx.fillStyle = K.mane[0]!;
  ctx.fillRect(-34, -170, 6, 5); // eye
  seg(ctx, [-38, -158], [-11, -128], 2.5, K.mane[0]!); // cheek strap
  ctx.restore();

  for (const g of legGeo) if (g.s.near) drawLeg(g);

  // Jockey: absorbs part of the bounce.
  const r = tx([-150, -160]);
  const settle = rise * 0.55;
  const d: Pt = [r[0] - -150 + RIDER_D[0], r[1] - -160 + RIDER_D[1] + settle];
  poly(ctx, THIGH, BREECHES[1]!, d);
  poly(ctx, BOOT_PTS, BOOT[0]!, d);
  poly(ctx, TORSO, K.silksPrimary[1]!, d);
  poly(ctx, TORSO_SHADE, K.silksPrimary[0]!, d);
  seg(ctx, [-164 + d[0], -194 + d[1]], [-118 + d[0], -207 + d[1]], 3, K.silksPrimary[2]!);
  ctx.fillStyle = SKIN[1]!;
  ctx.beginPath();
  ctx.ellipse(-96 + d[0], -210 + d[1], 7, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  poly(ctx, CAP, K.cap[1]!, d);
  seg(ctx, [-98 + d[0], -219 + d[1]], [-90 + d[0], -221 + d[1]], 2.5, K.cap[2]!);
  poly(ctx, ARM, K.silksSecondary[1]!, d);
  seg(ctx, [-116 + d[0], -198 + d[1]], [-90 + d[0], -172 + d[1]], 2.5, K.silksSecondary[0]!);
  ctx.fillStyle = BREECHES[1]!;
  ctx.fillRect(-84 + d[0], -172 + d[1], 7, 7); // glove
  // Reins to the bit.
  const bit = tx([-12, -128]);
  seg(ctx, [-80 + d[0], -168 + d[1]], bit, 2.2, K.mane[0]!);
  ctx.fillStyle = BIT;
  ctx.fillRect(bit[0] - 2, bit[1] - 2, 5, 5);
  ctx.restore();
}

function allowedColors(): { hex: string; rgb: [number, number, number]; role: string; idx: number }[] {
  const out: { hex: string; rgb: [number, number, number]; role: string; idx: number }[] = [];
  const add = (role: string, ramp: readonly string[]) => ramp.forEach((hex, idx) => out.push({ hex, rgb: hexToRgb(hex), role, idx }));
  for (const [role, ramp] of Object.entries(PLACEHOLDER_KEYS)) add(role, ramp);
  add("breeches", BREECHES);
  add("boot", BOOT);
  add("skin", SKIN);
  add("bit", [BIT]);
  return out;
}

/** Snap to the key palette (alpha threshold, nearest colour), then a selective outline. */
export function pixelate(data: Uint8ClampedArray, w: number, h: number): void {
  const pal = allowedColors();
  const roleAt = new Int16Array(w * h).fill(-1);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (data[i + 3]! < 110) {
      data[i + 3] = 0;
      continue;
    }
    // Un-premultiplied edge pixels can be dark; compare on the stored colour.
    let best = 0;
    let bd = Infinity;
    for (let k = 0; k < pal.length; k++) {
      const c = pal[k]!.rgb;
      const dr = data[i]! - c[0];
      const dg = data[i + 1]! - c[1];
      const db = data[i + 2]! - c[2];
      const dd = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
      if (dd < bd) {
        bd = dd;
        best = k;
      }
    }
    const c = pal[best]!.rgb;
    data[i] = c[0];
    data[i + 1] = c[1];
    data[i + 2] = c[2];
    data[i + 3] = 255;
    roleAt[p] = best;
  }
  // Selective outline: transparent pixels touching the sprite take the darkest
  // shade of the neighbour's ramp (so the outline recolours with the coat/silks).
  const out = new Uint8ClampedArray(data);
  const darkest = (k: number): [number, number, number] => {
    const role = pal[k]!.role;
    if (role === "breeches" || role === "boot" || role === "skin" || role === "bit") return hexToRgb(OUTLINE_FIXED);
    return hexToRgb((PLACEHOLDER_KEYS as Record<string, string[]>)[role]![0]!);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (roleAt[p]! >= 0) continue;
      // Frame borders: don't outline across frames.
      const fx = x % PH_W;
      let k = -1;
      if (fx > 0 && roleAt[p - 1]! >= 0) k = roleAt[p - 1]!;
      else if (fx < PH_W - 1 && roleAt[p + 1]! >= 0) k = roleAt[p + 1]!;
      else if (y > 0 && roleAt[p - w]! >= 0) k = roleAt[p - w]!;
      else if (y < h - 1 && roleAt[p + w]! >= 0) k = roleAt[p + w]!;
      if (k < 0) continue;
      const c = darkest(k);
      const i = p * 4;
      out[i] = c[0];
      out[i + 1] = c[1];
      out[i + 2] = c[2];
      out[i + 3] = 255;
    }
  }
  data.set(out);
}

let keyedStrip: ImageData | null = null;

/** The keyed (un-recoloured) placeholder strip, painted once per page. */
export function placeholderStrip(): ImageData {
  if (keyedStrip) return keyedStrip;
  const c = document.createElement("canvas");
  c.width = PH_W * PH_FRAMES;
  c.height = PH_H;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  for (let f = 0; f < PH_FRAMES; f++) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(f * PH_W, 0, PH_W, PH_H);
    ctx.clip();
    paintFrame(ctx, f * PH_W, f / PH_FRAMES);
    ctx.restore();
  }
  const img = ctx.getImageData(0, 0, c.width, c.height);
  pixelate(img.data, img.width, img.height);
  keyedStrip = img;
  return img;
}

const recoloured = new Map<string, HTMLCanvasElement>();

/** Recoloured strip for one appearance (cached by appearance). */
export function placeholderStripFor(appearance: HorseAppearance): HTMLCanvasElement {
  const key = appearanceKey(appearance);
  const hit = recoloured.get(key);
  if (hit) return hit;
  const src = placeholderStrip();
  const data = new Uint8ClampedArray(src.data);
  applyRecolor(data, src.width, src.height, PH_W, buildRecolorPlan(PLACEHOLDER_KEYS, appearance));
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  c.getContext("2d")!.putImageData(new ImageData(data, src.width, src.height), 0, 0);
  recoloured.set(key, c);
  return c;
}

