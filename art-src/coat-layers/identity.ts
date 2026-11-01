// Contact sheet of the identity set (apps/web/src/dev/identityHorses.ts: eight breeds, builds and
// manes from their own genes) through the shared CPU painter, every keyed animation side by side
// (the 3D fallback, ranch and paddock sprites, gallop sprite, photo finish and share cards draw
// exactly this; Trackside and the 3D view draw it on the GPU from the same numbers).
//   node <tsx> art-src/coat-layers/identity.ts <out.png> [scale] [flat]
// `flat` = the painted bodies and hair (as ?build=0 draws them), for comparison.
import { setBuildSwitch } from "../../packages/art-pipeline/src/index";
import { IDENTITY_HORSES, identityAppearance } from "../../apps/web/src/dev/identityHorses";
import { paintSheet } from "./sheet";
import { blank, crop, paste, writePng, type Img } from "./png";

/** [sheet stem, frame count, frames shown]. */
export const IDENTITY_CELLS: [string, number, number[]][] = [
  ["race/horse-gallop", 12, [0, 3, 6, 9]],
  ["race/horse-idle", 14, [0]],
  ["race/horse-drive", 12, [2]],
  ["race/horse-celebrate", 11, [4]],
  ["diorama/horse-canter", 12, [5]],
  ["diorama/horse-walk-jockey", 8, [2]],
  ["diorama/horse-loose-walk", 8, [3]],
  ["diorama/horse-loose-graze", 24, [0, 12]],
];

if (process.argv[1]?.endsWith("identity.ts")) {
  const [out, scaleArg, flat] = process.argv.slice(2);
  const scale = Number(scaleArg ?? 1);
  if (flat === "flat") setBuildSwitch(false);
  const rows: Img[] = [];
  IDENTITY_HORSES.forEach((h, i) => {
    const look = identityAppearance(h, i);
    const cells: Img[] = [];
    for (const [stem, frames, pick] of IDENTITY_CELLS) {
      const img = paintSheet(stem, frames, look);
      const fw = Math.floor(img.width / frames);
      for (const f of pick) cells.push(crop(img, f * fw, 0, fw, img.height));
    }
    const h0 = Math.max(...cells.map((c) => c.height));
    const row = blank(cells.reduce((s, c) => s + c.width, 0), h0, [96, 132, 92, 255]);
    let x = 0;
    for (const c of cells) {
      paste(row, c, x, h0 - c.height);
      x += c.width;
    }
    rows.push(row);
  });
  const W = Math.max(...rows.map((r) => r.width));
  const sheet = blank(W * scale, rows.reduce((s, r) => s + r.height, 0) * scale, [96, 132, 92, 255]);
  let y = 0;
  for (const r of rows) {
    paste(sheet, r, 0, y, scale);
    y += r.height * scale;
  }
  writePng(out!, sheet);
  console.log(out, sheet.width, sheet.height);
}
