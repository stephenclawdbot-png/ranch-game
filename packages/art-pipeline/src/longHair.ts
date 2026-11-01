/**
 * The feathered horse's long hair (fe/fe), drawn in code (owner decision, 2026-11): a long wavy
 * mane and forelock, a thick tail to near the ground and bell-shaped feathering from the knees and
 * hocks over the fetlocks, grown per frame from the coat geometry's anchors (crest, poll, dock,
 * legs, ground line), so it follows the body exactly in every frame of every animation.
 *
 * Pixel-art strands in clumps of 2-3 texels with a dark / mid / light ramp of the sheet's own key
 * colours (mane keys for mane, forelock and tail; the leg's own keys for feathering, so the
 * recolour gives them the horse's colours and leg markings turn the feathering white over a sock
 * or stocking). Whole texels, no anti-aliasing. The motion comes from the animation: streaming
 * back in proportion to the sheet's speed (gallop, drive, break, lunge), hanging and swaying a
 * little at a walk or standing; the sway is a function of the frame index only, so a horse never
 * flickers and replays are identical. Hair is drawn over the horse and empty texels only: never
 * over the rider, the tack or another leg, never below the ground line.
 */
import { GEO_REGION, type CoatGeometry, type RoleGrid } from "./coatGeometry";

/** How fast each animation moves (0 standing .. 1 full gallop): how far the hair streams back. */
export const SHEET_SPEED: Record<string, number> = {
  "race/horse-gallop": 1,
  "race/horse-drive": 1,
  "race/horse-lunge": 1,
  "race/horse-break": 0.8,
  "race/horse-easeup": 0.6,
  "race/horse-celebrate": 0.55,
  "diorama/horse-canter": 0.6,
  "race/horse-pullup": 0.4,
  "diorama/horse-walk-jockey": 0.12,
  "diorama/horse-loose-walk": 0.12,
  "race/horse-idle": 0,
  "diorama/horse-loose-idle": 0,
  "diorama/horse-loose-graze": 0,
};

/** Speed of a sheet by its stem or file (its -f and N:1 copies move like it). */
export function sheetSpeed(src: string): number {
  const stem = src.replace(/\.png$/, "").replace(/-f(?=$|-s\d$)/, "").replace(/-s\d$/, "").replace(/^diorama\/horse-gallop$/, "race/horse-gallop");
  return SHEET_SPEED[stem] ?? 0;
}

export interface HairKeys {
  coat: readonly string[];
  mane?: readonly string[];
  points?: readonly string[];
}

export interface LongHair {
  /** Per frame-local texel (CoatGeometry layout): the key colour (packed rgb) the hair is drawn in, -1 none. */
  key: Int32Array;
  /** 0 none, 1 feathering (a leg's own keys), 2 mane, forelock or tail (mane keys). */
  kind: Uint8Array;
}

const hash = (a: number, b: number) => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * Grow the long hair of one sheet. `keyAt` gives a texel's key colour (packed rgb, -1 empty);
 * `speed` 0..1 (sheetSpeed). Shared by every feathered horse on the sheet (the colours come later
 * from the recolour and the leg markings).
 */
export function longHair(grid: RoleGrid, keyAt: (f: number, x: number, y: number) => number, geo: CoatGeometry, keys: HairKeys, speed: number): LongHair {
  const { frames, fw, fh, H } = geo;
  const n = frames * fw * fh;
  const key = new Int32Array(n).fill(-1);
  const kind = new Uint8Array(n);
  const pack = (h: string) => Number.parseInt(h.slice(1), 16);
  const mane = (keys.mane ?? []).map(pack);
  if (!mane.length) return { key, kind };
  const ramps = [keys.coat.map(pack), (keys.points ?? []).map(pack)];
  /** A key one step darker / lighter in its own ramp (strand shading of the feathering). */
  const shift = (k: number, d: number) => {
    for (const r of ramps) {
      const i = r.indexOf(k);
      if (i >= 0) return r[Math.min(r.length - 1, Math.max(0, i + d))]!;
    }
    return k;
  };
  const maneShade = (t: number) => mane[Math.min(mane.length - 1, Math.max(Math.min(1, mane.length - 1), Math.round(t * (mane.length - 1))))]!;

  for (let f = 0; f < frames; f++) {
    const base = f * fw * fh;
    const at = (x: number, y: number) => base + y * fw + x;
    const { rumpX } = geo.anchors[f]!;
    if (!rumpX && !geo.anchors[f]!.belly) continue;
    // the ground line: the lowest horse texel of the frame
    let ground = 0;
    let faceX0 = fw;
    let faceTop = fh;
    let faceTopX = -1;
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        const r = geo.region[at(x, y)]!;
        if (!r || geo.outside[at(x, y)]) continue;
        if (y > ground) ground = y;
        if (r === GEO_REGION.face) {
          faceX0 = Math.min(faceX0, x);
          if (y < faceTop) {
            faceTop = y;
            faceTopX = x;
          }
        }
      }
    const phase = (f / Math.max(1, frames)) * Math.PI * 2;
    const sway = (k: number) => Math.sin(phase + k * 0.9) * (1 - speed);
    const flutter = (k: number) => Math.sin(phase * 2 + k * 1.7) * speed;

    /** Plot one hair texel: over the horse's coat / mane or empty air, never the rider, tack or ground. */
    const plot = (x: number, y: number, k: number, kd: 1 | 2, legRegion = 0, legG = 0, legMid = 0) => {
      const xi = Math.round(x);
      const yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= fw || yi >= fh || yi > ground) return;
      const i = at(xi, yi);
      const role = grid.role(f, xi, yi);
      if (role >= 4) return;
      if (role >= 1 && !geo.region[i]) return; // the rider's face and hands (coat-keyed, no region)
      if (legRegion) {
        // feathering: on this leg, or on empty air next to it (which joins the leg's hair room, so
        // its markings and patterns reach the hair), never on another leg
        if (geo.region[i] !== legRegion) {
          if (role !== 0 || geo.region[i]) return;
          geo.region[i] = legRegion;
          geo.outside[i] = 1;
          geo.p1[i] = legG;
          geo.p2[i] = xi - legMid;
        }
      } else if (role === 0 && geo.region[i] && geo.region[i]! <= 4) return; // never another leg's room
      key[i] = k;
      kind[i] = kd;
    };

    // ---- mane: clumps hanging from the crest, past halfway down the neck ----
    const crestX0 = Math.round(rumpX + H * 1.95);
    const crestX1 = faceX0 < fw ? faceX0 + 2 : Math.round(rumpX + H * 3.0);
    for (let x0 = crestX0, k = 0; x0 <= crestX1; x0 += 2, k++) {
      // crest: the top horse texel of the column (the mane's top)
      let cy = -1;
      for (let y = 0; y < fh; y++) {
        const r = geo.region[at(x0, y)]!;
        if (r && !geo.outside[at(x0, y)] && grid.role(f, x0, y) >= 1 && grid.role(f, x0, y) <= 3) {
          cy = y;
          break;
        }
      }
      if (cy < 0) continue;
      const along = (x0 - crestX0) / Math.max(1, crestX1 - crestX0);
      const taper = Math.min(1, along / 0.18);
      const len = H * (0.5 + 0.14 * hash(k, 7)) * taper;
      // streaming back (to the left, slightly down) at speed; hanging with a sway at rest
      const dx = -1.25 * speed;
      const dy = 1 - 0.55 * speed;
      const norm = Math.hypot(dx, dy);
      for (let s = 0; s <= len; s++) {
        const t = s / Math.max(1, len);
        const wave = Math.sin(s / 3 + k) * 0.6 + sway(k) * 1.5 * t + flutter(k) * 1.2 * t;
        const x = x0 + (dx / norm) * s + wave;
        const y = cy + (dy / norm) * s;
        const tip = s > len - 2;
        plot(x, y, maneShade(tip ? 0.5 : 0.62), 2);
        plot(x + 1, y, maneShade(tip ? 0.7 : 1), 2);
        if (hash(k, 3) > 0.35) plot(x + 2, y, maneShade(0.82), 2);
      }
    }

    // ---- forelock: down the forehead from the poll ----
    if (faceTopX >= 0) {
      for (let k = 0; k < 3; k++) {
        const x0 = faceTopX + k - 1;
        const len = H * (0.32 + 0.08 * hash(k, 11));
        for (let s = 0; s <= len; s++) {
          const t = s / Math.max(1, len);
          const x = x0 + s * (0.35 - 0.9 * speed) + Math.sin(s / 2.5 + k) * 0.5 + sway(k + 5) * t;
          const y = faceTop + 1 + s * (1 - 0.3 * speed);
          plot(x, y, maneShade(k === 1 ? 0.85 : 0.55), 2);
        }
      }
    }

    // ---- tail: thick clumps from the dock, to near the ground (streaming at speed) ----
    let rootX = -1;
    let rootY = -1;
    let tipX = 0;
    let tipY = 0;
    let bestA = Infinity;
    let worstA = -1;
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        const i = at(x, y);
        if (geo.region[i] !== GEO_REGION.tail || geo.outside[i]) continue;
        const a = geo.p1[i]!;
        if (a < bestA) {
          bestA = a;
          rootX = x;
          rootY = y;
        }
        if (a > worstA) {
          worstA = a;
          tipX = x;
          tipY = y;
        }
      }
    if (rootX >= 0) {
      let ax = tipX - rootX;
      let ay = tipY - rootY;
      const l0 = Math.max(4, Math.hypot(ax, ay));
      ax /= l0;
      ay /= l0;
      // traced from the dock along the sprite's own tail (it already hangs or streams with the
      // animation), longer and fuller
      const dirX = ax;
      const dirY = ay;
      const len = l0 * (1.3 + 0.2 * (1 - speed));
      for (let k = 0; k < 6; k++) {
        const spread = (k - 2.5) * (H * 0.04);
        const kl = len * (0.82 + 0.18 * hash(k, 13));
        for (let s = 0; s <= kl; s++) {
          const t = s / Math.max(1, kl);
          // fan out from the dock; wave and sway along the strand
          const off = spread * (0.35 + 0.65 * t);
          const wave = Math.sin(s / 4 + k * 1.3) * 0.7 + sway(k + 9) * 2 * t + flutter(k + 9) * 2 * t;
          const x = rootX + dirX * s - dirY * off + wave;
          const y = rootY + dirY * s + dirX * off;
          const tip = s > kl - 2;
          plot(x, y, maneShade(tip ? 0.4 : k % 2 ? 0.55 : 0.85), 2);
          plot(x + (dirY > 0.7 ? 1 : 0), y + (dirY > 0.7 ? 0 : 1), maneShade(0.5), 2);
        }
      }
    }

    // ---- feathering: a bell from the knee / hock over the fetlock to the hoof top ----
    for (const reg of [GEO_REGION.frontNear, GEO_REGION.frontFar, GEO_REGION.hindNear, GEO_REGION.hindFar]) {
      const rows = new Map<number, [number, number, number]>(); // y -> [left, right, g]
      for (let y = 0; y < fh; y++)
        for (let x = 0; x < fw; x++) {
          const i = at(x, y);
          if (geo.region[i] !== reg || geo.outside[i]) continue;
          const r = rows.get(y);
          if (r) {
            r[0] = Math.min(r[0], x);
            r[1] = Math.max(r[1], x);
          } else rows.set(y, [x, x, geo.p1[i]!]);
        }
      if (!rows.size) continue;
      const bottom = Math.max(...rows.keys());
      // strands hang from the back of the cannon (knee / hock down to the fetlock) and drape over
      // the fetlock to the hoof top, streaming back at speed; a few short ones over the front of
      // the fetlock. The hoof's sole row stays clear (the ground line never moves).
      const lastRow = bottom - 1;
      let strand = 0;
      for (const [y0, [l, r, g]] of [...rows].sort((p, q) => p[0] - q[0])) {
        // a leg lying flat (stretched out in the gallop) has wide rows: its hair stays in the
        // rows that hang, so no plume trails along it
        if (g > 0.42 || g < 0.12 || r - l > H * 0.3) continue;
        const srcKey = keyAt(f, Math.round((l + r) / 2), y0);
        if (srcKey < 0) continue;
        strand++;
        const lean = -0.32 - 1.1 * speed;
        const len = Math.min(lastRow - y0, Math.round(H * 0.32)) - Math.floor(hash(strand, reg) * 2);
        // three strands side by side from the back of the leg: a fringe with body
        for (let w = 0; w < 3; w++) {
          const wl = len - w * 2;
          for (let s2 = 0; s2 <= wl; s2++) {
            const t = s2 / Math.max(1, wl);
            // the fringe bells out toward the fetlock and tucks in over the hoof
            const bell = t < 0.7 ? t / 0.7 : 1 - ((t - 0.7) / 0.3) * 0.6;
            const x = l - 1 - w + Math.max(-H * 0.16, lean * s2 * bell) + sway(strand + reg) * t;
            const y = y0 + s2;
            plot(x, y, shift(srcKey, (strand + w) % 4 === 0 ? -1 : w === 1 ? 1 : 0), 1, reg, g, (l + r) / 2);
          }
        }
        // the front of the fetlock: short strands near the bottom
        if (g < 0.2) for (let s2 = 0; s2 <= Math.min(3, lastRow - y0); s2++) plot(r + 1 + (speed > 0.5 ? -1 : 0), y0 + s2, shift(srcKey, 0), 1, reg, g, (l + r) / 2);
      }
    }
  }
  return { key, kind };
}

// ---------------------------------------------------------------------------
// Per-horse mane and tail (visual research V-05)
// ---------------------------------------------------------------------------

/**
 * Mane and tail styles, grown once per sheet as a field every horse reads with its own style
 * (game-core hairOf, `appearance.hair`): per texel and per strand set (0 straight, 1 wavy) one
 * byte, 0 = no hair, else bits 0-3 the shortest length level (1..15) that reaches the texel, bits
 * 4-5 its shade (HAIR_SHADES), bit 6 drawn only for thick hair, bit 7 tail (else mane or forelock).
 * A horse shows the texel when its mane (or tail) level reaches it, so a longer mane is the shorter
 * one grown on, in every frame and every view (the Trackside shader reads the same bytes).
 */
export interface HairField {
  sets: [Uint8Array, Uint8Array];
}

/** Mane level per style (0 pulled / as painted, 1 short, 2 medium, 3 long) and tail level per style (0 as painted, 1 full, 2 long). */
export const MANE_LEVEL = [0, 4, 8, 12] as const;
export const TAIL_LEVEL = [0, 11, 14] as const;
/** The four shades of the code-drawn hair (mane ramp position). */
export const HAIR_SHADES = [0.42, 0.58, 0.75, 0.95] as const;
/** Mane strand length per level, as a share of the barrel depth H. */
export const MANE_UNIT = 0.06;

export interface HairLevels {
  mane: number;
  tail: number;
  thick: boolean;
}

/** The levels a style reaches. */
export function hairLevels(h: { mane: number; tail: number; thick: boolean }): HairLevels {
  return { mane: MANE_LEVEL[Math.max(0, Math.min(3, h.mane))]!, tail: TAIL_LEVEL[Math.max(0, Math.min(2, h.tail))]!, thick: h.thick };
}

/** Whether a field byte shows for a horse's levels. */
export function hairShows(byte: number, lv: HairLevels): boolean {
  const lvl = byte & 15;
  if (!lvl) return false;
  if (byte & 64 && !lv.thick) return false;
  return lvl <= (byte & 128 ? lv.tail : lv.mane);
}

/** Grow the mane and tail field of one sheet (see HairField). Pure; deterministic per sheet. */
export function hairField(grid: RoleGrid, geo: CoatGeometry, speed: number): HairField {
  const { frames, fw, fh, H } = geo;
  const n = frames * fw * fh;
  const sets: [Uint8Array, Uint8Array] = [new Uint8Array(n), new Uint8Array(n)];
  const lvlOf = (v: number) => Math.max(1, Math.min(15, Math.ceil(v)));
  for (let f = 0; f < frames; f++) {
    const base = f * fw * fh;
    const at = (x: number, y: number) => base + y * fw + x;
    const { rumpX } = geo.anchors[f]!;
    if (!rumpX && !geo.anchors[f]!.belly) continue;
    let ground = 0;
    let faceX0 = fw;
    let faceTop = fh;
    let faceTopX = -1;
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        const r = geo.region[at(x, y)]!;
        if (!r || geo.outside[at(x, y)]) continue;
        if (y > ground) ground = y;
        if (r === GEO_REGION.face) {
          faceX0 = Math.min(faceX0, x);
          if (y < faceTop) {
            faceTop = y;
            faceTopX = x;
          }
        }
      }
    const phase = (f / Math.max(1, frames)) * Math.PI * 2;
    const sway = (k: number) => Math.sin(phase + k * 0.9) * (1 - speed);
    const flutter = (k: number) => Math.sin(phase * 2 + k * 1.7) * speed;

    for (let set = 0; set < 2; set++) {
      const out = sets[set]!;
      const amp = set ? 1.25 : 0.3;
      const freq = set ? 3.4 : 5;
      /** Plot one hair texel (over the horse's coat / mane or empty air; never the rider, tack, a leg or below the ground). */
      const plot = (x: number, y: number, lvl: number, shade: number, thickOnly: boolean, tail: boolean) => {
        const xi = Math.round(x);
        const yi = Math.round(y);
        if (xi < 0 || yi < 0 || xi >= fw || yi >= fh || yi > ground) return;
        const i = at(xi, yi);
        const role = grid.role(f, xi, yi);
        if (role >= 4) return;
        if (role >= 1 && !geo.region[i]) return;
        if (geo.region[i] && geo.region[i]! <= 4) return;
        const b = lvl | (shade << 4) | (thickOnly ? 64 : 0) | (tail ? 128 : 0);
        const old = out[i]!;
        if (old && (old & 15) < lvl) return;
        if (old && (old & 15) === lvl && !(old & 64) && thickOnly) return;
        out[i] = b;
      };

      // ---- mane: strands from the crest down the neck (levels grow with the strand) ----
      const crestX0 = Math.round(rumpX + H * 1.95);
      const crestX1 = faceX0 < fw ? faceX0 + 2 : Math.round(rumpX + H * 3.0);
      const unit = H * MANE_UNIT;
      for (let x0 = crestX0, k = 0; x0 <= crestX1; x0 += 2, k++) {
        let cy = -1;
        for (let y = 0; y < fh; y++) {
          const r = geo.region[at(x0, y)]!;
          if (r && !geo.outside[at(x0, y)] && grid.role(f, x0, y) >= 1 && grid.role(f, x0, y) <= 3) {
            cy = y;
            break;
          }
        }
        if (cy < 0) continue;
        const along = (x0 - crestX0) / Math.max(1, crestX1 - crestX0);
        const taper = 0.35 + 0.65 * Math.min(1, along / 0.18);
        const fac = (0.85 + 0.3 * hash(k, 7 + set)) * taper;
        const maxLen = 15 * unit * fac;
        const dx = -1.25 * speed;
        const dy = 1 - 0.55 * speed;
        const norm = Math.hypot(dx, dy);
        const dark = k % 3 === 0;
        for (let s = 0; s <= maxLen; s++) {
          const t = s / Math.max(1, 12 * unit);
          const wave = Math.sin(s / freq + k) * amp * Math.min(1, s / 3) + sway(k) * 1.5 * t + flutter(k) * 1.2 * t;
          const x = x0 + (dx / norm) * s + wave;
          const y = cy + (dy / norm) * s;
          const lvl = lvlOf((s + 1) / (unit * fac));
          plot(x, y, lvl, dark ? 0 : 1, false, false);
          plot(x + 1, y, lvl, dark ? 2 : 3, false, false);
          plot(x + 2, y, lvl, 2, true, false);
        }
      }

      // ---- forelock: from the poll down the forehead (from the medium mane up) ----
      if (faceTopX >= 0)
        for (let k = 0; k < 3; k++) {
          const x0 = faceTopX + k - 1;
          for (let s = 0; s <= H * 0.45; s++) {
            const t = s / Math.max(1, H * 0.4);
            const x = x0 + s * (0.35 - 0.9 * speed) + Math.sin(s / 2.5 + k) * (set ? 0.8 : 0.4) + sway(k + 5) * t;
            const y = faceTop + 1 + s * (1 - 0.3 * speed);
            plot(x, y, lvlOf(6 + (s + 1) / (H * 0.05)), k === 1 ? 3 : 1, k === 2, false);
          }
        }

      // ---- tail: strands traced from the dock along the sprite's own tail ----
      let rootX = -1;
      let rootY = -1;
      let tipX = 0;
      let tipY = 0;
      let bestA = Infinity;
      let worstA = -1;
      for (let y = 0; y < fh; y++)
        for (let x = 0; x < fw; x++) {
          const i = at(x, y);
          if (geo.region[i] !== GEO_REGION.tail || geo.outside[i]) continue;
          const a = geo.p1[i]!;
          if (a < bestA) {
            bestA = a;
            rootX = x;
            rootY = y;
          }
          if (a > worstA) {
            worstA = a;
            tipX = x;
            tipY = y;
          }
        }
      if (rootX >= 0) {
        let ax = tipX - rootX;
        let ay = tipY - rootY;
        const l0 = Math.max(4, Math.hypot(ax, ay));
        ax /= l0;
        ay /= l0;
        for (let k = 0; k < 8; k++) {
          const thickOnly = k >= 6;
          const spread = (thickOnly ? (k === 6 ? -3.6 : 3.6) : k - 2.5) * (H * 0.04);
          const fac = 0.85 + 0.2 * hash(k, 13 + set);
          const maxLen = l0 * 1.5 * fac;
          for (let s = 0; s <= maxLen; s++) {
            const t = s / Math.max(1, l0 * 1.3);
            const off = spread * (0.35 + 0.65 * Math.min(1, t));
            const wave = Math.sin(s / (freq + 1) + k * 1.3) * (set ? 1.4 : 0.5) * Math.min(1, s / 4) + sway(k + 9) * 2 * t + flutter(k + 9) * 2 * t;
            const x = rootX + ax * s - ay * off + wave;
            const y = rootY + ay * s + ax * off;
            const lvl = lvlOf((s + 1) / (l0 * 0.1 * fac));
            plot(x, y, lvl, k % 2 ? 1 : 2, thickOnly, true);
            plot(x + (ay > 0.7 ? 1 : 0), y + (ay > 0.7 ? 0 : 1), lvl, 0, thickOnly, true);
          }
        }
      }
    }
  }
  return { sets };
}

/** The mane key (packed rgb) of a hair shade (2 bits), as the long hair picks it. */
export function hairKey(mane: readonly number[], shade: number): number {
  const t = HAIR_SHADES[shade & 3]!;
  return mane[Math.min(mane.length - 1, Math.max(Math.min(1, mane.length - 1), Math.round(t * (mane.length - 1))))]!;
}
