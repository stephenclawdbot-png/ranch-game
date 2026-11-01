/**
 * No loose pixels: every frame of every horse sheet, painted with each build (and with builds
 * switched off) and each mane / tail level, keeps every opaque texel joined to the horse and
 * rider, apart from the scraps the painting itself has (a grass tuft, a tail tip in mid-flick).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { HorseAppearance } from "@thoroughbred/shared";
import { HORSE_SHEETS, atlasFromRgba, buildCoatGeometry, detachedIslands, paintCoatStrip, rgbaRoleGrid, setBuildSwitch, sheetSpeed, type CoatAtlas } from "./index";

import { readPng } from "./testPng";

const ART = join(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/public/art");
const has = existsSync(join(ART, "race/coat-layers.png"));
const KEYS = has ? (JSON.parse(readFileSync(join(ART, "race/palette.json"), "utf8")) as { coat: string[]; mane: string[]; points: string[]; cap: string[] }) : null;

/** The smallest island the painted art itself has (a 3-texel tail tip on the gallop): anything smaller is a stray. */
const MIN_ISLAND = 3;

const SILKS = { primary: "#1f4e9c", secondary: "#f3e7c9", cap: "#c0392b", pattern: "solid" } as const;
const BASE = {
  coat: "bay",
  face: "blaze",
  legs: ["stocking", "sock", "coronet", "stocking"],
  silks: SILKS,
  colour: { base: "bay", cream: 0, dun: false, roan: false, grey: "none", sabino: 0, markSeed: 91, tobiano: 1 },
} as unknown as HorseAppearance;
const BUILDS = [undefined, { height: 2, leg: 2, neck: 2, girth: -2, head: 2 }, { height: -2, leg: -2, neck: -2, girth: 2, head: -2 }];
/** Every mane level (0..3) and tail level (0..2), thin and thick, straight and wavy. */
const HAIRS: HorseAppearance["hair"][] = [
  undefined,
  { mane: 0, tail: 0, thick: false, wave: false },
  { mane: 1, tail: 1, thick: false, wave: true },
  { mane: 2, tail: 2, thick: true, wave: false },
  { mane: 3, tail: 2, thick: true, wave: true },
  { mane: 3, tail: 1, thick: false, wave: false },
];

let atlasMemo: CoatAtlas | null = null;
const atlas = () => {
  if (!atlasMemo) {
    const a = readPng(join(ART, "race/coat-layers.png"));
    atlasMemo = atlasFromRgba(a.data, a.w, a.h, 1);
  }
  return atlasMemo;
};

afterEach(() => setBuildSwitch(null));

describe.skipIf(!has)("connected horse: no loose pixels after recolour and warp", () => {
  it.each(HORSE_SHEETS.map((s) => [s.stem, s.frames] as const))("%s: every frame, every build and hair level", { timeout: 300_000 }, (stem, frames) => {
    const img = readPng(join(ART, `${stem}.png`));
    const fw = Math.floor(img.w / frames);
    const geo = buildCoatGeometry(rgbaRoleGrid(img.data, img.w, img.h, fw, KEYS!));
    const islands = (a: HorseAppearance) => detachedIslands(paintCoatStrip(img.data, img.w, fw, geo, a, atlas(), KEYS!, () => undefined, sheetSpeed(stem)), img.w, img.h, fw);
    const base = islands(BASE);
    const check = (label: string, a: HorseAppearance) => {
      const got = islands(a);
      for (const fr of got) {
        const min = fr.detached.length ? fr.detached[fr.detached.length - 1]! : Infinity;
        expect(min, `${stem} f${fr.frame} ${label}: island of ${min} texels at ${fr.at}`).toBeGreaterThanOrEqual(MIN_ISLAND);
        expect(fr.detached.length, `${stem} f${fr.frame} ${label}: islands ${fr.detached.join("/")} (painted: ${base[fr.frame]!.detached.join("/")})`).toBeLessThanOrEqual(base[fr.frame]!.detached.length);
      }
    };
    for (const fr of base) {
      if (fr.detached.length) expect(fr.detached[fr.detached.length - 1]!, `${stem} f${fr.frame}: the painted art`).toBeGreaterThanOrEqual(MIN_ISLAND);
    }
    for (const build of BUILDS)
      for (const hair of HAIRS) {
        if (!build && !hair) continue;
        check(`build ${JSON.stringify(build ?? null)} hair ${JSON.stringify(hair ?? null)}`, { ...BASE, build, hair });
      }
    // feathered (its own long mane, tail and leg hair) with and without a build
    check("feathered", { ...BASE, feather: true });
    check("feathered + build", { ...BASE, feather: true, build: BUILDS[1], hair: HAIRS[4] });
    // builds switched off (?build=0): the painted bodies, the feathered horse keeps its hair
    setBuildSwitch(false);
    check("build off", { ...BASE, build: BUILDS[1], hair: HAIRS[4] });
    check("build off, feathered", { ...BASE, feather: true, build: BUILDS[2], hair: HAIRS[3] });
  });
});
