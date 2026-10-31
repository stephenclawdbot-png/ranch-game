/**
 * A jockey's bust from layers (graphics round 2), pure: the keyed base face
 * (art/portraits/jockeys/<face>.png, art-src/process_jockeys.py) painted with the jockey's look
 * (game-core JockeyLook: skin, hair, accessories) and their stable's silks, pattern included
 * (the jacket on the same 16x13 jersey grid as the silks icon; the cap with the shared cap rule,
 * art-pipeline riderLook), so the bust and the rider on the horse agree.
 */
import { capPatternAt, jerseyPatternAt, rampRgb } from "@thoroughbred/art-pipeline";
import * as gc from "@thoroughbred/game-core";
import type { Silks } from "@thoroughbred/shared";
import PALETTE from "../../public/art/race/palette.json";
import CAST from "../../public/art/portraits/jockeys/index.json";

type RGB = [number, number, number];
const pack = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;
const hex = (h: string): RGB => {
  const n = Number.parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const packHex = (h: string) => pack(...hex(h));
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as RGB;

export interface BustAnchors {
  face: [number, number];
  eyes: [number, number, number][] | null;
  mouth: [number, number, number] | null;
}

interface CastIndex {
  size: number;
  faceSize: number;
  keys: { skin: string[]; lip: string[]; hair: string[] };
  faces: Record<string, BustAnchors>;
}
export const BUST_INDEX = CAST as unknown as CastIndex;

const KEYS = PALETTE as unknown as Record<"silksPrimary" | "silksSecondary" | "cap", string[]>;
const PRIMARY = KEYS.silksPrimary.map(packHex);
const SLEEVES = KEYS.silksSecondary.map(packHex);
const CAPK = KEYS.cap.map(packHex);
const SKIN = BUST_INDEX.keys.skin.map(packHex);
const LIP = BUST_INDEX.keys.lip.map(packHex);
const HAIR = BUST_INDEX.keys.hair.map(packHex);

/** Club grey silks for freelancers. */
export const CLUB_SILKS: Silks = { primary: "#8d9296", secondary: "#c9cdd0", cap: "#6b7074", pattern: "solid" } as Silks;

/** A ramp around one colour (shadow -> light), like the race sprites' silks ramps. */
function around(h: string, n: number): RGB[] {
  const c = hex(h);
  return rampRgb([mixHex(c, [0, 0, 0], 0.42), mixHex(c, [0, 0, 0], 0.2), h, mixHex(c, [255, 255, 255], 0.22)], n);
}
function mixHex(a: RGB, b: RGB, t: number): string {
  return `#${mix(a, b, t)
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Deterministic per-pixel hash (freckles). */
const noise = (x: number, y: number) => {
  let h = Math.imul(x * 374761393 + y * 668265263, 1);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

/** Paint a keyed 128x128 bust (RGBA, in place) with a jockey's look and silks. */
export function paintJockeyBust(data: Uint8ClampedArray, size: number, look: gc.JockeyLook, silks: Silks | null, anchors: BustAnchors | null): void {
  const s = silks ?? CLUB_SILKS;
  const skin = rampRgb(gc.JOCKEY_SKINS[look.skin], SKIN.length);
  const hair = rampRgb(gc.JOCKEY_HAIRS[look.hair], HAIR.length);
  const lipBase = mix(hex(gc.JOCKEY_SKINS[look.skin][1]), [170, 70, 70], 0.32);
  const lips = [mix(lipBase, [0, 0, 0], 0.3), lipBase, mix(lipBase, [255, 220, 210], 0.25)];
  const body = around(s.primary, PRIMARY.length);
  const sleeves = around(s.secondary, SLEEVES.length);
  const bodyAlt = around(s.secondary, PRIMARY.length);
  const cap = around(s.cap, CAPK.length);
  const capAlt = around(s.secondary, CAPK.length);
  // boxes of the jacket and the cap, read on the keyed pixels
  const box = (keys: number[]) => {
    let x0 = size, y0 = size, x1 = -1, y1 = -1;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        if (data[i + 3]! < 8 || !keys.includes(pack(data[i]!, data[i + 1]!, data[i + 2]!))) continue;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    return x1 < 0 ? null : ([x0, y0, x1, y1] as [number, number, number, number]);
  };
  const jb = box(PRIMARY);
  const cb = box(CAPK);
  const freckles = look.acc.includes("freckles") && anchors;
  const fy0 = anchors?.eyes ? Math.max(...anchors.eyes.map((e) => e[1])) + 3 : (anchors?.face[1] ?? 0) + 24;
  const fx0 = anchors ? anchors.face[0] + 10 : 0;
  const fx1 = anchors ? anchors.face[0] + 54 : 0;
  const set = (i: number, c: RGB) => {
    data[i] = c[0];
    data[i + 1] = c[1];
    data[i + 2] = c[2];
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (data[i + 3]! < 8) continue;
      const k = pack(data[i]!, data[i + 1]!, data[i + 2]!);
      let j: number;
      if ((j = SKIN.indexOf(k)) >= 0) {
        if (freckles && j >= 4 && y >= fy0 && y <= fy0 + 8 && x >= fx0 && x <= fx1 && noise(x, y) < 0.16) j -= 2;
        set(i, skin[j]!);
      } else if ((j = HAIR.indexOf(k)) >= 0) set(i, hair[j]!);
      else if ((j = LIP.indexOf(k)) >= 0) set(i, lips[j]!);
      else if ((j = PRIMARY.indexOf(k)) >= 0) {
        const hit = jb && s.pattern !== "solid" && jerseyPatternAt(s.pattern, Math.floor(((x - jb[0]) * 16) / (jb[2] - jb[0] + 1)), Math.floor(((y - jb[1]) * 13) / (jb[3] - jb[1] + 1)));
        set(i, (hit ? bodyAlt : body)[j]!);
      } else if ((j = SLEEVES.indexOf(k)) >= 0) set(i, sleeves[j]!);
      else if ((j = CAPK.indexOf(k)) >= 0) {
        const hit = cb && s.pattern !== "solid" && capPatternAt(s.pattern, (x - cb[0]) / Math.max(1, cb[2] - cb[0]), (y - cb[1]) / Math.max(1, cb[3] - cb[1]));
        set(i, (hit ? capAlt : cap)[j]!);
      }
    }
  }
  const put = (x: number, y: number, c: RGB) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    if (data[i + 3]! < 8) return;
    set(i, c);
  };
  if (look.acc.includes("moustache") && anchors?.mouth) {
    const [x0, x1, y] = anchors.mouth;
    for (let x = x0; x <= x1; x++) put(x, y - 2, hair[x === x0 || x === x1 ? 1 : 2]!);
    for (let x = x0 + 1; x <= x1 - 1; x++) put(x, y - 3, hair[3]!);
    put(x0 - 1, y - 1, hair[1]!);
    put(x1 + 1, y - 1, hair[1]!);
  }
  if (look.acc.includes("glasses") && anchors?.eyes && anchors.eyes.length === 2) {
    const frame: RGB = [44, 34, 24];
    const glint: RGB = [214, 196, 140];
    for (const [ex, ey, r] of anchors.eyes) {
      for (let dy = -r - 1; dy <= r + 1; dy++)
        for (let dx = -r - 1; dx <= r + 1; dx++) {
          const d = Math.round(Math.hypot(dx, dy * 1.1));
          if (d === r) put(ex + dx, ey + dy, dx === -r + 1 && dy < 0 ? glint : frame);
        }
    }
    const [[ax, ay, ar], [bx, by, br]] = anchors.eyes as [[number, number, number], [number, number, number]];
    for (let x = ax + ar + 1; x < bx - br; x++) put(x, Math.round((ay + by) / 2) - 1, frame);
    for (let x = ax - ar - 5; x < ax - ar; x++) put(x, ay - 1, frame);
  }
}
