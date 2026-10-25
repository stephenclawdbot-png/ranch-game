import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COAT_PALETTES } from "@thoroughbred/art-pipeline";
import type { HorseAppearance } from "@thoroughbred/shared";
import { generateFallbackRig } from "./fallback";
import {
  GALLOP,
  GaitRig,
  LEGS,
  createSecondaryState,
  gaitForSpeed,
  sampleLeg,
  solveTwoBone,
  strideFrequency,
  type LegId,
} from "./gait";
import { boneNames, countVariants, hashAppearance, morphSkeleton, resolveLook, selectSkeleton, NEUTRAL_MORPH } from "./morph";
import { buildHorsePalette, hexToRgb, lightness, makeRamp, paletteToBytes, RAMP_STEPS } from "./ramp";
import { parseRigDef, RigDefError, ROLE_COUNT, ROLE_ID, ROLES, type RigDef } from "./rigdef";

const HERE = dirname(fileURLToPath(import.meta.url));
const RIG_JSON = join(HERE, "../../../apps/web/public/art/rig/horse-rig.json");

const APP: HorseAppearance = {
  coat: "bay",
  face: "blaze",
  legs: ["none", "sock", "none", "stocking"],
  silks: { primary: "#c0262d", secondary: "#ffffff", pattern: "hoops", cap: "#ffffff" },
};

function rigDefs(): [string, RigDef][] {
  const out: [string, RigDef][] = [["generated", generateFallbackRig().def]];
  if (existsSync(RIG_JSON)) out.push(["pixellab", parseRigDef(JSON.parse(readFileSync(RIG_JSON, "utf8")))]);
  return out;
}

describe("gait math", () => {
  it("is periodic in phase", () => {
    for (const leg of LEGS) {
      for (const p of [0, 0.13, 0.5, 0.77]) {
        const a = sampleLeg(GALLOP, leg, p);
        const b = sampleLeg(GALLOP, leg, p + 1);
        const c = sampleLeg(GALLOP, leg, p - 3);
        expect(b.x).toBeCloseTo(a.x, 9);
        expect(c.y).toBeCloseTo(a.y, 9);
        expect(b.stance).toBe(a.stance);
      }
    }
  });

  it("gallop footfalls follow LH -> RH -> LF -> RF with one suspension", () => {
    const N = 400;
    const onset: Record<LegId, number> = { LH: -1, RH: -1, LF: -1, RF: -1 };
    let airborne = 0;
    for (let i = 0; i < N; i++) {
      const p = i / N;
      let anyDown = false;
      for (const leg of LEGS) {
        const s = sampleLeg(GALLOP, leg, p);
        const prev = sampleLeg(GALLOP, leg, p - 1 / N);
        if (s.stance && !prev.stance) onset[leg] = p;
        anyDown ||= s.stance;
      }
      if (!anyDown) airborne++;
    }
    expect(onset.LH).toBeLessThan(onset.RH);
    expect(onset.RH).toBeLessThan(onset.LF);
    expect(onset.LF).toBeLessThan(onset.RF);
    // each hoof is down for the duty fraction of the stride
    for (const leg of LEGS) {
      let down = 0;
      for (let i = 0; i < N; i++) if (sampleLeg(GALLOP, leg, i / N).stance) down++;
      expect(down / N).toBeCloseTo(GALLOP.duty, 2);
    }
    // gathered suspension of roughly a quarter stride
    expect(airborne / N).toBeGreaterThan(0.2);
    expect(airborne / N).toBeLessThan(0.4);
  });

  it("hooves stay on the ground in stance and sweep backwards", () => {
    const g = gaitForSpeed(16);
    const a = sampleLeg(g, "RF", g.touchdown.RF + 0.01);
    const b = sampleLeg(g, "RF", g.touchdown.RF + g.duty - 0.01);
    expect(a.stance && b.stance).toBe(true);
    expect(a.y).toBe(0);
    expect(b.x).toBeLessThan(a.x);
    // and are lifted in swing
    expect(sampleLeg(g, "RF", g.touchdown.RF + g.duty + 0.2).y).toBeLessThan(-3);
  });

  it("blends gaits by speed and extends the stride", () => {
    expect(gaitForSpeed(0).duty).toBe(1);
    expect(gaitForSpeed(1.6).duty).toBeGreaterThan(0.5);
    expect(gaitForSpeed(18).reach[1]).toBeGreaterThan(gaitForSpeed(13).reach[1]);
    expect(strideFrequency(17)).toBeGreaterThan(strideFrequency(7));
  });

  it("two-bone IK keeps segment lengths and bends to the requested side", () => {
    const { mid, end } = solveTwoBone([0, 0], [3, 20], 12, 12, -1);
    expect(Math.hypot(mid[0], mid[1])).toBeCloseTo(12, 6);
    expect(Math.hypot(end[0] - mid[0], end[1] - mid[1])).toBeCloseTo(12, 6);
    expect(end[0]).toBeCloseTo(3, 6);
    const other = solveTwoBone([0, 0], [3, 20], 12, 12, 1);
    expect(Math.sign(mid[0] - 1.5)).not.toBe(Math.sign(other.mid[0] - 1.5));
  });

  for (const [name, def] of rigDefs()) {
    it(`poses are stride-periodic, finite and pixel-snapped (${name} rig)`, () => {
      const skel = selectSkeleton(def, { head: 0, mane: 0, tail: 0, build: 0 });
      const rig = new GaitRig(skel);
      const sec = createSecondaryState();
      const pose = (phase: number, time: number) => Array.from(rig.compute({ phase, speedMs: 16, drive: 0.5, time }, sec).m);
      // warm the springs up over a few strides
      for (let i = 0; i < 240; i++) pose(i / 60, i / 60);
      const a = pose(4.25, 4);
      const b = pose(5.25, 4);
      const iTail = rig.index.get("tail")!;
      const iMane = rig.index.get("mane")!;
      for (let i = 0; i < rig.n; i++) {
        if (i === iTail || i === iMane || i === rig.index.get("tailTip")) continue; // springs depend on history
        for (let k = 0; k < 6; k++) expect(b[i * 6 + k]).toBeCloseTo(a[i * 6 + k]!, 4);
      }
      expect(a.every(Number.isFinite)).toBe(true);
      // translations sit on the pixel lattice of each pivot
      skel.parts.forEach((p, i) => {
        const fx = p.pivot[0] - Math.floor(p.pivot[0]);
        expect(Math.abs(((a[i * 6 + 4]! - fx) % 1) + 1) % 1).toBeLessThan(1e-4);
      });
    });

    it(`stance hooves touch the ground line (${name} rig)`, () => {
      const skel = selectSkeleton(def, { head: 0, mane: 0, tail: 0, build: 0 });
      const rig = new GaitRig(skel);
      const g = gaitForSpeed(16);
      const m = rig.compute({ phase: g.touchdown.RF + g.duty / 2, speedMs: 16, drive: 0, time: 0 }, createSecondaryState(), undefined, { snap: false }).m;
      const hoof = rig.index.get("foreNearHoof")!;
      const restY = skel.parts[hoof]!.pivot[1];
      expect(m[hoof * 6 + 5]!).toBeCloseTo(restY, 0);
    });
  }
});

describe("palette ramps", () => {
  it("makes 8 steps getting lighter, anchored on the base colour", () => {
    for (const base of ["#8a4527", "#1d3fae", "#f3f0e8", "#1f1c1c", "#d5a457"]) {
      const r = makeRamp(base);
      expect(r).toHaveLength(RAMP_STEPS);
      expect(r[4]).toBe(base);
      for (let i = 1; i < r.length; i++) expect(lightness(r[i]!)).toBeGreaterThan(lightness(r[i - 1]!) - 1e-6);
    }
  });

  it("anchors coat ramps on COAT_PALETTES shade / body / highlight", () => {
    for (const p of Object.values(COAT_PALETTES)) {
      const r = makeRamp(p.body, { shade: p.shade, highlight: p.highlight });
      expect(r[2]).toBe(p.shade);
      expect(r[4]).toBe(p.body);
      expect(r[6]).toBe(p.highlight);
      expect(lightness(r[0]!)).toBeLessThan(lightness(p.shade));
    }
  });

  it("hue-shifts shadows cooler and highlights warmer", () => {
    const r = makeRamp("#c0262d");
    const [r0, , b0] = hexToRgb(r[0]!);
    const [r4, , b4] = hexToRgb(r[4]!);
    expect(b0 / Math.max(r0, 1e-3)).toBeGreaterThan(b4 / r4);
  });

  it("maps every role of an appearance into the palette texture rows", () => {
    const pal = buildHorsePalette(APP);
    const bytes = paletteToBytes(pal);
    expect(bytes.length).toBe(RAMP_STEPS * ROLE_COUNT * 4);
    const px = (role: keyof typeof ROLE_ID, i: number) => {
      const o = (ROLE_ID[role] * RAMP_STEPS + i) * 4;
      return `#${[0, 1, 2].map((k) => bytes[o + k]!.toString(16).padStart(2, "0")).join("")}`;
    };
    expect(px("coat", 4)).toBe(COAT_PALETTES.bay.body);
    expect(px("silksPrimary", 4)).toBe(APP.silks.primary);
    expect(px("silksSecondary", 4)).toBe(APP.silks.secondary);
    expect(px("cap", 4)).toBe(APP.silks.cap);
    expect(px("mane", 4)).toBe(COAT_PALETTES.bay.mane);
    expect(px("points", 4)).toBe(COAT_PALETTES.bay.points);
    // mane colour override
    const p2 = buildHorsePalette({ ...APP, maneColor: "#eeddaa" });
    expect(p2.ramps.mane[4]).toBe("#eeddaa");
    expect(buildHorsePalette({ ...APP, coat: "dapple_grey" }).coatTexture).toBe(1);
    expect(buildHorsePalette({ ...APP, coat: "roan" }).coatTexture).toBe(2);
    for (const role of ROLES) expect(pal.ramps[role]).toHaveLength(RAMP_STEPS);
  });
});

describe("rig.json validation", () => {
  it("accepts the generated and the built rig definitions", () => {
    for (const [, def] of rigDefs()) expect(() => parseRigDef(JSON.parse(JSON.stringify(def)))).not.toThrow();
  });

  it("reports every problem with a path", () => {
    const bad = JSON.parse(JSON.stringify(generateFallbackRig().def));
    bad.version = 2;
    bad.parts[0].rect = [0, 0, 999, 4];
    bad.parts[1].parent = "nope";
    bad.parts = bad.parts.filter((p: { name: string }) => p.name !== "head");
    delete bad.joints.bit;
    try {
      parseRigDef(bad);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RigDefError);
      const msg = (e as RigDefError).issues.join("\n");
      expect(msg).toMatch(/version/);
      expect(msg).toMatch(/outside the atlas/);
      expect(msg).toMatch(/unknown part "nope"/);
      expect(msg).toMatch(/missing required part "head"/);
      expect(msg).toMatch(/joints\.bit/);
    }
    expect(() => parseRigDef(null)).toThrow(RigDefError);
  });

  it("the built atlas has the role channel the shader expects", () => {
    if (!existsSync(RIG_JSON)) return;
    const def = parseRigDef(JSON.parse(readFileSync(RIG_JSON, "utf8")));
    expect(def.roles).toEqual([...ROLES]);
    expect(def.scale).toBe(4);
    expect(countVariants(def).mane).toBeGreaterThanOrEqual(1);
  });
});

describe("per-horse look", () => {
  const def = generateFallbackRig().def;

  it("defaults deterministically from the appearance", () => {
    const a = resolveLook(APP, {}, { mane: 3, tail: 2 });
    const b = resolveLook(APP, {}, { mane: 3, tail: 2 });
    expect(a).toEqual(b);
    const c = resolveLook({ ...APP, coat: "grey" }, {}, { mane: 3, tail: 2 });
    expect(c.seed).not.toBe(a.seed);
    expect(a.variants.mane).toBeLessThan(3);
    expect(a.morph.legLength).toBeGreaterThan(0.95);
    expect(a.morph.legLength).toBeLessThan(1.05);
    expect(hashAppearance(APP)).toBe(hashAppearance({ ...APP }));
  });

  it("honours explicit knobs, wrapping variants and clamping morphs", () => {
    const l = resolveLook(APP, { variants: { mane: 5, tail: -1 }, morph: { legLength: 3 }, seed: 42 }, { mane: 2, tail: 2 });
    expect(l.variants.mane).toBe(1);
    expect(l.variants.tail).toBe(1);
    expect(l.morph.legLength).toBe(1.15);
    expect(l.seed).toBe(42);
  });

  it("leg length keeps hooves on the ground and raises the body", () => {
    const base = selectSkeleton(def, { head: 0, mane: 0, tail: 0, build: 0 });
    const long = morphSkeleton(base, { ...NEUTRAL_MORPH, legLength: 1.12 });
    const p = (s: typeof base, n: string) => s.parts.find((q) => q.name === n)!;
    expect(p(long, "foreNearHoof").pivot[1]).toBeCloseTo(p(base, "foreNearHoof").pivot[1], 0);
    expect(p(long, "barrel").pivot[1]).toBeLessThan(p(base, "barrel").pivot[1] - 1);
    expect(p(long, "foreNearLower").scale![1]).toBeCloseTo(1.12, 6);
    const big = morphSkeleton(base, { ...NEUTRAL_MORPH, headSize: 1.1, neckLength: 1.15 });
    expect(big.joints.bit![0]).toBeGreaterThan(base.joints.bit![0]);
    expect(p(big, "head").scale![0]).toBeCloseTo(1.1, 6);
  });

  it("all variants of a slot share one bone", () => {
    const names = boneNames(def);
    expect(new Set(names).size).toBe(names.length);
    expect(names.at(-1)).toBe("rein");
  });
});
