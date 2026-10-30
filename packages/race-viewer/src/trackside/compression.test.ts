/**
 * Trackside "honest compression": the whole-field shot zooms out further, squeezes only the
 * big gaps when it still must, and marks every squeezed gap with its true length; the
 * running order on screen is always the true one. Real-race spreads come from
 * fixtures/field-spreads.json (mid-race snapshots from the racing engine).
 */
import { describe, expect, it } from "vitest";
import { HORSE_LENGTH_MM } from "@thoroughbred/shared";
import { fakeReplay } from "../dev/fakeReplay";
import { createReplaySampler } from "../sampleReplay";
import { lengthsLabel } from "../timeline";
import spreads from "./fixtures/field-spreads.json";
import {
  LENGTH_M,
  MARK_HIDDEN_L,
  MARK_SQUEEZE,
  TracksideCamera,
  cameraTarget,
  gallopMetrics,
  gapLabel,
  gapMarkerStrength,
  placeField,
  safeInsets,
  sizeLimits,
  squeezeGaps,
  type CameraRunner,
  type FieldLayout,
} from "./layout";

const sprite = gallopMetrics();
const RAIL = 15.8;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stage sizes the race page produces (16:9, at least 320 px tall). */
const stageH = (W: number) => Math.max(320, Math.round((W * 9) / 16));
const WIDTHS = [360, 390, 768, 1440, 1920];
const DIST = ["1000", "1600", "2400", "3200"] as const;
const samples = spreads.samples as Record<(typeof DIST)[number], { x: number[]; lane: number[] }[]>;

/** Steady-state whole-field shot of a field (the eased camera at rest on its target). */
function shot(W: number, runners: CameraRunner[], dpr = 2): FieldLayout {
  const H = stageH(W);
  const cam = new TracksideCamera();
  cam.update({ W, H, dpr, sprite, runners, railLane: RAIL, finishX: 1e6 }, 0, true);
  return placeField({ W, H, ppm: cam.ppm, cx: cam.cx, sprite, runners, railLane: RAIL, laneSpan: cam.laneSpan });
}

/** The same shot with the pre-fix minimum horse size (min(180, max(84, 14 % of W)), crowded fallback). */
function oldShot(W: number, runners: CameraRunner[]): FieldLayout {
  const H = stageH(W);
  const t = cameraTarget({ W, H, dpr: 2, sprite, runners, railLane: RAIL, finishX: 1e6 });
  const cur = sizeLimits(W, runners.length).minLen / sprite.lenM;
  const crowd = sizeLimits(W, runners.length).minLen / Math.min(120, Math.max(56, W * 0.14 * (2 / 3)));
  const oldMin = (Math.max(44, Math.round(Math.min(180, Math.max(84, W * 0.14)) * crowd)) / sprite.lenM) * 0.999;
  let ppm = t.ppm;
  let cx = t.cx;
  if (ppm <= cur * 1.0001 && oldMin > ppm) {
    // Clamped at the minimum: re-frame like cameraTarget does (leaders kept, tail squeezed).
    ppm = oldMin;
    let xmax = -Infinity;
    let xmin = Infinity;
    for (const r of runners) {
      xmax = Math.max(xmax, r.x);
      xmin = Math.min(xmin, r.x);
    }
    const availW = W - 2 * Math.max(6, Math.round(W * 0.02));
    const boxR = xmax + sprite.noseM;
    const boxL = xmin - sprite.tailM;
    const half = availW / 2 / ppm;
    cx = boxR - boxL > 2 * half ? boxR - half : (boxL + boxR) / 2;
  }
  return placeField({ W, H, ppm, cx, sprite, runners, railLane: RAIL, laneSpan: t.laneSpan });
}

const fieldOf = (s: { x: number[]; lane: number[] }): CameraRunner[] => s.x.map((x, i) => ({ x: 2000 + x, lane: s.lane[i]!, speed: 16 }));

/** Whole-spread squeeze of a shot: true leader-to-last distance / drawn distance (1 = true scale). */
function squeezeRatio(f: FieldLayout, runners: CameraRunner[]): number {
  const xs = runners.map((r) => r.x);
  const ax = f.placed.map((p) => p.ax);
  const drawn = Math.max(...ax) - Math.min(...ax);
  return ((Math.max(...xs) - Math.min(...xs)) * f.ppm) / Math.max(1, drawn);
}

const median = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)]!;

describe("wider whole-field shot", () => {
  it("lowers the minimum readable horse by about a third (desktop 120 px, phones 56 px), close-up untouched", () => {
    expect(sizeLimits(360).minLen).toBe(56);
    expect(sizeLimits(390).minLen).toBe(56);
    expect(sizeLimits(768).minLen).toBeCloseTo(768 * 0.14 * (2 / 3), 0);
    expect(sizeLimits(1440).minLen).toBe(120);
    expect(sizeLimits(1920).minLen).toBe(120);
    // Big fields on a phone still fall back a little (never below 44 px).
    expect(sizeLimits(390, 12).minLen).toBe(44);
    // Close-up / follow sizes are unchanged.
    for (const W of WIDTHS) expect(sizeLimits(W).maxLen).toBe(Math.min(520, W * 0.34));
  });

  it("keeps the pixel art at >= ~0.5 CSS px per source texel (>= 1 device px on HiDPI)", () => {
    for (const W of WIDTHS) {
      const texel = sizeLimits(W, 14).minLen / (sprite.lenM * 96);
      expect(texel).toBeGreaterThanOrEqual(W < 560 ? 0.19 : 0.29);
      // on the phone's 3x / desktop's 2x screens that is at least one device px per LOD-4 texel
      expect(texel * (W < 560 ? 3 : 2) * 4).toBeGreaterThanOrEqual(1);
    }
  });

  it("real-race spreads: fewer races need squeezing and the squeeze is far milder", () => {
    const rows: string[] = [];
    for (const W of [390, 1440]) {
      for (const d of DIST) {
        let oldN = 0;
        let newN = 0;
        const oldR: number[] = [];
        const newR: number[] = [];
        for (const s of samples[d]) {
          const runners = fieldOf(s);
          const o = oldShot(W, runners);
          const nw = shot(W, runners);
          if (o.gaps.some((g) => g.strength > 0)) oldN++;
          if (nw.gaps.some((g) => g.strength > 0)) newN++;
          oldR.push(squeezeRatio(o, runners));
          newR.push(squeezeRatio(nw, runners));
        }
        const n = samples[d].length;
        rows.push(`${W}px ${d}m squeezed ${Math.round((100 * oldN) / n)}% -> ${Math.round((100 * newN) / n)}%, median ratio ${median(oldR).toFixed(2)} -> ${median(newR).toFixed(2)}`);
        expect(newN).toBeLessThanOrEqual(oldN);
        expect(median(newR)).toBeLessThanOrEqual(median(oldR) + 1e-9);
        if (median(oldR) > 1.5) expect(median(newR)).toBeLessThan(median(oldR) * 0.8);
      }
    }
    // Desktop: a typical mile is now shown (nearly) true to scale; sprints always are.
    const desk = (d: (typeof DIST)[number]) => samples[d].filter((s) => shot(1440, fieldOf(s)).gaps.some((g) => g.strength > 0)).length / samples[d].length;
    expect(desk("1000")).toBeLessThanOrEqual(0.1);
    expect(desk("1600")).toBeLessThan(0.75);
    console.log(rows.join("\n"));
  }, 30_000);
});

describe("squeezeGaps (big gaps first)", () => {
  it("fills the span exactly, keeps small gaps true and never draws a bigger gap smaller", () => {
    const r = rng(3);
    for (let k = 0; k < 2000; k++) {
      const n = 2 + Math.floor(r() * 14);
      const g = Array.from({ length: n }, () => (r() < 0.6 ? r() * 30 : r() * 400));
      const total = g.reduce((a, b) => a + b, 0);
      const span = total * (0.05 + r() * 0.9);
      const d = squeezeGaps(g, span);
      expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(span, 3);
      for (let i = 0; i < n; i++) {
        expect(d[i]!).toBeLessThanOrEqual(g[i]! + 1e-9);
        for (let j = 0; j < n; j++) if (g[i]! > g[j]!) expect(d[i]!).toBeGreaterThanOrEqual(d[j]! - 1e-6);
      }
      // Big gaps first: any squeezed gap is at least as long as every gap kept true.
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) if (d[i]! < g[i]! - 1e-6 && Math.abs(d[j]! - g[j]!) < 1e-9) expect(g[i]!).toBeGreaterThanOrEqual(g[j]! - 1e-6);
    }
  });

  it("is the identity when everything fits, and continuous (no popping)", () => {
    expect(squeezeGaps([10, 20, 30], 100)).toEqual([10, 20, 30]);
    const g = [4, 9, 60, 2, 150, 7];
    let prev = squeezeGaps(g, 150);
    for (let s = 150; s > 20; s -= 0.25) {
      const d = squeezeGaps(g, s);
      for (let i = 0; i < g.length; i++) expect(Math.abs(d[i]! - prev[i]!)).toBeLessThan(0.3);
      prev = d;
    }
  });
});

describe("gap markers", () => {
  it("appear exactly in the squeezed gaps, with the true length in the standings' units", () => {
    const r = rng(11);
    let marked = 0;
    for (let k = 0; k < 600; k++) {
      const W = WIDTHS[k % WIDTHS.length]!;
      const n = [6, 10, 14][k % 3]!;
      let x = 3000;
      const runners: CameraRunner[] = Array.from({ length: n }, () => {
        x -= r() < 0.25 ? 3 + r() * 25 : r() * 2.5;
        return { x, lane: r() * (n - 1), speed: 16 };
      });
      const f = shot(W, runners);
      expect(f.gaps.length).toBe(n - 1);
      for (const g of f.gaps) {
        // true gap from the runners themselves
        expect(g.trueM).toBeCloseTo(runners[g.ahead]!.x - runners[g.behind]!.x, 9);
        expect(g.trueM).toBeGreaterThanOrEqual(0);
        // drawn vs linear-camera length, recomputed from the placed runners
        const a = f.placed[g.behind]!;
        const b = f.placed[g.ahead]!;
        const lin = (i: number) => f.W / 2 + (runners[i]!.x - f.cx) * f.ppm * f.placed[i]!.ls;
        const truePx = Math.max(0, lin(g.ahead) - lin(g.behind));
        const drawnPx = b.ax - a.ax;
        if (truePx > 1e-6) expect(g.squeeze).toBeCloseTo(Math.min(1, drawnPx / truePx), 6);
        const squeezed = g.squeeze < MARK_SQUEEZE && (g.trueM * (1 - g.squeeze)) / LENGTH_M > MARK_HIDDEN_L;
        expect(g.strength > 0).toBe(squeezed);
        if (g.strength > 0) {
          marked++;
          expect(f.compressed).toBe(true);
          // "8L": same rounding as the top bar's "+8L"
          expect(`+${gapLabel(g.trueM)}`).toBe(lengthsLabel(g.trueM * 1000));
          expect(gapLabel(g.trueM)).toMatch(/^\d+(\.5)?L$/);
          // the marker sits between the trailing runner's nose and the leading runner's tail
          expect(g.x).toBeGreaterThanOrEqual(a.ax - 1e-6);
          expect(g.x).toBeLessThanOrEqual(Math.max(a.ax, b.rect.x) + 1e-6);
        }
      }
      if (!f.compressed) expect(f.gaps.every((g) => g.strength === 0)).toBe(true);
    }
    expect(marked).toBeGreaterThan(100);
  });

  it("use the shared horse length", () => {
    expect(LENGTH_M).toBe(HORSE_LENGTH_MM / 1000);
    expect(gapLabel(8 * LENGTH_M)).toBe("8L");
    expect(gapLabel(4.5 * LENGTH_M)).toBe("4.5L");
    expect(gapLabel(23.2 * LENGTH_M)).toBe("23L");
  });

  it("strength is continuous: it fades in as the squeeze starts and out as it stops", () => {
    expect(gapMarkerStrength(20, 1)).toBe(0);
    expect(gapMarkerStrength(20, MARK_SQUEEZE)).toBe(0);
    expect(gapMarkerStrength(20, 0.3)).toBe(1);
    expect(gapMarkerStrength(1, 0.1)).toBe(0); // under a length hidden: bunched horses never get a chip
    let prev = 0;
    for (let s = 1; s >= 0; s -= 0.005) {
      const v = gapMarkerStrength(12, s);
      expect(Math.abs(v - prev)).toBeLessThan(0.06);
      prev = v;
    }
  });

  it("follow mine is true to scale: no squeeze, no markers", () => {
    const runners = Array.from({ length: 12 }, (_, i) => ({ x: 1000 - i * i * 1.5, lane: i % 4 }));
    const f = placeField({ W: 390, H: 320, ppm: 30, cx: 990, sprite, runners, railLane: RAIL, follow: 3 });
    expect(f.gaps.every((g) => g.squeeze === 1 && g.strength === 0)).toBe(true);
  });

  it("ease through a strung-out replay without flicker (strength moves a little per frame)", () => {
    const rep = fakeReplay({ horses: 12, distanceM: 2400, seed: 7 });
    const sample = createReplaySampler(rep);
    for (const W of [390, 1440]) {
      const H = stageH(W);
      const cam = new TracksideCamera();
      let s = sample(0, []);
      const prev = new Map<number, number>();
      let worst = 0;
      let seen = 0;
      for (let f = 0; f < 60 * 150; f += 1) {
        const t = f / 60;
        s = sample(t, s);
        const runners = s.map((h) => ({ x: h.x / 1000, lane: h.lane, speed: h.speed / 1000 }));
        cam.update({ W, H, dpr: 2, sprite, runners, railLane: RAIL, finishX: 2400 }, 1 / 60, f === 0);
        const lay = placeField({ W, H, ppm: cam.ppm, cx: cam.cx, sprite, runners, railLane: RAIL, laneSpan: cam.laneSpan });
        const now = new Map(lay.gaps.map((g) => [g.ahead * 100 + g.behind, g.strength]));
        for (const [k, v] of now) {
          if (prev.has(k)) worst = Math.max(worst, Math.abs(v - prev.get(k)!));
          if (v > 0) seen++;
        }
        prev.clear();
        for (const [k, v] of now) prev.set(k, v);
      }
      expect(seen).toBeGreaterThan(1000);
      // the scene eases on top of this (GAP_FADE_S); the target itself never jumps
      expect(worst).toBeLessThan(0.25);
    }
  });
});

describe("running order and the whole-field guarantee", () => {
  it("draws runners in their true running order (as the standings, strip and map show), even across lanes", () => {
    const r = rng(5);
    for (let k = 0; k < 3000; k++) {
      const W = WIDTHS[k % WIDTHS.length]!;
      const H = stageH(W);
      const n = 2 + Math.floor(r() * 13);
      const base = 500 + r() * 1500;
      const spread = r() < 0.4 ? r() * 3 : r() * 120;
      // near-level runners in very different lanes, camera anywhere: perspective alone would swap some
      const runners = Array.from({ length: n }, () => ({ x: base + r() * spread, lane: r() * 14 }));
      const cx = base + (r() - 0.5) * (spread + 40);
      const ppm = 8 + r() * 200;
      const f = placeField({ W, H, ppm, cx, sprite, runners, railLane: RAIL });
      const order = runners.map((_, i) => i).sort((a, b) => runners[a]!.x - runners[b]!.x);
      for (let j = 1; j < n; j++) {
        const behind = order[j - 1]!;
        const ahead = order[j]!;
        if (runners[ahead]!.x > runners[behind]!.x) expect(f.placed[ahead]!.ax, `k=${k}`).toBeGreaterThanOrEqual(f.placed[behind]!.ax - 1e-6);
      }
    }
  });

  it("keeps every runner inside the HUD-safe band at 360/390/768/1440/1920 px with 6, 10 and 14 runners", () => {
    const r = rng(8);
    for (const W of WIDTHS) {
      const H = stageH(W);
      const ins = safeInsets(W, H);
      for (const n of [6, 10, 14]) {
        // real spreads (scaled to the field size) plus random strung-out fields, eased camera
        const pool = [...samples["3200"], ...samples["2400"]].filter((s) => s.x.length >= 6);
        for (let k = 0; k < 12; k++) {
          const src = pool[k % pool.length]!;
          const extra = r() * 3;
          const runners: CameraRunner[] = Array.from({ length: n }, (_, i) => ({
            x: 2000 + (src.x[i % src.x.length]! - (i >= src.x.length ? 5 + r() * 40 : 0)) * (1 + extra),
            lane: (i * 1.3) % 14,
            speed: 16 + r(),
          }));
          const cam = new TracksideCamera();
          for (let f = 0; f < 45; f++) {
            for (const q of runners) q.x += q.speed / 60;
            cam.update({ W, H, dpr: 2, sprite, runners, railLane: RAIL, finishX: 1e6 }, 1 / 60, f === 0);
            const lay = placeField({ W, H, ppm: cam.ppm, cx: cam.cx, sprite, runners, railLane: RAIL, laneSpan: cam.laneSpan });
            for (const p of lay.placed) {
              const msg = `W=${W} n=${n} k=${k} f=${f} ${JSON.stringify(p.rect)}`;
              expect(p.rect.x, msg).toBeGreaterThanOrEqual(ins.l - 0.01);
              expect(p.rect.x + p.rect.w, msg).toBeLessThanOrEqual(W - ins.r + 0.01);
              expect(p.rect.y, msg).toBeGreaterThanOrEqual(ins.t - 0.01);
              expect(p.rect.y + p.rect.h, msg).toBeLessThanOrEqual(H - ins.b + 0.01);
            }
          }
        }
      }
    }
  }, 60_000);
});
