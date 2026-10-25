// node art-src/seamless.mjs <prefix> "<description>" <transparent:0|1> [seed]
import { run, b64img } from "./pixellab.mjs";
import { readFileSync } from "node:fs";
const [prefix, description, transparent, seed = "777"] = process.argv.slice(2);
const sized = (f) => {
  const b = readFileSync(f);
  return { image: b64img(f), size: { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } };
};
const r = await run("/inpaint-v3", {
  description,
  inpainting_image: sized(`${prefix}-rolled.png`),
  mask_image: sized(`${prefix}-mask.png`),
  no_background: transparent === "1",
  seed: Number(seed),
}, `${prefix}-inpaint`);
console.log(r.files, JSON.stringify(r.job?.usage ?? r.response.usage));
