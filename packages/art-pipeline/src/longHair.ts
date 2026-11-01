/**
 * Code-drawn hair on the keyed horse sheets (coat audit 2026-11, visual research V-05), grown per
 * frame from the coat geometry's anchors (crest, poll, dock, legs, ground line), so it follows the
 * body exactly in every frame of every animation:
 *   - the feathered horse's (fe/fe) leg feathering: a fringe on the back of each cannon from the
 *     knee or hock down over the fetlock, in the leg's own keys (markings turn it white over a sock);
 *   - every horse's mane, forelock and tail (hairField): one field per sheet, each horse reading its
 *     own length, thickness and wave from it.
 * Whole texels, no anti-aliasing. Every strand is drawn as a connected line from its root on the
 * horse and stops where it would meet the rider, the tack or reins, a leg or the ground, so no hair
 * pixel ever floats free of the horse or covers its bridle. The motion comes from the animation: streaming back in
 * proportion to the sheet's speed, hanging and swaying a little at a walk or standing; the sway is
 * a function of the frame index only, so a horse never flickers and replays are identical.
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
  /** 0 none, 1 feathering (a leg's own keys). */
  kind: Uint8Array;
}

const hash = (a: number, b: number) => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** The texels of a line from (x0, y0) to (x1, y1), whole texels, each 8-connected to the last. */
function line(x0: number, y0: number, x1: number, y1: number, visit: (x: number, y: number) => boolean): boolean {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xe = Math.round(x1);
  const ye = Math.round(y1);
  const dx = Math.abs(xe - x);
  const dy = -Math.abs(ye - y);
  const sx = x < xe ? 1 : -1;
  const sy = y < ye ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (!visit(x, y)) return false;
    if (x === xe && y === ye) return true;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** The lowest horse texel of each frame (the ground line). */
function groundOf(geo: CoatGeometry, f: number): number {
  const { fw, fh } = geo;
  let ground = 0;
  for (let y = 0; y < fh; y++)
    for (let x = 0; x < fw; x++) {
      const i = (f * fh + y) * fw + x;
      if (geo.region[i] && !geo.outside[i] && y > ground) ground = y;
    }
  return ground;
}

/**
 * The feathered horse's leg feathering on one sheet (fe/fe): per leg, per row from the knee or
 * hock down to the fetlock, a run of hair growing from the back edge of the cannon (widest over the
 * fetlock, streaming a little further back at speed) and a short tuft over the front of the
 * fetlock. Each run starts at the leg and stops at anything opaque, so it always hangs on the leg.
 * The hair texels join their leg's room in the geometry (its markings and patterns reach them).
 * `keyAt` gives a texel's key colour (packed rgb, -1 empty).
 */
export function longHair(grid: RoleGrid, keyAt: (f: number, x: number, y: number) => number, geo: CoatGeometry, keys: HairKeys, speed: number): LongHair {
  const { frames, fw, fh, H } = geo;
  const n = frames * fw * fh;
  const key = new Int32Array(n).fill(-1);
  const kind = new Uint8Array(n);
  const pack = (h: string) => Number.parseInt(h.slice(1), 16);
  const ramps = [keys.coat.map(pack), (keys.points ?? []).map(pack)];
  /** A key one step darker / lighter in its own ramp (strand shading). */
  const shift = (k: number, d: number) => {
    for (const r of ramps) {
      const i = r.indexOf(k);
      if (i >= 0) return r[Math.min(r.length - 1, Math.max(0, i + d))]!;
    }
    return k;
  };
  const maxW = Math.max(2, Math.round(H * (0.07 + 0.05 * speed)));
  for (let f = 0; f < frames; f++) {
    if (!geo.anchors[f]!.rumpX && !geo.anchors[f]!.belly) continue;
    const ground = groundOf(geo, f);
    const at = (x: number, y: number) => (f * fh + y) * fw + x;
    for (const reg of [GEO_REGION.frontNear, GEO_REGION.frontFar, GEO_REGION.hindNear, GEO_REGION.hindFar]) {
      // per row, each run of the leg's texels (a leg's room can hold both legs of a pair where
      // they stand apart): y -> [left, right, g] runs
      const rows = new Map<number, [number, number, number][]>();
      let bottom = -1;
      for (let y = 0; y < fh; y++) {
        let run: [number, number, number] | null = null;
        for (let x = 0; x < fw; x++) {
          const i = at(x, y);
          const mine = geo.region[i] === reg && !geo.outside[i];
          if (!mine) {
            // ink inside a leg (its own shading lines) does not split it; a gap of air does
            if (run && grid.role(f, x, y) === 0) run = null;
            continue;
          }
          bottom = Math.max(bottom, y);
          if (run) run[1] = x;
          else {
            run = [x, x, geo.p1[i]!];
            const list = rows.get(y);
            if (list) list.push(run);
            else rows.set(y, [run]);
          }
        }
      }
      if (bottom < 0) continue;
      /** Grow one hair texel into the leg's room; false when the texel is taken (the run stops). */
      const grow = (x: number, y: number, k: number, g: number, mid: number) => {
        if (x < 0 || y < 0 || x >= fw || y >= fh || y > Math.min(ground, bottom - 1)) return false;
        const i = at(x, y);
        if (grid.role(f, x, y) !== 0) return false;
        if (geo.region[i] && geo.region[i] !== reg) return false;
        geo.region[i] = reg;
        geo.outside[i] = 1;
        geo.p1[i] = g;
        geo.p2[i] = x - mid;
        if (key[i]! < 0) key[i] = k;
        kind[i] = 1;
        return true;
      };
      for (const [y, runs] of rows)
        for (const [l, r, g] of runs) {
        // the cannon below the knee or hock, down to just above the hoof; a leg lying flat in
        // the gallop has wide rows: its hair stays where the leg hangs
        if (g > 0.45 || g < 0.08 || r - l > H * 0.3 || y >= bottom - 1) continue;
        const src = keyAt(f, l, y);
        if (src < 0) continue;
        // a bell: thin under the knee, widest over the fetlock, tucked in over the hoof
        const t = (0.45 - g) / 0.37;
        const bell = g < 0.14 ? 0.55 : Math.min(1, 0.35 + t * 0.9);
        const w = Math.max(1, Math.round(maxW * bell * (0.85 + 0.3 * hash(y, reg))));
        const mid = (l + r) / 2;
        // the hair starts just past the leg's outline (ink one or two texels wide), never past
        // the other leg or anything else
        const past = (x: number, dir: number) => {
          for (let k = 0; k < 3; k++, x += dir) {
            if (x < 0 || x >= fw) return -1;
            const role = grid.role(f, x, y);
            if (role === 0) return x;
            if (role !== 4) return -1;
          }
          return -1;
        };
        const back = past(l - 1, -1);
        if (back >= 0) for (let d = 0; d < w; d++) if (!grow(back - d, y, shift(src, d === w - 1 ? -1 : (y + d) % 3 === 0 ? 1 : 0), g, mid)) break;
        // the front of the fetlock: a short tuft
        const front = g < 0.2 ? past(r + 1, 1) : -1;
        if (front >= 0) grow(front, y, shift(src, 0), g, mid);
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
 * one grown on, in every frame and every view (the Trackside shader reads the same bytes). Each
 * strand is a connected line from its root and its levels only grow along it, so whatever length a
 * horse shows is joined to the horse.
 */
export interface HairField {
  sets: [Uint8Array, Uint8Array];
}

/** Mane level per style (0 pulled / as painted, 1 short, 2 medium, 3 long) and tail level per style (0 as painted, 1 full, 2 long). */
export const MANE_LEVEL = [0, 4, 8, 12] as const;
export const TAIL_LEVEL = [0, 11, 14] as const;
/** The four shades of the code-drawn hair (mane ramp position): the first is the outline (the rim of a grown tail, the mane's few strand breaks). */
export const HAIR_SHADES = [0.12, 0.58, 0.75, 0.95] as const;
/** Mane strand length per level, as a share of the barrel depth H. */
export const MANE_UNIT = 0.04;

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
    const ground = groundOf(geo, f);
    let faceX0 = fw;
    let faceTop = fh;
    let faceTopX = -1;
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        const i = at(x, y);
        if (geo.region[i] !== GEO_REGION.face || geo.outside[i]) continue;
        faceX0 = Math.min(faceX0, x);
        if (y < faceTop) {
          faceTop = y;
          faceTopX = x;
        }
      }
    /**
     * What a strand meets at a texel: 0 free (draw), 1 the hair's own painted outline (pass over it
     * without drawing: the painted mane's or tail's ink), 2 blocked (the rider, the tack and reins,
     * a leg, the frame's edge or the ground): the strand stops there.
     */
    const meets = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= fw || y >= fh || y > ground) return 2;
      const role = grid.role(f, x, y);
      const r = geo.region[at(x, y)]!;
      if (r && r <= 4 && !geo.outside[at(x, y)]) return 2; // a leg (the air beside it stays open)
      if (role >= 4) {
        // ink touching the painted mane or tail is its outline; any other ink is tack or rider
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const qx = x + dx;
            const qy = y + dy;
            if (qx < 0 || qy < 0 || qx >= fw || qy >= fh) continue;
            const q = geo.region[at(qx, qy)];
            if ((q === GEO_REGION.mane || q === GEO_REGION.tail) && !geo.outside[at(qx, qy)] && grid.role(f, qx, qy) === 3) return role === 4 ? 1 : 2;
          }
        return 2;
      }
      if (role >= 1 && !r) return 2; // the rider's face and hands
      return 0;
    };
    const phase = (f / Math.max(1, frames)) * Math.PI * 2;
    const sway = (k: number) => Math.sin(phase + k * 0.9) * (1 - speed);
    const flutter = (k: number) => Math.sin(phase * 2 + k * 1.7) * speed;

    for (let set = 0; set < 2; set++) {
      const out = sets[set]!;
      const amp = set ? 1.1 : 0.3;
      const freq = set ? 4.2 : 6;
      const put = (x: number, y: number, lvl: number, shade: number, thickOnly: boolean, tail: boolean) => {
        const i = at(x, y);
        const b = lvl | (shade << 4) | (thickOnly ? 64 : 0) | (tail ? 128 : 0);
        const old = out[i]!;
        if (old && (old & 15) < lvl) return;
        if (old && (old & 15) === lvl && !(old & 64) && thickOnly) return;
        out[i] = b;
      };
      /**
       * One strand: a connected line through `pts` (from the root), each point with its level, and
       * `side` columns beside it to the right (the strand's width); `col(c)` shades column c. All
       * of it is thick-only when `thickOnly`. It stops at the first blocked texel, and a side
       * column stops at its first blocked texel, so every drawn texel is joined to the root.
       */
      const strand = (pts: [number, number, number][], col: (c: number) => number, side: number, thickOnly: boolean, tail: boolean) => {
        for (let p = 1; p < pts.length; p++) {
          const [x0, y0] = pts[p - 1]!;
          const [x1, y1, lvl] = pts[p]!;
          const ok = line(x0, y0, x1, y1, (x, y) => {
            const m = meets(x, y);
            if (m === 2) return false;
            if (m === 0) put(x, y, lvl, col(0), thickOnly, tail);
            for (let c = 1; c <= side; c++) {
              const mc = meets(x + c, y);
              if (mc === 2) break;
              if (mc === 0) put(x + c, y, lvl, col(c), thickOnly, tail);
            }
            return true;
          });
          if (!ok) return;
        }
      };

      // ---- mane: strands from the crest down the neck, three texels wide (one mass) ----
      const crestX0 = Math.round(rumpX + H * 1.95);
      const crestX1 = faceX0 < fw ? faceX0 + 1 : Math.round(rumpX + H * 3.0);
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
        const taper = 0.3 + 0.7 * Math.min(1, along / 0.3);
        const fac = (0.9 + 0.2 * hash(k, 7 + set)) * taper;
        const maxLen = 15 * unit * fac;
        const dx = -1.25 * speed;
        const dy = 1 - 0.55 * speed;
        const norm = Math.hypot(dx, dy);
        const pts: [number, number, number][] = [[x0, cy, 1]];
        for (let s = 1; s <= maxLen; s++) {
          const t = s / Math.max(1, 12 * unit);
          const wave = Math.sin(s / freq + k * 0.7) * amp * Math.min(1, s / 4) + sway(k) * 1.5 * t + flutter(k) * 1.2 * t;
          pts.push([x0 + (dx / norm) * s + wave, cy + (dy / norm) * s, lvlOf(s / (unit * fac))]);
        }
        // a few darker strands break up the mass
        const dark = k % 3 === 0;
        strand(pts, (c) => (dark ? (c === 0 ? 0 : 1) : c === 2 ? 2 : 1), 2, false, false);
      }

      // ---- forelock: from the poll down the forehead (from the medium mane up) ----
      if (faceTopX >= 0)
        for (let k = 0; k < 2; k++) {
          const x0 = faceTopX + k;
          const pts: [number, number, number][] = [[x0, faceTop, 7]];
          for (let s = 1; s <= H * 0.45; s++) {
            const t = s / Math.max(1, H * 0.4);
            pts.push([x0 + s * (0.35 - 0.9 * speed) + Math.sin(s / 3 + k) * (set ? 0.6 : 0.2) + sway(k + 5) * t, faceTop + s * (1 - 0.3 * speed), lvlOf(6 + s / (H * 0.05))]);
          }
          strand(pts, (c) => (c ? 3 : k ? 2 : 1), 1, false, false);
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
        const painted = (x: number, y: number) => {
          if (x < 0 || y < 0 || x >= fw || y >= fh) return false;
          const i = at(x, y);
          return geo.region[i] === GEO_REGION.tail && !geo.outside[i] && grid.role(f, x, y) === 3;
        };
        // the tail's end: where its last third points (the painted tail may curve on the way)
        let mx = 0;
        let my = 0;
        let mn = 0;
        let ex = 0;
        let ey = 0;
        let en = 0;
        for (let y = 0; y < fh; y++)
          for (let x = 0; x < fw; x++) {
            if (!painted(x, y)) continue;
            const a = (geo.p1[at(x, y)]! - bestA) / Math.max(1e-6, worstA - bestA);
            if (a >= 0.55 && a < 0.8) {
              mx += x;
              my += y;
              mn++;
            } else if (a >= 0.85) {
              ex += x;
              ey += y;
              en++;
            }
          }
        if (mn && en) {
          mx /= mn;
          my /= mn;
          ex /= en;
          ey /= en;
          const dl = Math.hypot(ex - mx, ey - my);
          // blended with the whole tail's line, so a stubby end still points the right way
          let dx = (dl > 1 ? (ex - mx) / dl : ax) * 0.7 + ax * 0.3;
          let dy = (dl > 1 ? (ey - my) / dl : ay) * 0.7 + ay * 0.3;
          const dn = Math.hypot(dx, dy) || 1;
          dx /= dn;
          dy /= dn;
          const lanes = [-1.5, -0.5, 0.5, 1.5, 2.5, -2.5, 3.5];
          for (let k = 0; k < lanes.length; k++) {
            const thickOnly = k >= 5;
            const lane = lanes[k]!;
            // strands start across the tail's end, inside its painted hair, and fan out from there
            let sx = -1;
            let sy = -1;
            let best = Infinity;
            const tx = ex - dy * lane * H * 0.035;
            const ty = ey + dx * lane * H * 0.035;
            for (let yy = Math.floor(ty) - 3; yy <= Math.ceil(ty) + 3; yy++)
              for (let xx = Math.floor(tx) - 3; xx <= Math.ceil(tx) + 3; xx++) {
                if (!painted(xx, yy)) continue;
                const d = Math.hypot(xx - tx, yy - ty);
                if (d < best) {
                  best = d;
                  sx = xx;
                  sy = yy;
                }
              }
            if (sx < 0) continue;
            // the middle strands run longest and the outer ones fall short: the tail ends in a
            // rounded brush, never in one strand poking out on its own
            const fac = (1 - 0.12 * Math.abs(lane - 0.5)) * (0.95 + 0.1 * hash(k, 13 + set));
            const ext = l0 * 0.45 * fac;
            const pts: [number, number, number][] = [[sx, sy, 10]];
            for (let s = 1; s <= ext; s++) {
              const t = s / Math.max(1, ext);
              const off = lane * H * 0.03 * t;
              const wave = Math.sin(s / (freq * 0.6) + k * 0.8) * (set ? 0.9 : 0.25) * Math.min(1, s / 4) + (sway(k + 9) + flutter(k + 9)) * 1.5 * t;
              pts.push([sx + dx * s - dy * (off + wave), sy + dy * s + dx * (off + wave), lvlOf(10 + s / (l0 * 0.1 * fac))]);
            }
            strand(pts, (c) => (c ? 1 : k % 2 ? 1 : 2), 1, thickOnly, true);
          }
          // the grown tail's rim against open air takes the darkest shade: a clean outline round
          // the brush (like the painted tail's ink), never loose light strands on the grass
          for (let y = 0; y < fh; y++)
            for (let x = 0; x < fw; x++) {
              const i = at(x, y);
              const b = out[i]!;
              if (!(b & 128) || painted(x, y)) continue;
              const air = (qx: number, qy: number) => qx < 0 || qy < 0 || qx >= fw || qy >= fh || (!out[at(qx, qy)] && grid.role(f, qx, qy) === 0);
              if (air(x - 1, y) || air(x + 1, y) || air(x, y - 1) || air(x, y + 1)) out[i] = b & ~48;
            }
        }
      }
    }
  }
  for (const out of sets) keepJoined(grid, geo, out);
  return { sets };
}

/**
 * Every texel a style shows must be joined (8-connected) to the horse: for each style (mane and
 * tail level, thick or fine), hair the horse could not reach is raised to the next level (or made
 * thick-only) until none is left loose. Monotone, so it settles; the same for every view.
 */
function keepJoined(grid: RoleGrid, geo: CoatGeometry, out: Uint8Array): void {
  const { frames, fw, fh } = geo;
  const seen = new Uint8Array(fw * fh);
  const stack: number[] = [];
  const styles: HairLevels[] = [];
  for (const mane of MANE_LEVEL.slice(1)) for (const tail of TAIL_LEVEL.slice(1)) for (const thick of [false, true]) styles.push({ mane, tail, thick });
  for (let f = 0; f < frames; f++) {
    const base = f * fw * fh;
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      for (const lv of styles) {
        seen.fill(0);
        const shows = (i: number) => {
          const b = out[base + i]!;
          return b !== 0 && hairShows(b, lv);
        };
        // flood from the painted horse (and rider) through the hair this style shows
        for (let i = 0; i < fw * fh; i++) {
          if (grid.role(f, i % fw, (i / fw) | 0) === 0) continue;
          seen[i] = 1;
          stack.push(i);
        }
        while (stack.length) {
          const p = stack.pop()!;
          const px = p % fw;
          const py = (p / fw) | 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const qx = px + dx;
              const qy = py + dy;
              if (qx < 0 || qy < 0 || qx >= fw || qy >= fh) continue;
              const q = qy * fw + qx;
              if (seen[q] || !shows(q)) continue;
              seen[q] = 1;
              stack.push(q);
            }
        }
        for (let i = 0; i < fw * fh; i++) {
          if (seen[i] || !shows(i)) continue;
          const b = out[base + i]!;
          const tail = (b & 128) !== 0;
          const lvl = b & 15;
          const need = tail ? lv.tail : lv.mane;
          // not joined for this style: a fine horse loses it (thick hair keeps it), else it shows
          // only from the next level up
          if (!lv.thick && !(b & 64)) out[base + i] = b | 64;
          else if (need < 15 && lvl <= need) out[base + i] = (b & ~15) | (need + 1);
          else out[base + i] = 0;
          changed = true;
        }
      }
      if (!changed) break;
    }
  }
}

/** The mane key (packed rgb) of a hair shade (2 bits), as the long hair picks it. */
export function hairKey(mane: readonly number[], shade: number): number {
  const t = HAIR_SHADES[shade & 3]!;
  return mane[Math.min(mane.length - 1, Math.max(Math.min(1, mane.length - 1), Math.round(t * (mane.length - 1))))]!;
}
