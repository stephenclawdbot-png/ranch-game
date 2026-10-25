// Normal maps for delivered sprites/strips: node art-src/gen-normals.mjs <in.png> <frames> <out.png> [kind] [mode]
import { run, b64img } from "./pixellab.mjs";
import { copyFileSync } from "node:fs";
const [inp, frames, out, kind = "character", mode = "pro"] = process.argv.slice(2);
const prefix = `art-src/raw/normals/${out.split("/").pop().replace(/\.png$/, "")}`;
const r = await run("/normal-map", { image: b64img(inp), frames: Number(frames), mode, kind }, prefix);
copyFileSync(r.files[0], out);
console.log(out, JSON.stringify(r.job?.usage ?? r.response.usage));
