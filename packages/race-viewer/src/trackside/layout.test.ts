import { describe, expect, it } from "vitest";
import { cameraTarget, gallopMetrics, ladderBelow, placeField, safeInsets, sizeLimits, squeezeX, TracksideCamera, ZOOM_LADDER, type RunnerPos } from "./layout";

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
  it("keeps every runner inside the stage for any zoom, centre and spread", () => {
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
      // and the hard guarantee holds with the eased camera
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
