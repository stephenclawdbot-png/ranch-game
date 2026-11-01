/**
 * Every horse sheet takes the horse's own colours: no opaque texel of the sheets is an unkeyed
 * colour, every horse texel (coat, points, mane) comes out of the paint recoloured for a grey,
 * chestnut, black, tobiano and appaloosa, and no leg is painted as one flat plate (a whole leg in
 * the single darkest points key, which recolours to a flat plate with no coat, shading or markings).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { HorseAppearance, HorseColour } from "@thoroughbred/shared";
import { HORSE_SHEETS, atlasFromRgba, buildCoatGeometry, flatLegTexels, paintCoatStrip, rgbaRoleGrid, sheetSpeed, type CoatAtlas } from "@thoroughbred/art-pipeline";
import { readPng } from "../../../art-pipeline/src/testPng";
import { applyRecolor, buildRecolorPlan, parseKeyPalette } from "./recolor";

const ART = join(dirname(fileURLToPath(import.meta.url)), "../../../../apps/web/public/art");
const has = existsSync(join(ART, "race/coat-layers.png"));
const RAW = has ? (JSON.parse(readFileSync(join(ART, "race/palette.json"), "utf8")) as Record<string, unknown>) : {};
const KEYS = has ? parseKeyPalette(RAW)! : null!;
const SILKS = { primary: "#1f4e9c", secondary: "#f3e7c9", cap: "#c0392b", pattern: "hoops" } as const;
const look = (c: Partial<HorseColour>, a: Partial<HorseAppearance> = {}): HorseAppearance =>
  ({ coat: "bay", face: "none", legs: ["sock", "none", "stocking", "coronet"], silks: SILKS, colour: { base: "bay", cream: 0, dun: false, roan: false, grey: "none", sabino: 0, markSeed: 7, ...c }, ...a }) as HorseAppearance;
const COATS: [string, HorseAppearance][] = [
  ["grey", look({ base: "black", grey: "white" })],
  ["chestnut", look({ base: "chestnut" })],
  ["black", look({ base: "black" })],
  ["tobiano", look({ tobiano: 1 })],
  ["appaloosa", look({ base: "chestnut", leopard: "leopard" })],
];
/** Every colour the palette names (recoloured keys and the fixed ink, tack, skin, white). */
const KNOWN = new Set<number>();
const add = (v: unknown) => {
  if (Array.isArray(v)) for (const h of v) KNOWN.add(Number.parseInt(String(h).slice(1), 16));
  else if (v && typeof v === "object") for (const w of Object.values(v)) add(w);
};
add(RAW);

let atlasMemo: CoatAtlas | null = null;
const atlas = () => {
  if (!atlasMemo) {
    const a = readPng(join(ART, "race/coat-layers.png"));
    atlasMemo = atlasFromRgba(a.data, a.w, a.h, 1);
  }
  return atlasMemo;
};

describe.skipIf(!has)("every horse sheet takes the horse's colours", () => {
  const files = HORSE_SHEETS.flatMap((s) => ["", "-f"].map((suffix) => [`${s.stem}${suffix}`, s.frames] as const)).filter(([f]) => existsSync(join(ART, `${f}.png`)));

  it.each(files)("%s: every opaque texel keyed, no flat legs", { timeout: 120_000 }, (file, frames) => {
    const img = readPng(join(ART, `${file}.png`));
    let unknown = 0;
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3]! >= 128 && !KNOWN.has((img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!)) unknown++;
    expect(unknown, `${file}: opaque texels in no palette colour`).toBe(0);
    const flat = flatLegTexels(img.data, img.w, img.h, frames, RAW as never);
    expect(flat.map((f) => `f${f.frame}: ${f.texels.length} texels`), `${file}: legs painted as one flat plate`).toEqual([]);
  });

  it.each(HORSE_SHEETS.map((s) => [s.stem, s.frames] as const))("%s: every horse texel recoloured for each coat", { timeout: 300_000 }, (stem, frames) => {
    const img = readPng(join(ART, `${stem}.png`));
    const fw = Math.floor(img.w / frames);
    const grid = rgbaRoleGrid(img.data, img.w, img.h, fw, KEYS);
    const geo = buildCoatGeometry(grid);
    for (const [name, a] of COATS) {
      const plan = buildRecolorPlan(KEYS, a);
      const out = paintCoatStrip(img.data, img.w, fw, geo, a, atlas(), KEYS, (d) => applyRecolor(d, img.w, img.h, fw, plan), sheetSpeed(stem));
      let raw = 0;
      let first = "";
      for (let f = 0; f < frames; f++)
        for (let y = 0; y < img.h; y++)
          for (let x = 0; x < fw; x++) {
            const i = (f * img.h + y) * fw + x;
            if (!geo.region[i] || geo.outside[i]) continue;
            const role = grid.role(f, x, y);
            if (role < 1 || role > 3) continue;
            const o = (y * img.w + f * fw + x) * 4;
            if (out[o + 3]! < 128) continue;
            if (out[o] === img.data[o] && out[o + 1] === img.data[o + 1] && out[o + 2] === img.data[o + 2]) {
              raw++;
              first ||= `f${f} (${x},${y})`;
            }
          }
      expect(raw, `${stem} ${name}: horse texels left at their raw key, first at ${first}`).toBe(0);
    }
  });
});
