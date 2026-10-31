// Coat layers, step 2: PixelLab inpaints every pattern variant on the reference horse.
//   node art-src/coat-layers/gen-coat-layers.mjs [layer-id ...]   -> art-src/coat-layers/raw/<id>-<v>-<seed>-0.png
// Re-running skips variants already on disk. Check the balance before and after a batch.
import { existsSync, readdirSync } from "node:fs";
import { b64img, balance, run } from "../pixellab.mjs";
import { LAYER_JOBS } from "./jobs.mjs";

const DIR = "art-src/coat-layers";
const REF_SIZE = { width: 504, height: 362 };
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const force = process.argv.includes("--force");
const jobs = [];
for (const j of LAYER_JOBS) {
  if (only.length && !only.includes(j.id)) continue;
  for (let v = 0; v < j.n; v++) {
    // a variant redrawn after review takes its own seed (jobs.mjs `seeds`)
    const seed = j.seeds?.[v] ?? 9100 + LAYER_JOBS.indexOf(j) * 10 + v;
    const prefix = `${DIR}/raw/${j.id}-${v}-${seed}`;
    const have = existsSync(`${DIR}/raw`) && readdirSync(`${DIR}/raw`).some((f) => f.startsWith(`${j.id}-${v}-`) && f.endsWith(".png"));
    if (have && !force) continue;
    jobs.push({ j, v, seed, prefix });
  }
}
console.log("before", JSON.stringify(await balance()));
const queue = [...jobs];
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const { j, v, seed, prefix } = queue.shift();
      try {
        const r = await run(
          "/inpaint-v3",
          {
            description: j.text,
            inpainting_image: { image: b64img(`${DIR}/ref/reference.png`), size: REF_SIZE },
            mask_image: { image: b64img(`${DIR}/ref/mask-${j.mask}.png`), size: REF_SIZE },
            seed,
            no_background: j.mode === "hair",
            crop_to_mask: true,
          },
          prefix,
        );
        console.log(j.id, v, r.files.length);
      } catch (e) {
        console.log(j.id, v, "FAILED", String(e.message).slice(0, 300));
      }
    }
  }),
);
console.log("after", JSON.stringify(await balance()));
