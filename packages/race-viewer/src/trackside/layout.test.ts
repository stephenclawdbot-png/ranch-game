import { describe, expect, it } from "vitest";
import {
  cameraTarget,
  crowding,
  FOLLOW_AT,
  followTarget,
  gallopMetrics,
  ladderBelow,
  placeField,
  safeInsets,
  sizeLimits,
  squeezeX,
  TracksideCamera,
  verticalFitPpm,
  ZOOM_LADDER,
  type CameraRunner,
  type RunnerPos,
} from "./layout";

const sprite = gallopMetrics();

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

function inside(W: number, H: number, rect: { x: number; y: number; w: number; h: number }) {
  return rect.x >= -0.01 && rect.y >= -0.01 && rect.x + rect.w <= W + 0.01 && rect.y + rect.h <= H + 0.01;
}

const STAGES: [number, number][] = [
  [1242, 698],
  [1440, 810],
  [390, 320],
  [360, 220],
  [768, 432],
];

describe("trackside placeField", () => {
  it("whole-field mode: keeps every runner inside the stage for any zoom, centre and spread", () => {
    const r = rng(42);
    for (let k = 0; k < 4000; k++) {
      const [W, H] = STAGES[k % STAGES.length]!;
      const n = 8 + Math.floor(r() * 5);
      const spread = r() < 0.3 ? r() * 4 : r() < 0.7 ? r() * 40 : r() * 400;
      const base = r() * 2000;
      const runners: RunnerPos[] = Array.from({ length: n }, () => ({ x: base + r() * spread, lane: r() < 0.1 ? -0.4 : r() * 12 }));
      // A lagging camera: anywhere near (or far from) the field, any zoom.
      const cx = base + (r() - 0.3) * spread * 2 + (r() - 0.5) * 30;
      const ppm = 5 + r() * 400;
      const f = placeField({ W, H, ppm, cx, sprite, runners, railLane: 12.8 });
      for (const p of f.placed) {
        expect(inside(W, H, p.rect), `stage ${W}x${H} k=${k} rect ${JSON.stringify(p.rect)}`).toBe(true);
        // and inside the HUD-safe band (centre at least)
        expect(p.rect.y + p.rect.h).toBeLessThanOrEqual(H - f.insets.b + 0.01);
        expect(p.rect.y).toBeGreaterThanOrEqual(f.insets.t - 0.01);
      }
    }
  });

  it("is the identity camera mapping when the field fits (no compression, no shift)", () => {
    const runners = [
      { x: 100, lane: 0 },
      { x: 102, lane: 1 },
      { x: 104, lane: 2 },
    ];
    const f = placeField({ W: 1242, H: 698, ppm: 60, cx: 101, sprite, runners, railLane: 12.8 });
    expect(f.compressed).toBe(false);
    for (const p of f.placed) expect(Math.abs(p.shift)).toBeLessThan(1e-9);
  });

  it("keeps the running order on screen when compressing (no overtaking by projection)", () => {
    const runners = Array.from({ length: 12 }, (_, i) => ({ x: 1000 - i * i * 1.5, lane: i % 4 }));
    const f = placeField({ W: 390, H: 320, ppm: 30, cx: 990, sprite, runners, railLane: 12.8 });
    expect(f.compressed).toBe(true);
    for (let i = 1; i < 12; i++) expect(f.placed[i]!.ax).toBeLessThanOrEqual(f.placed[i - 1]!.ax + 1e-6);
  });

  it("maps the winning post through the same squeeze: a runner on the line is drawn on the line", () => {
    const r = rng(9);
    for (let k = 0; k < 300; k++) {
      const runners = Array.from({ length: 10 }, () => ({ x: 1200 - r() * 60, lane: 0 }));
      runners[k % 10]!.x = 1200;
      const f = placeField({ W: 390, H: 320, ppm: 40, cx: 1180, sprite, runners, railLane: 12.8 });
      const post = squeezeX(f, 390 / 2 + (1200 - 1180) * f.ppm);
      expect(Math.abs(post - f.placed[k % 10]!.ax)).toBeLessThan(0.5);
    }
  });

  it("draws far lanes smaller and higher", () => {
    const f = placeField({ W: 1242, H: 698, ppm: 80, cx: 10, sprite, runners: [{ x: 10, lane: 0 }, { x: 10, lane: 8 }], railLane: 12.8 });
    expect(f.placed[1]!.ls).toBeLessThan(f.placed[0]!.ls);
    expect(f.placed[1]!.feetY).toBeLessThan(f.placed[0]!.feetY);
  });
});

describe("trackside crowding (big fields on phone-sized stages)", () => {
  type Rect = { x: number; y: number; w: number; h: number };

  /** Fraction of r NOT covered by the union of the rects drawn in front of it. */
  function visibleFrac(r: Rect, front: Rect[]): number {
    const isect: Rect[] = [];
    for (const q of front) {
      const x0 = Math.max(r.x, q.x);
      const x1 = Math.min(r.x + r.w, q.x + q.w);
      const y0 = Math.max(r.y, q.y);
      const y1 = Math.min(r.y + r.h, q.y + q.h);
      if (x1 > x0 && y1 > y0) isect.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    if (!isect.length) return 1;
    const xs = [...new Set(isect.flatMap((i) => [i.x, i.x + i.w]))].sort((a, b) => a - b);
    let covered = 0;
    for (let k = 0; k < xs.length - 1; k++) {
      const a = xs[k]!;
      const b = xs[k + 1]!;
      const spans = isect
        .filter((i) => i.x <= a && i.x + i.w >= b)
        .map((i) => [i.y, i.y + i.h] as const)
        .sort((p, q) => p[0] - q[0]);
      let y = 0;
      let cur = -Infinity;
      let start = -Infinity;
      for (const [y0, y1] of spans) {
        if (y0 > cur) {
          if (cur > start) y += cur - start;
          start = y0;
          cur = y1;
        } else cur = Math.max(cur, y1);
      }
      if (cur > start) y += cur - start;
      covered += (b - a) * y;
    }
    return 1 - covered / (r.w * r.h);
  }

  it("only kicks in for big fields on narrow stages (desktop and small fields untouched)", () => {
    expect(crowding(390, 12)).toBe(1);
    expect(crowding(390, 6)).toBe(0);
    expect(crowding(768, 12)).toBe(0);
    expect(crowding(1440, 12)).toBe(0);
    expect(crowding(360, 9)).toBeCloseTo(0.25, 6);
  });

  it("keeps 12 stacked runners readable at 390px: every quad stays >=40% uncovered in draw order", () => {
    const W = 390;
    const H = 320;
    // Worst case: the whole field bunched on the same x, spread over every lane.
    const runners: RunnerPos[] = Array.from({ length: 12 }, (_, i) => ({ x: 500 + (i % 3) * 0.8, lane: i }));
    const f = placeField({ W, H, ppm: 60, cx: 500, sprite, runners, railLane: 12.8 });
    expect(crowding(W, runners.length)).toBe(1);
    // Render order: far lane first; on one lane the trailing runner first.
    const order = f.placed
      .map((p, i) => ({ p, i }))
      .sort((a, b) => a.p.ls - b.p.ls || a.p.rect.x - b.p.rect.x)
      .map((o) => o.p.rect);
    let worst = 1;
    for (let j = 0; j < order.length; j++) {
      expect(inside(W, H, order[j]!)).toBe(true);
      worst = Math.min(worst, visibleFrac(order[j]!, order.slice(j + 1)));
    }
    expect(worst).toBeGreaterThanOrEqual(0.4);
  });
});

describe("trackside camera", () => {
  it("ladder holds exact m/s pixel scales", () => {
    expect(ZOOM_LADDER).toContain(1);
    expect(ZOOM_LADDER).toContain(0.5);
    expect(ZOOM_LADDER.some((v) => Math.abs(v - 4 / 3) < 1e-5)).toBe(true);
    expect(ladderBelow(1.4)).toBeCloseTo(4 / 3, 6);
    expect(ladderBelow(0.1)).toBeNull();
  });

  it("fits a bunched field close and a spread field at no less than the readable minimum", () => {
    const W = 1242;
    const H = 698;
    const bunched = cameraTarget({ W, H, dpr: 1, sprite, railLane: 12.8, finishX: 1200, runners: Array.from({ length: 10 }, (_, i) => ({ x: 300 + (i % 3) * 0.5, lane: i, speed: 16 })) });
    const spread = cameraTarget({ W, H, dpr: 1, sprite, railLane: 12.8, finishX: 1200, runners: Array.from({ length: 10 }, (_, i) => ({ x: 300 + i * 12, lane: i, speed: 16 })) });
    expect(bunched.ppm).toBeGreaterThan(spread.ppm);
    expect(spread.ppm * sprite.lenM).toBeGreaterThanOrEqual(sizeLimits(W).minLen - 1e-6);
    expect(bunched.ppm * sprite.lenM).toBeLessThanOrEqual(sizeLimits(W).maxLen + 1e-6);
  });

  it("eases without jumps: the zoom and centre move continuously frame to frame", () => {
    const cam = new TracksideCamera();
    const W = 390;
    const H = 320;
    let maxZoomStep = 0;
    let maxCentreStep = 0;
    let prev: { ppm: number; cx: number } | null = null;
    for (let f = 0; f < 60 * 70; f++) {
      const t = f / 60;
      // A field that strings out, bunches up again and finishes.
      const runners = Array.from({ length: 12 }, (_, i) => ({ x: t * 16 - i * (1 + 10 * Math.sin(t / 20) ** 2), lane: (i * 7) % 12, speed: 16 }));
      cam.update({ W, H, dpr: 3, sprite, runners, railLane: 12.8, finishX: 1100 }, 1 / 60, f === 0);
      if (prev) {
        maxZoomStep = Math.max(maxZoomStep, Math.abs(Math.log(cam.ppm / prev.ppm)));
        maxCentreStep = Math.max(maxCentreStep, Math.abs(cam.cx - prev.cx - 16 / 60));
      }
      prev = { ppm: cam.ppm, cx: cam.cx };
      // and the hard whole-field guarantee holds with the eased camera
      const lay = placeField({ W, H, ppm: cam.ppm, cx: cam.cx, sprite, runners, railLane: 12.8, laneSpan: cam.laneSpan });
      for (const p of lay.placed) expect(inside(W, H, p.rect)).toBe(true);
    }
    expect(maxZoomStep).toBeLessThan(0.02); // < 2 % per frame
    expect(maxCentreStep).toBeLessThan(0.25); // m per frame beyond the field's own travel
  });

  it("uses HUD-safe insets", () => {
    const i = safeInsets(390, 320);
    expect(i.t).toBeGreaterThan(0);
    expect(320 - i.t - i.b).toBeGreaterThan(90);
  });
});

describe("trackside follow cam (Follow mine)", () => {
  const field = (n: number, lead = 600): CameraRunner[] => Array.from({ length: n }, (_, i) => ({ x: lead - i * 3.2, lane: i, speed: 15 - i * 0.4 }));

  it("centres the followed runner at 40% of the stage width", () => {
    for (const [W, H] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      const runners = field(12);
      const meIdx = 4;
      const input = { W, H, dpr: 2, sprite, railLane: 12.8, finishX: 1200, runners, followIndex: meIdx };
      const t = cameraTarget(input);
      expect(t.follow).toBe(runners[meIdx]);
      const lay = placeField({ W, H, ppm: t.ppm, cx: t.cx, sprite, runners, railLane: 12.8, laneSpan: t.laneSpan, follow: meIdx });
      const p = lay.placed[meIdx]!;
      const centreX = p.rect.x + p.rect.w / 2;
      expect(centreX / W).toBeCloseTo(FOLLOW_AT, 4);
      // the followed runner itself is always inside the stage
      expect(inside(W, H, p.rect)).toBe(true);
    }
  });

  it("zooms to the close-up size (the maxLen cap, only pulled down when the lanes can't fit the stage)", () => {
    for (const [W, H] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      const runners = field(12);
      const t = followTarget({ W, H, dpr: 2, sprite, railLane: 12.8, finishX: 1200, runners }, runners[4]!);
      const maxLen = sizeLimits(W, runners.length).maxLen;
      // On the acceptance stages the lanes genuinely fit, so the cap is reached exactly.
      expect(t.ppm * sprite.lenM).toBeCloseTo(maxLen, 6);
      // Tautology guard for other stages: never above the cap, never above the vertical fit.
      const cr = crowding(W, runners.length);
      const insets = safeInsets(W, H);
      const ppmV = verticalFitPpm(maxLen / sprite.lenM, H, insets, 11.6, sprite, 11.6, 0, 0.3, cr);
      expect(t.ppm).toBeLessThanOrEqual(maxLen / sprite.lenM + 1e-9);
      expect(t.ppm).toBeLessThanOrEqual(ppmV + 1e-9);
      // Close-up is far tighter than the whole-field fit of a strung-out field.
      const whole = cameraTarget({ W, H, dpr: 2, sprite, railLane: 12.8, finishX: 1200, runners });
      expect(t.ppm).toBeGreaterThan(whole.ppm);
    }
  });

  it("feed-forwards the followed runner's speed (the lock doesn't lag)", () => {
    const runners = field(12);
    const t = followTarget({ W: 1440, H: 900, dpr: 2, sprite, railLane: 12.8, finishX: 1200, runners }, runners[7]!);
    expect(t.speed).toBe(runners[7]!.speed);
  });

  it("whole field is still the target without a valid follow index", () => {
    const runners = field(12);
    for (const followIndex of [null, undefined, -1, 99]) {
      const t = cameraTarget({ W: 1440, H: 900, dpr: 2, sprite, railLane: 12.8, finishX: 1200, runners, followIndex });
      expect(t.follow ?? null).toBeNull();
    }
  });

  it("keeps following a pulled-up / far-behind runner (no re-frame back to the field)", () => {
    const runners = field(12, 1000);
    const me = runners[9]!;
    me.x = 300; // tailed off, 700 m behind the leaders
    me.speed = 4;
    const t = followTarget({ W: 390, H: 844, dpr: 2, sprite, railLane: 12.8, finishX: 1200, runners }, me);
    const lay = placeField({ W: 390, H: 844, ppm: t.ppm, cx: t.cx, sprite, runners, railLane: 12.8, laneSpan: t.laneSpan, follow: 9 });
    const p = lay.placed[9]!;
    expect((p.rect.x + p.rect.w / 2) / 390).toBeCloseTo(FOLLOW_AT, 4);
    expect(inside(390, 844, p.rect)).toBe(true);
    // ...and the leaders are long gone off the right edge.
    expect(lay.placed[0]!.rect.x).toBeGreaterThan(390);
  });

  it("placeField in follow mode: pure linear mapping, no fit/compression, others may leave", () => {
    const runners: RunnerPos[] = Array.from({ length: 12 }, (_, i) => ({ x: 1000 - i * i * 1.5, lane: i % 4 }));
    const f = placeField({ W: 390, H: 320, ppm: 30, cx: 990, sprite, runners, railLane: 12.8, follow: 3 });
    expect(f.compressed).toBe(false);
    for (const p of f.placed) expect(Math.abs(p.shift)).toBeLessThan(1e-9);
    // The same field without follow compresses to fit (guarantee is whole-field only).
    const whole = placeField({ W: 390, H: 320, ppm: 30, cx: 990, sprite, runners, railLane: 12.8 });
    expect(whole.compressed).toBe(true);
  });

  it("keeps the followed runner centred and framed while racing (no feed-forward drift)", () => {
    const cam = new TracksideCamera();
    const W = 1440;
    const H = 900;
    const runners = field(12);
    let x0 = 0;
    for (let f = 0; f < 60 * 8; f++) {
      const dt = 1 / 60;
      x0 += runners[4]!.speed * dt;
      runners[4]!.x = x0;
      cam.update({ W, H, dpr: 2, sprite, railLane: 12.8, finishX: 1200, runners, followIndex: 4 }, dt, f === 0);
      const lay = placeField({ W, H, ppm: cam.ppm, cx: cam.cx, sprite, runners, railLane: 12.8, laneSpan: cam.laneSpan, follow: 4 });
      expect(inside(W, H, lay.placed[4]!.rect), `frame ${f}`).toBe(true);
    }
    const lay = placeField({ W, H, ppm: cam.ppm, cx: cam.cx, sprite, runners, railLane: 12.8, laneSpan: cam.laneSpan, follow: 4 });
    const p = lay.placed[4]!;
    expect(Math.abs((p.rect.x + p.rect.w / 2) / W - FOLLOW_AT)).toBeLessThan(0.02);
  });

  it("eases smoothly when the mode toggles (no jump cut) and settles on the close-up rung", () => {
    const cam = new TracksideCamera();
    const W = 390;
    const H = 844;
    const runners = field(12);
    const base = { W, H, dpr: 2, sprite, railLane: 12.8, finishX: 1200, runners };
    cam.update({ ...base, followIndex: null }, 0, true);
    let prevPpm = cam.ppm;
    let maxZoomStep = 0;
    for (let f = 0; f < 60 * 8; f++) {
      cam.update({ ...base, followIndex: 4 }, 1 / 60, false);
      maxZoomStep = Math.max(maxZoomStep, Math.abs(Math.log(cam.ppm / prevPpm)));
      prevPpm = cam.ppm;
    }
    // Continuous the whole way through the transition (springs, not cuts)...
    expect(maxZoomStep).toBeLessThan(0.06);
    // ...and it actually reaches the close-up ladder (the whole-field rung is far below).
    const fit = followTarget(base, runners[4]!).ppm;
    expect(cam.ppm).toBeGreaterThan(fit / 1.2);
    expect(cam.ppm).toBeLessThanOrEqual(fit + 1e-9);
    // Toggling back returns to the field fit.
    for (let f = 0; f < 60 * 8; f++) cam.update({ ...base, followIndex: null }, 1 / 60, false);
    const whole = cameraTarget(base);
    expect(cam.ppm).toBeLessThan(whole.ppm * 1.2);
  });
});
