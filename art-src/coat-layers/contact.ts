// Contact sheets (coat audit): per phenotype a row of the 3/4 portrait next to its race and ranch
// sprites, all through the shared painters. Row order is printed and written next to the sheet.
//   node <tsx> art-src/coat-layers/contact.ts <out.png> <look,look,...> [sheet:frame ...]
import { writeFileSync } from "node:fs";
import { atlasFromRgba, fitPaintedRamp, paintGeneticPortrait, portraitCoatGeometry, portraitLookOf } from "../../packages/art-pipeline/src/index";
import type { HorseAppearance } from "../../packages/shared/src/index";
import { ART, blank, crop, paste, readPng, writePng, type Img } from "./png";
import { LOOKS, lookOf, paintSheet } from "./sheet";

const FRAMES: Record<string, number> = {
  "race/horse-gallop": 12,
  "race/horse-idle": 14,
  "race/horse-break": 8,
  "race/horse-drive": 12,
  "race/horse-lunge": 6,
  "race/horse-easeup": 13,
  "race/horse-celebrate": 11,
  "race/horse-pullup": 10,
  "diorama/horse-canter": 12,
  "diorama/horse-walk-jockey": 8,
  "diorama/horse-loose-walk": 8,
  "diorama/horse-loose-graze": 24,
  "diorama/horse-loose-idle": 8,
};

let portraitArt: { roles: Img; atlas: ReturnType<typeof atlasFromRgba>; geo: ReturnType<typeof portraitCoatGeometry>; marks: Img } | null = null;
export function portrait(a: HorseAppearance): Img {
  if (!portraitArt) {
    const roles = readPng(`${ART}/portraits/roles.png`);
    const at = readPng(`${ART}/portraits/coat-layers-2x.png`);
    portraitArt = { roles, atlas: atlasFromRgba(at.data, at.width, at.height, 2), geo: portraitCoatGeometry(roles.data), marks: readPng(`${ART}/portraits/portrait-marks.png`) };
  }
  const still = readPng(`${ART}/portraits/horse-${a.coat}.png`);
  const ramp = fitPaintedRamp(still.data, portraitArt.roles.data);
  const out = paintGeneticPortrait(portraitLookOf(a), { pixels: still.data, frames: 1, warp: null, roles: portraitArt.roles.data, marks: portraitArt.marks.data, ramp, coat: { atlas: portraitArt.atlas, geo: portraitArt.geo } });
  return { width: 128, height: 128, data: new Uint8ClampedArray(out) };
}

if (process.argv[1]?.endsWith("contact.ts")) {
  const [out, looksArg, ...views] = process.argv.slice(2);
  const looks = looksArg === "all" ? Object.keys(LOOKS) : looksArg!.split(",");
  const picks = (views.length ? views : ["race/horse-gallop:0", "race/horse-gallop:6", "race/horse-drive:3", "diorama/horse-loose-walk:2", "diorama/horse-loose-graze:8"]).map((v) => {
    const [stem, f] = v.split(":");
    return { stem: stem!, frame: Number(f ?? 0) };
  });
  const rows: Img[] = [];
  for (const name of looks) {
    const a = lookOf(name);
    const cells: Img[] = [portrait(a)];
    for (const p of picks) {
      const img = paintSheet(p.stem, FRAMES[p.stem]!, a);
      const fw = Math.floor(img.width / FRAMES[p.stem]!);
      cells.push(crop(img, p.frame * fw, 0, fw, img.height));
    }
    const h = Math.max(...cells.map((c) => c.height));
    const row = blank(cells.reduce((s, c) => s + c.width + 4, 0), h);
    let x = 0;
    for (const c of cells) {
      paste(row, c, x, h - c.height);
      x += c.width + 4;
    }
    rows.push(row);
  }
  const W = Math.max(...rows.map((r) => r.width));
  const sheet = blank(W, rows.reduce((s, r) => s + r.height + 6, 0), [96, 132, 92, 255]);
  let y = 0;
  for (const r of rows) {
    paste(sheet, r, 0, y);
    y += r.height + 6;
  }
  writePng(out!, sheet);
  writeFileSync(out!.replace(/\.png$/, ".txt"), `rows (top to bottom): ${looks.join(", ")}\ncolumns: portrait, ${picks.map((p) => `${p.stem}#${p.frame}`).join(", ")}\n`);
  console.log(out, sheet.width, sheet.height, looks.join(","));
}
