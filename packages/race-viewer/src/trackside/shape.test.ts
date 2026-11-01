/**
 * Body build and mane / tail on the Trackside / 3D strips (V-04, V-05): the GPU reads the same
 * landmarks and the same hair field as the CPU painter (every other view), and the shader mirrors
 * the warp's rules.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { HorseAppearance } from "@thoroughbred/shared";
import { BUILD_UNITS, NECK_DEPTH, buildCoatGeometry, buildTexels, hairField, hairLevels, rgbaRoleGrid, sheetHairField, sheetSpeed, sheetWarpAnchors, warpAnchors } from "@thoroughbred/art-pipeline";
import { readPng } from "../../../art-pipeline/src/testPng";
import { parseKeyPalette } from "../three/recolor";
import { applyHairField, buildMarkMasks, coatMasks, frameOrigin, indexStrip, indexedRoleGrid, newPalette, stripLongHair } from "./strips";
import { HORSE_FRAG } from "./shaders";
import { RunnerShape, shapeUniforms } from "./shape";

const ART = join(dirname(fileURLToPath(import.meta.url)), "../../../../apps/web/public/art");
const has = existsSync(join(ART, "race/horse-gallop.png"));

describe.skipIf(!has)("build and hair on the shared strips", () => {
  const img = has ? readPng(join(ART, "race/horse-gallop.png")) : null!;
  const keys = has ? parseKeyPalette(JSON.parse(readFileSync(join(ART, "race/palette.json"), "utf8")))! : null!;
  const frames = 12;
  const fw = has ? Math.floor(img.w / frames) : 0;

  it("the Trackside strip has the CPU painter's landmarks and hair field, byte for byte", { timeout: 120_000 }, () => {
    const pal = newPalette();
    const l1 = indexStrip(img.data, img.w, img.h, frames, pal, { x: 0, y: 0 }, null)!;
    const grid = indexedRoleGrid(l1, pal, keys);
    const geo = buildCoatGeometry(grid);
    const speed = sheetSpeed("race/horse-gallop");
    const legacy = stripLongHair(l1, pal, keys, geo, speed);
    const mask = buildMarkMasks(l1, pal, keys, geo, legacy);
    const cm = coatMasks(l1, geo, legacy, pal);
    const field = hairField(grid, geo, speed);
    applyHairField(l1, geo, field, mask, cm.pq);
    // the CPU painter's own copies (RGBA role grid, its own geometry)
    const cgeo = buildCoatGeometry(rgbaRoleGrid(img.data, img.w, img.h, fw, keys));
    const cpuField = sheetHairField(img.data, img.w, fw, cgeo, keys, speed);
    const cpuAnchors = sheetWarpAnchors(img.data, img.w, fw, cgeo, keys);
    expect(warpAnchors(geo, grid)).toEqual(cpuAnchors);
    let n = 0;
    for (let f = 0; f < frames; f++) {
      const [ox, oy] = frameOrigin(l1, f);
      for (let y = 0; y < img.h; y++)
        for (let x = 0; x < fw; x++) {
          const i = (f * img.h + y) * fw + x;
          const o = ((oy + y) * l1.width + ox + x) * 4;
          expect(mask[o + 3]).toBe(cpuField.sets[0][i]);
          expect(cm.pq[o + 3]).toBe(cpuField.sets[1][i]);
          if (cpuField.sets[0][i] || cpuField.sets[1][i]) n++;
          // an empty texel the hair reaches is a hair candidate for the shader
          if ((field.sets[0][i] || field.sets[1][i]) && !l1.index[(oy + y) * l1.width + ox + x]) expect(mask[o]).toBeGreaterThanOrEqual(16);
        }
    }
    expect(n).toBeGreaterThan(1000);
  });

  it("per-runner uniforms carry the look's hair levels and, per frame, the strip's landmarks and the build in texels", () => {
    const a = { coat: "bay", face: "none", legs: ["none", "none", "none", "none"], silks: { primary: "#111111", secondary: "#ffffff", cap: "#111111", pattern: "solid" }, build: { height: 1, leg: 2, neck: -1, girth: 2, head: 0 }, hair: { mane: 2, tail: 1, thick: true, wave: true } } as HorseAppearance;
    const u = shapeUniforms(THREE, a);
    const lv = hairLevels(a.hair!);
    expect((u.uHair!.value as THREE.Vector4).toArray()).toEqual([lv.mane, lv.tail, 1, 1]);
    expect(u.uHairOn!.value).toBe(1);
    const old = shapeUniforms(THREE, { ...a, build: undefined, hair: undefined });
    expect(old.uHairOn!.value).toBe(0);
    const geo = buildCoatGeometry(rgbaRoleGrid(img.data, img.w, img.h, fw, keys));
    const warp = sheetWarpAnchors(img.data, img.w, fw, geo, keys);
    const st = { warp, lods: [{ fw, fh: img.h }] } as never;
    new RunnerShape(a).apply(u, st, 3);
    const t = buildTexels(a.build!, warp);
    expect((u.uBuild!.value as THREE.Vector4).toArray()).toEqual([t.L, t.G, t.NK, 1]);
    const fr = warp.frames[3]!;
    expect((u.uWarpA!.value as THREE.Vector4).toArray()).toEqual([fr.ok, fr.seam, fr.ground, fr.rumpX]);
    expect((u.uWarpC!.value as THREE.Vector4).toArray()).toEqual([fw, img.h, fr.chest, fr.lift]);
    // a horse with no build draws the strip as painted (the warp is off)
    new RunnerShape({ ...a, build: undefined }).apply(u, st, 3);
    expect((u.uBuild!.value as THREE.Vector4).w).toBe(0);
  });

  it("the shader mirrors the warp's rules (neck depth, girth columns, units come in as texels)", () => {
    expect(HORSE_FRAG).toContain(`v < uWarpB.w * ${NECK_DEPTH}`);
    for (const k of ["H * 0.5", "H * 0.9", "H * 1.7", "H * 2.1"]) expect(HORSE_FRAG).toContain(k);
    expect(BUILD_UNITS.leg).toBeGreaterThan(0);
  });
});
