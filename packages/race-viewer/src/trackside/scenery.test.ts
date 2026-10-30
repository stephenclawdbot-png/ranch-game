import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COURSE_ART, SCENERY, finishTilt, sceneryArt, sceneryFor } from "./scenery";
import type { CourseSceneryId } from "../course/geometry";

const ART = join(dirname(fileURLToPath(import.meta.url)), "../../../../apps/web/public/art");
const IDS: CourseSceneryId[] = ["parkland", "chalk_downs", "coastal", "city", "meadow", "moorland"];

function pngSize(file: string): { w: number; h: number } {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe("racecourse scenery sets", () => {
  it("every course scenery has a recipe; unknown courses keep today's look", () => {
    for (const id of IDS) expect(sceneryFor(id)?.id).toBe(id);
    expect(sceneryFor(null)).toBeNull();
    expect(sceneryFor(undefined)).toBeNull();
  });

  it("each scenery looks different (its own far layer, midground and grandstand)", () => {
    const stands = new Set(IDS.map((id) => SCENERY[id].stand));
    expect(stands.size).toBe(IDS.length);
    const fars = new Set(IDS.map((id) => SCENERY[id].far));
    expect(fars.size).toBe(IDS.length);
    // parkland is the original set: original far hills and the oak line
    expect(SCENERY.parkland.far).toBeNull();
    expect(SCENERY.parkland.mid).toBe("trees");
  });

  it.skipIf(!existsSync(join(ART, "manifest.json")))("every scenery file is approved art in the manifest, on disk", () => {
    const manifest = JSON.parse(readFileSync(join(ART, "manifest.json"), "utf8")) as { assets: { src: string; status: string; origin: string }[] };
    const approved = new Set(manifest.assets.filter((a) => a.status === "approved" && a.origin === "pixellab").map((a) => a.src));
    for (const src of COURSE_ART) {
      expect(approved.has(src), src).toBe(true);
      expect(existsSync(join(ART, src)), src).toBe(true);
    }
    for (const id of IDS) for (const src of sceneryArt(SCENERY[id])) expect(COURSE_ART).toContain(src);
  });

  it.skipIf(!existsSync(join(ART, "manifest.json")))("midground items sit inside their band and far layers tile (asset size conventions)", () => {
    for (const id of IDS) {
      const r = SCENERY[id];
      if (r.far) {
        const { w, h } = pngSize(join(ART, r.far));
        expect(w, r.far).toBe(1376); // mirror-tiled like race/far-hills.png
        expect(h, r.far).toBeLessThanOrEqual(192);
      }
      if (r.mid === "trees") continue;
      for (const it of r.mid.items) {
        const { w, h } = pngSize(join(ART, it.src));
        expect(it.bottom, `${id} ${it.src}`).toBeLessThanOrEqual(r.mid.height + 4);
        expect(it.bottom - h, `${id} ${it.src} top`).toBeGreaterThanOrEqual(-2);
        expect(it.x, `${id} ${it.src}`).toBeLessThan(r.mid.period);
        expect(w).toBeLessThanOrEqual(r.mid.period);
      }
      const stand = pngSize(join(ART, r.stand));
      expect(stand.w).toBeLessThanOrEqual(640);
      expect(stand.h).toBeLessThanOrEqual(320);
    }
  });
});

describe("finish gradient tilt", () => {
  it("is level on flat courses and before the final stretch", () => {
    expect(finishTilt(0, 1)).toBe(0);
    expect(finishTilt(30, 0)).toBe(0);
    expect(finishTilt(30, -2)).toBe(0);
  });

  it("rises to the right on an uphill finish, eases in, and stays exaggerated but small", () => {
    const full = finishTilt(30, 1);
    expect(full).toBeGreaterThan(Math.atan(0.03));
    expect(full).toBeLessThan((3 * Math.PI) / 180);
    expect(finishTilt(30, 0.5)).toBeGreaterThan(0);
    expect(finishTilt(30, 0.5)).toBeLessThan(full);
    expect(finishTilt(30, 5)).toBe(full);
    // downhill tilts the other way
    expect(finishTilt(-10, 1)).toBeLessThan(0);
  });
});
