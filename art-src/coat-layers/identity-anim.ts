// Animated check of the identity set (apps/web/src/dev/identityHorses.ts): every frame of a sheet
// for the eight horses side by side (4 x 2), painted by the shared CPU painter, written as frame
// PNGs for art-src/coat-layers/gif.py.
//   node <tsx> art-src/coat-layers/identity-anim.ts <outDir> <stem:frames,...> [flat]
import { mkdirSync } from "node:fs";
import { setBuildSwitch } from "../../packages/art-pipeline/src/index";
import { IDENTITY_HORSES, identityAppearance } from "../../apps/web/src/dev/identityHorses";
import { blank, crop, paste, writePng } from "./png";
import { paintSheet } from "./sheet";

const [outDir, sheetsArg, flat] = process.argv.slice(2);
if (flat === "flat") setBuildSwitch(false);
mkdirSync(`${outDir}/frames`, { recursive: true });
for (const spec of sheetsArg!.split(",")) {
  const [stem, framesArg] = spec.split(":");
  const frames = Number(framesArg);
  const painted = IDENTITY_HORSES.map((h, i) => paintSheet(stem!, frames, identityAppearance(h, i)));
  const fw = Math.floor(painted[0]!.width / frames);
  const fh = painted[0]!.height;
  const tag = `identity-${stem!.split("/").pop()}${flat === "flat" ? "-build0" : ""}`;
  for (let f = 0; f < frames; f++) {
    const sheet = blank(fw * 4, fh * 2, [96, 132, 92, 255]);
    painted.forEach((img, k) => paste(sheet, crop(img, f * fw, 0, fw, fh), (k % 4) * fw, Math.floor(k / 4) * fh));
    writePng(`${outDir}/frames/${tag}-${String(f).padStart(2, "0")}.png`, sheet);
  }
}
