/**
 * Coat geometry of a keyed horse strip (pure maths, no DOM): where every texel sits on the
 * horse, so a coat pattern drawn once (coatLayers.ts) lands on the same place of the horse in
 * every frame of every animation and every view.
 *
 * Input is a role grid: per texel 0 empty, 1 coat, 2 points (lower legs, muzzle), 3 mane or
 * tail, 4 other opaque (tack, saddle cloth, rider, ink), 5 the rider's cap. Every strip faces
 * right. Per frame:
 *   - the back line (the exposed top of the horse, interpolated under the saddle and the
 *     rider, smoothed), the belly line and the barrel depth H (the strip's median);
 *   - the rump edge (the trunk's left edge at mid barrel), the body-space origin;
 *   - the face (top run of the columns right of the shoulder, its outline up to the ears),
 *     the legs (bottom runs dropping below the belly, near and far per pair), the mane and the
 *     tail (role 3 right and left of the trunk), and the body (every other coat texel).
 *
 * Spaces (all lengths in texels; divide by `H` for horse-relative units):
 *   - body:  u = x - rumpX (toward the head), v = y - backLine(x) (depth under the top line);
 *   - face:  t = 0 brow .. 1 nose, e = texels in from the profile edge;
 *   - leg:   g = 0 hoof .. 1 where the leg meets the belly, s = x - the leg's centre that row;
 *   - tail:  a = 0 root .. 1 tip along the tail, l = signed texels off the tail's axis.
 * Hair candidates (empty texels where long hair may grow: behind and around the lower legs,
 * past the tail) carry the geometry of the leg / tail they belong to and the `outside` flag.
 */

export const GEO_REGION = { none: 0, frontNear: 1, frontFar: 2, hindNear: 3, hindFar: 4, face: 5, body: 6, mane: 7, tail: 8 } as const;
export type GeoRegion = (typeof GEO_REGION)[keyof typeof GEO_REGION];

export interface RoleGrid {
  frames: number;
  fw: number;
  fh: number;
  /** Role of a frame-local texel: 0 empty, 1 coat, 2 points, 3 mane/tail, 4 other opaque, 5 cap. */
  role(frame: number, x: number, y: number): number;
}

/** Per-texel geometry, frame-local layout `frame * fw * fh + y * fw + x`. */
export interface CoatGeometry {
  frames: number;
  fw: number;
  fh: number;
  /** Strip barrel depth (median over frames), texels. */
  H: number;
  region: Uint8Array;
  /** 1 = empty texel that is a hair candidate (leg feather, long tail). */
  outside: Uint8Array;
  /** leg g / face t / tail a (0..1, tail up to 1.6); body: unused (0). */
  p1: Float32Array;
  /** leg s / face e / tail l (texels). */
  p2: Float32Array;
  /** body space (every region): texels from the rump edge, and under the back line. */
  u: Float32Array;
  v: Float32Array;
  /** For hair candidates and leg texels: the frame-local index of the leg texel whose colour long hair takes (-1 none). */
  src: Int32Array;
  /** Per frame: rump x, back line at the rump, belly y (diagnostics and tests). */
  anchors: { rumpX: number; back: number; belly: number }[];
}

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)]!;
};

/** Build the coat geometry of a strip (see the module comment). */
export function buildCoatGeometry(grid: RoleGrid): CoatGeometry {
  const { frames, fw, fh } = grid;
  const n = frames * fw * fh;
  const region = new Uint8Array(n);
  const outside = new Uint8Array(n);
  const p1 = new Float32Array(n);
  const p2 = new Float32Array(n);
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const src = new Int32Array(n).fill(-1);
  const anchors: CoatGeometry["anchors"] = [];
  // The rider: coat- or mane-keyed texels that belong to the jockey (the face under the cap,
  // the hands on the reins) are small patches cut off from the horse. Per frame: patches in the
  // window under and in front of the cap (role 5), and any small coat patch above the horse's top.
  const rider = new Uint8Array(n);
  for (let f = 0; f < frames; f++) {
    let cx0 = fw, cy0 = fh, cx1 = -1, cy1 = -1;
    let topY = fh;
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        const r = grid.role(f, x, y);
        if (r === 5) {
          cx0 = Math.min(cx0, x);
          cx1 = Math.max(cx1, x);
          cy0 = Math.min(cy0, y);
          cy1 = Math.max(cy1, y);
        }
      }
    if (cx1 < 0) continue;
    const capW = cx1 - cx0 + 1;
    const wx0 = Math.max(0, cx0 - 2);
    const wx1 = Math.min(fw - 1, cx1 + Math.max(4, Math.round(capW * 0.35)));
    const wy1 = Math.min(fh - 1, cy1 + Math.max(8, Math.round(capW * 0.9)));
    void topY;
    const seen = new Uint8Array(fw * fh);
    for (let y0 = 0; y0 < fh; y0++)
      for (let x0 = 0; x0 < fw; x0++) {
        const r0 = grid.role(f, x0, y0);
        if (seen[y0 * fw + x0] || r0 < 1 || r0 > 3) continue;
        const patch: number[] = [];
        const stack = [x0, y0];
        seen[y0 * fw + x0] = 1;
        let minY = fh;
        while (stack.length) {
          const py = stack.pop()!;
          const px = stack.pop()!;
          patch.push(py * fw + px);
          minY = Math.min(minY, py);
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const qx = px + dx;
              const qy = py + dy;
              if (qx < 0 || qy < 0 || qx >= fw || qy >= fh || seen[qy * fw + qx]) continue;
              const rq = grid.role(f, qx, qy);
              if (rq < 1 || rq > 3) continue;
              seen[qy * fw + qx] = 1;
              stack.push(qx, qy);
            }
        }
        const inWin = patch.every((k) => {
          const x = k % fw;
          const y = Math.floor(k / fw);
          return x >= wx0 && x < wx1 && y >= cy0 && y < wy1;
        });
        const small = patch.length <= Math.max(40, capW * 6);
        // a small patch whose top is level with the cap's bottom or higher: the rider's hands or face
        if (small && (inWin || minY <= wy1)) for (const k of patch) rider[f * fw * fh + k] = 1;
      }
  }
  const horse = (f: number, x: number, y: number) => {
    if (rider[(f * fh + y) * fw + x]) return 0;
    const r = grid.role(f, x, y);
    return r >= 1 && r <= 3 ? r : 0;
  };

  // pass 1: per-frame lines, the strip's barrel depth
  interface Frame {
    runs: [number, number][][];
    x0: number;
    x1: number;
    back: number;
    belly: number;
  }
  const fr: Frame[] = [];
  for (let f = 0; f < frames; f++) {
    const runs: [number, number][][] = [];
    let x0 = -1;
    let x1 = -1;
    for (let x = 0; x < fw; x++) {
      const col: [number, number][] = [];
      let top = -1;
      let prev = -9;
      for (let y = 0; y < fh; y++) {
        if (!horse(f, x, y)) continue;
        if (top < 0 || y - prev >= 3) {
          if (top >= 0) col.push([top, prev]);
          top = y;
        }
        prev = y;
      }
      if (top >= 0) col.push([top, prev]);
      runs.push(col);
      if (col.length) {
        if (x0 < 0) x0 = x;
        x1 = x;
      }
    }
    const W = x1 - x0;
    const bots: number[] = [];
    const tops: number[] = [];
    for (let x = x0; x0 >= 0 && x <= x1; x++) {
      const col = runs[x]!;
      if (!col.length) continue;
      bots.push(col[col.length - 1]![1]);
      if (x > x0 + W * 0.2 && x < x0 + W * 0.55) tops.push(col[0]![0]);
    }
    const back = median(tops);
    let belly = median(bots);
    // the belly line between the legs: the bottom of the top run of the middle columns (a low
    // quantile, so legs gathered under the body or a grazing head cannot pull it down)
    if (x0 >= 0 && W >= 24) {
      const mids: number[] = [];
      for (let x = Math.round(x0 + W * 0.25); x <= Math.round(x0 + W * 0.7); x++) {
        const col = runs[x]!;
        if (col.length && col[0]![1] > back + 8) mids.push(col[0]![1]);
      }
      mids.sort((a, b) => a - b);
      const q = mids.length ? mids[Math.floor(mids.length * 0.3)]! : belly;
      if (q < belly) belly = q;
    }
    fr.push({ runs, x0, x1, back, belly });
  }
  const H = Math.max(8, median(fr.filter((q) => q.x0 >= 0 && q.x1 - q.x0 >= 24).map((q) => q.belly - q.back)));

  // rump edge per frame: the trunk's left edge (coat texels) through mid barrel; a frame whose
  // edge jumps (a leg or the neck read as the trunk) takes its neighbours' value
  const rawRump: number[] = fr.map((q, f) => {
    if (q.x0 < 0) return Number.NaN;
    const lefts: number[] = [];
    for (let y = Math.round(q.back + H * 0.3); y <= Math.round(q.back + H * 0.75); y++) {
      let best = -1;
      let bestLen = 0;
      let run0 = -1;
      for (let x = q.x0; x <= q.x1 + 1; x++) {
        const r = x <= q.x1 ? grid.role(f, x, y) : 0;
        const on = r === 1 || r === 2;
        if (on && run0 < 0) run0 = x;
        if (!on && run0 >= 0) {
          if (x - run0 > bestLen) {
            bestLen = x - run0;
            best = run0;
          }
          run0 = -1;
        }
      }
      if (best >= 0 && bestLen > H * 0.8) lefts.push(best);
    }
    return lefts.length ? median(lefts) : Number.NaN;
  });
  const okRump = rawRump.filter((r) => !Number.isNaN(r));
  const stripRump = median(okRump);
  const rumpOf = (f: number): number => {
    const r = rawRump[f]!;
    if (!Number.isNaN(r) && Math.abs(r - stripRump) <= H * 0.45) return r;
    // nearest frames (cyclic) that agree with the strip
    for (let d = 1; d < frames; d++) {
      for (const k of [(f - d + frames) % frames, (f + d) % frames]) {
        const q = rawRump[k]!;
        if (!Number.isNaN(q) && Math.abs(q - stripRump) <= H * 0.45) return q;
      }
    }
    return Number.isNaN(stripRump) ? (fr[f]!.x0 + (fr[f]!.x1 - fr[f]!.x0) * 0.15) : stripRump;
  };

  for (let f = 0; f < frames; f++) {
    const { runs, x0, x1, back, belly } = fr[f]!;
    const base = f * fw * fh;
    const at = (x: number, y: number) => base + y * fw + x;
    if (x0 < 0 || x1 - x0 < 24) {
      anchors.push({ rumpX: 0, back: 0, belly: 0 });
      continue;
    }
    const W = x1 - x0;
    const split = x0 + W * 0.55;

    // ---- back line: exposed tops (nothing opaque right above), interpolated, smoothed ----
    const topAt = new Float32Array(fw).fill(Number.NaN);
    for (let x = x0; x <= x1; x++) {
      const col = runs[x]!;
      if (!col.length) continue;
      const t = col[0]![0];
      if (t > belly) continue; // a leg-only column (no trunk above it)
      // exposed: empty above, or only a thin outline (ink, up to 2 texels) and then empty
      let exposed = t === 0;
      for (let k = 1; k <= 3 && !exposed && t - k >= 0; k++) {
        const r = grid.role(f, x, t - k);
        if (r === 0 && !rider[(f * fh + t - k) * fw + x]) exposed = true;
        else if (r !== 4 || k === 3) break;
      }
      if (exposed) topAt[x] = t;
    }
    // interpolate occluded columns (saddle, rider, reins) between exposed neighbours
    const line = new Float32Array(fw);
    let last = -1;
    for (let x = 0; x < fw; x++) {
      if (!Number.isNaN(topAt[x]!)) {
        if (last >= 0 && x - last > 1) for (let k = last + 1; k < x; k++) line[k] = topAt[last]! + ((topAt[x]! - topAt[last]!) * (k - last)) / (x - last);
        else if (last < 0) for (let k = 0; k < x; k++) line[k] = topAt[x]!;
        line[x] = topAt[x]!;
        last = x;
      }
    }
    if (last < 0) line.fill(back);
    else for (let k = last + 1; k < fw; k++) line[k] = topAt[last]!;
    const backLine = new Float32Array(fw);
    for (let x = 0; x < fw; x++) {
      let s = 0;
      let c = 0;
      for (let k = Math.max(0, x - 2); k <= Math.min(fw - 1, x + 2); k++) {
        s += line[k]!;
        c++;
      }
      backLine[x] = s / c;
    }

    const rumpX = rumpOf(f);
    anchors.push({ rumpX, back, belly });

    const setBody = (i: number, x: number, y: number) => {
      u[i] = x - rumpX;
      v[i] = y - backLine[Math.min(fw - 1, Math.max(0, x))]!;
    };
    // every texel of the frame gets body coordinates (hair candidates and tack included)
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) setBody(at(x, y), x, y);

    // ---- face: top run of the columns right of the shoulder ----
    const headish = (x: number) => {
      const r = runs[x]?.[0];
      return !!r && x > split && r[0] <= back + 4 && r[1] <= belly + 16;
    };
    let hx1 = -1;
    for (let x = fw - 1; x > split; x--)
      if (headish(x)) {
        hx1 = x;
        break;
      }
    const headCols: number[] = [];
    // head down (grazing): the nose is the rightmost texel and sits below the belly line
    let nose = -1;
    for (let x = x1; x > split && nose < 0; x--) {
      const c = runs[x]!;
      if (c.length) nose = x;
    }
    const noseLow = nose >= 0 && runs[nose]![runs[nose]!.length - 1]![1] > belly + H * 0.3 && runs[nose]![0]![0] > back + H * 0.5;
    if (noseLow) {
      hx1 = nose;
      for (let x = nose; x >= Math.max(split, nose - H * 0.6); x--) if (runs[x]!.length) headCols.push(x);
    } else if (hx1 >= 0) {
      headCols.push(hx1);
      let gap = 0;
      for (let x = hx1 - 1; x > split + 4; x--) {
        if (!headish(x)) {
          if (++gap > 2) break;
          continue;
        }
        gap = 0;
        const r = runs[x]![0]!;
        if (r[1] > belly + 6) break;
        if (r[1] - r[0] >= Math.min(50, H * 0.78) && hx1 - x >= Math.max(8, H * 0.2)) break;
        headCols.push(x);
      }
    }
    // the head is about one barrel depth long: no neck columns past that, and no gaps (tack
    // and ink split a column's run; every column between the ends belongs to the head)
    if (!noseLow && headCols.length) {
      const left = Math.max(headCols[headCols.length - 1]!, Math.ceil(hx1 - H * 1.15));
      headCols.length = 0;
      for (let x = hx1; x >= left; x--) if (runs[x]?.length) headCols.push(x);
    }
    const hx0 = headCols.length ? headCols[headCols.length - 1]! : -1;
    let hy0 = fh;
    let hy1 = 0;
    const headTop = new Map<number, number>();
    for (const x of headCols) {
      const col = runs[x]!;
      const r: [number, number] = noseLow ? [Math.max(col[0]![0], Math.round(belly - H * 0.1)), col[col.length - 1]![1]] : col[0]!;
      headTop.set(x, r[0]);
      if (r[0] < hy0) hy0 = r[0];
      if (r[1] > hy1) hy1 = r[1];
    }
    if (hx0 >= 0 && hx1 - hx0 >= Math.min(10, H * 0.8) && hy1 - hy0 >= 12) {
      const hh = hy1 - hy0;
      const yBrow = hy0 + hh * 0.28;
      const yNose = hy0 + hh * 0.94;
      const colBot = new Map<number, number>();
      for (const x of headCols) colBot.set(x, noseLow ? runs[x]![runs[x]!.length - 1]![1] : Math.min(runs[x]![0]![1], Math.round(belly + 16)));
      const inHead = (x: number, y: number) => horse(f, x, y) !== 0 && y <= colBot.get(x)! && y >= headTop.get(x)!;
      for (let y = hy0; y <= hy1; y++) {
        let edge = -1;
        for (const x of headCols) if (inHead(x, y)) edge = Math.max(edge, x);
        if (edge < 0) continue;
        const t = Math.min(1, Math.max(0, (y - yBrow) / Math.max(1, yNose - yBrow)));
        for (const x of headCols) {
          if (x > edge || !inHead(x, y)) continue;
          const role = horse(f, x, y);
          const i = at(x, y);
          if (role === 3) {
            region[i] = GEO_REGION.mane; // forelock
            continue;
          }
          region[i] = GEO_REGION.face;
          p1[i] = t;
          p2[i] = edge - x;
        }
      }
    }

    // ---- legs: bottom runs dropping well below the belly ----
    interface Leg {
      cols: number[];
      area: number;
      centre: number;
      near: boolean;
    }
    const legCols: number[] = [];
    const isHeadCol = new Set(noseLow ? headCols : []);
    for (let x = x0; x <= x1; x++) {
      if (isHeadCol.has(x)) continue;
      const col = runs[x]!;
      if (!col.length) continue;
      const bot = col[col.length - 1]![1];
      if (bot < belly + 8) continue;
      let mass = 0;
      for (const [a, b] of col) mass += Math.max(0, b - Math.max(a, belly - 6) + 1);
      if (mass < 4) continue;
      legCols.push(x);
    }
    const legs: Leg[] = [];
    for (const x of legCols) {
      const lastLeg = legs[legs.length - 1];
      if (lastLeg && x - lastLeg.cols[lastLeg.cols.length - 1]! <= 3) lastLeg.cols.push(x);
      else legs.push({ cols: [x], area: 0, centre: x, near: false });
    }
    const grouped: Leg[] = [];
    for (const l of legs) {
      l.centre = (l.cols[0]! + l.cols[l.cols.length - 1]!) / 2;
      if (l.cols[0]! < split && l.cols[l.cols.length - 1]! > split) {
        const lo = l.cols.filter((x) => x < split);
        const hi = l.cols.filter((x) => x >= split);
        if (lo.length && hi.length) {
          grouped.push({ cols: lo, area: 0, centre: (lo[0]! + lo[lo.length - 1]!) / 2, near: false }, { cols: hi, area: 0, centre: (hi[0]! + hi[hi.length - 1]!) / 2, near: false });
          continue;
        }
      }
      grouped.push(l);
    }
    for (const l of grouped) l.area = l.cols.reduce((s, x) => s + (runs[x]!.length ? runs[x]![runs[x]!.length - 1]![1] - Math.min(runs[x]![runs[x]!.length - 1]![0], belly) : 0), 0);
    const assign = (group: Leg[]) => {
      group.sort((a, b) => b.area - a.area);
      group.forEach((l, i) => (l.near = i === 0));
    };
    assign(grouped.filter((l) => l.centre < split));
    assign(grouped.filter((l) => l.centre >= split));
    const effTop = belly - 6;
    const alongLeg = (cols: number[], reg: number) => {
      const top = Math.max(0, Math.round(effTop));
      const mine = (x: number, y: number) => x >= 0 && y >= 0 && x < fw && y < fh && region[at(x, y)] === reg && !outside[at(x, y)];
      // where the leg leaves the body: its texels on the top rows, under the barrel
      const dist = new Map<number, number>();
      let queue: number[] = [];
      for (const x of cols)
        for (let y = top; y <= top + 2; y++)
          if (mine(x, y)) {
            dist.set(at(x, y), 0);
            queue.push(at(x, y));
          }
      // a short "leg" that never reaches up to the belly is a scrap of the barrel's underside
      // (a longer one keeps its height down the column)
      if (!queue.length) {
        let y0 = fh;
        let y1 = -1;
        for (const x of cols)
          for (let y = top; y < fh; y++)
            if (mine(x, y)) {
              y0 = Math.min(y0, y);
              y1 = Math.max(y1, y);
            }
        if (y1 - y0 < H * 0.6) for (const x of cols) for (let y = top; y < fh; y++) if (mine(x, y)) p1[at(x, y)] = 1;
        return;
      }
      let d = 0;
      while (queue.length) {
        const next: number[] = [];
        d++;
        for (const i of queue) {
          const x = (i - base) % fw;
          const y = ((i - base) / fw) | 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              if (!mine(x + dx, y + dy)) continue;
              const q = at(x + dx, y + dy);
              if (dist.has(q)) continue;
              dist.set(q, d);
              next.push(q);
            }
        }
        queue = next;
      }
      const far = d - 1;
      // a "leg" this short is the barrel sagging below the belly line (under the girth, in a
      // bunched stride): all of it is the top of the leg, where no leg marking reaches
      if (far < H * 0.6) {
        for (const i of dist.keys()) p1[i] = 1;
        return;
      }
      for (const [i, k] of dist) p1[i] = Math.max(p1[i]!, 1 - k / far);
    };
    for (const l of grouped) {
      const reg = l.centre >= split ? (l.near ? GEO_REGION.frontNear : GEO_REGION.frontFar) : l.near ? GEO_REGION.hindNear : GEO_REGION.hindFar;
      // per row: the leg's extent (for s and for hair candidates)
      const rows = new Map<number, [number, number]>();
      let bot = 0;
      for (const x of l.cols) {
        const col = runs[x]!;
        bot = Math.max(bot, col[col.length - 1]![1]);
      }
      for (const x of l.cols) {
        const col = runs[x]!;
        const cb = col[col.length - 1]![1];
        for (let y = Math.max(0, Math.round(effTop)); y <= cb; y++) {
          const role = horse(f, x, y);
          if (role !== 1 && role !== 2) continue;
          const i = at(x, y);
          if (region[i]) continue; // face wins where a foreleg overlaps the head
          region[i] = reg;
          p1[i] = Math.min(1, Math.max(0, (cb - y) / Math.max(1, cb - effTop)));
          const r = rows.get(y);
          rows.set(y, r ? [Math.min(r[0], x), Math.max(r[1], x)] : [x, x]);
        }
      }
      // g down a column only holds for a leg that hangs upright: a leg reaching out flat or folded
      // under the chest has short columns up to the elbow or stifle, which would read as lower leg
      // (a stocking would whiten the forearm up to the belly). Along the leg from where it leaves
      // the body to its far end (the hoof) gives the leg's true height; a texel keeps the higher.
      alongLeg(l.cols, reg);
      for (const [y, [a, b]] of rows) {
        const c = (a + b) / 2;
        for (let x = a; x <= b; x++) {
          const i = at(x, y);
          if (region[i] !== reg) continue;
          p2[i] = x - c;
          src[i] = i;
        }
        // hair candidates: empty texels behind (left of) and in front of the lower leg
        const g = p1[at(Math.round(c) >= a && Math.round(c) <= b ? Math.round(c) : a, y)]!;
        // hair hangs from the back of a lower leg that stands or swings roughly upright (a leg
        // stretched out flat has wide rows: no curtain of hair along it)
        if (g > 0.45 || g < 0.04 || b - a > H * 0.4) continue;
        const reachBack = Math.max(3, Math.round(H * 0.24));
        const reachFront = Math.max(2, Math.round(H * 0.12));
        const srcI = at(Math.min(b, Math.max(a, Math.round(c))), y);
        for (let x = a - reachBack; x <= b + reachFront; x++) {
          if (x < 0 || x >= fw || (x >= a && x <= b)) continue;
          const i = at(x, y);
          if (grid.role(f, x, y) !== 0 || region[i]) continue;
          region[i] = reg;
          outside[i] = 1;
          p1[i] = g;
          p2[i] = x - c;
          src[i] = srcI;
        }
      }
      // below the hoof row nothing grows (the ground line stays where it is)
      void bot;
    }

    // ---- mane and tail (role 3); body (every other coat / points texel) ----
    // mane-keyed texels: the tail behind the rump, the mane over the neck; between them they
    // are tack or the rider's boots drawn in the dark keys (no region)
    const tailMax = rumpX + H * 0.4;
    const maneMin = rumpX + H * 1.6;
    const tailTex: [number, number][] = [];
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const i = at(x, y);
        if (region[i]) continue;
        const role = horse(f, x, y);
        if (role === 3) {
          if (x < tailMax) {
            region[i] = GEO_REGION.tail;
            tailTex.push([x, y]);
          } else if (x > maneMin) region[i] = GEO_REGION.mane;
        } else if (role === 1 || role === 2) region[i] = GEO_REGION.body;
      }
    }
    if (tailTex.length >= 4) {
      // root: the tail texel nearest the croup; tip: the farthest from the root
      const croup: [number, number] = [rumpX + H * 0.1, backLine[Math.max(0, Math.min(fw - 1, Math.round(rumpX)))]! + H * 0.15];
      let root = tailTex[0]!;
      let bestD = Infinity;
      for (const p of tailTex) {
        const d = (p[0] - croup[0]) ** 2 + (p[1] - croup[1]) ** 2;
        if (d < bestD) {
          bestD = d;
          root = p;
        }
      }
      let tip = root;
      bestD = -1;
      for (const p of tailTex) {
        const d = (p[0] - root[0]) ** 2 + (p[1] - root[1]) ** 2;
        if (d > bestD) {
          bestD = d;
          tip = p;
        }
      }
      const len = Math.max(1, Math.sqrt(bestD));
      const ax = (tip[0] - root[0]) / len;
      const ay = (tip[1] - root[1]) / len;
      const proj = (x: number, y: number): [number, number] => [((x - root[0]) * ax + (y - root[1]) * ay) / len, (x - root[0]) * -ay + (y - root[1]) * ax];
      for (const [x, y] of tailTex) {
        const i = at(x, y);
        const [a, l] = proj(x, y);
        p1[i] = a;
        p2[i] = l;
      }
      // hair candidates past the tip and along the sides (a long tail)
      const reach = len * 0.7;
      const side = Math.max(3, H * 0.28);
      const bx0 = Math.floor(Math.min(root[0], tip[0] + ax * reach) - side);
      const bx1 = Math.ceil(Math.max(root[0], tip[0] + ax * reach) + side);
      const by0 = Math.floor(Math.min(root[1], tip[1] + ay * reach) - side);
      const by1 = Math.ceil(Math.max(root[1], tip[1] + ay * reach) + side);
      // never below the ground line (the lowest hoof of the frame)
      let ground = 0;
      for (let x = 0; x < fw; x++) {
        const col = runs[x]!;
        if (col.length) ground = Math.max(ground, col[col.length - 1]![1]);
      }
      for (let y = Math.max(0, by0); y <= Math.min(ground, by1); y++) {
        for (let x = Math.max(0, bx0); x <= Math.min(fw - 1, bx1); x++) {
          const i = at(x, y);
          if (region[i] || grid.role(f, x, y) !== 0) continue;
          const [a, l] = proj(x, y);
          if (a < 0.05 || a > 1.7 || Math.abs(l) > side) continue;
          region[i] = GEO_REGION.tail;
          outside[i] = 1;
          p1[i] = a;
          p2[i] = l;
        }
      }
    }
  }
  return { frames, fw, fh, H, region, outside, p1, p2, u, v, src, anchors };
}

/** Role grid of a horizontal RGBA strip keyed with the race palette roles. */
export function rgbaRoleGrid(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  frameWidth: number,
  keys: { coat: readonly string[]; points?: readonly string[]; mane?: readonly string[]; hoof?: readonly string[]; cap?: readonly string[] },
): RoleGrid {
  const pack = (h: string) => Number.parseInt(h.slice(1), 16);
  const roles = new Map<number, number>();
  for (const h of keys.coat) roles.set(pack(h), 1);
  for (const h of keys.points ?? []) roles.set(pack(h), 2);
  for (const h of keys.hoof ?? []) roles.set(pack(h), 2);
  for (const h of keys.mane ?? []) roles.set(pack(h), 3);
  for (const h of keys.cap ?? []) roles.set(pack(h), 5);
  const frames = Math.max(1, Math.floor(width / frameWidth));
  return {
    frames,
    fw: frameWidth,
    fh: height,
    role(f, x, y) {
      const i = (y * width + f * frameWidth + x) * 4;
      if ((rgba[i + 3] ?? 0) < 128) return 0;
      return roles.get((rgba[i]! << 16) | (rgba[i + 1]! << 8) | rgba[i + 2]!) ?? 4;
    },
  };
}
