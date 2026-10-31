// Animated checks (coat audit): per look and sheet, every frame painted by the shared painter,
// written as a frame strip PNG (2x) and the raw frames for a GIF (art-src/coat-layers/gif.py).
//   node <tsx> art-src/coat-layers/anim.ts <outDir> <look,...> <stem:frames,...>
import { mkdirSync } from "node:fs";
import { blank, crop, paste, writePng } from "./png";
import { lookOf, paintSheet } from "./sheet";

const [outDir, looksArg, sheetsArg] = process.argv.slice(2);
mkdirSync(outDir!, { recursive: true });
for (const name of looksArg!.split(",")) {
  for (const spec of sheetsArg!.split(",")) {
    const [stem, framesArg] = spec.split(":");
    const frames = Number(framesArg);
    const img = paintSheet(stem!, frames, lookOf(name));
    const fw = Math.floor(img.width / frames);
    const tag = `${name}--${stem!.split("/").pop()}`;
    const bg = blank(img.width, img.height, [96, 132, 92, 255]);
    paste(bg, img, 0, 0);
    writePng(`${outDir}/${tag}.png`, bg);
    for (let f = 0; f < frames; f++) {
      const fr = blank(fw, img.height, [96, 132, 92, 255]);
      paste(fr, crop(img, f * fw, 0, fw, img.height), 0, 0);
      writePng(`${outDir}/frames/${tag}-${String(f).padStart(2, "0")}.png`, fr);
    }
  }
}
