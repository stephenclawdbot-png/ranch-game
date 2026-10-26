// Pack art for /packs (Design System v2): one 128 px illustration per pack, shown at 1x/2x.
//   node art-src/gen-packs.mjs paddock premium
import { run } from "./pixellab.mjs";
const OUT = "art-src/raw/packs";
const STYLE = "high-res HD pixel art game item, 3/4 view, clean selective dark outline, rich shading, warm golden-hour light from the upper left, transparent background";
const JOBS = {
  paddock: () => run("/generate-image-v2", { description: `a small wooden foal crate made of honey-coloured oak planks, tied with a cream ribbon and bow, a red rosette pinned on the front, a tuft of golden hay poking out of the top, a horseshoe hanging on the side; ${STYLE}`, image_size: { width: 128, height: 128 }, no_background: true, seed: 9301 }, `${OUT}/paddock`),
  premium: () => run("/generate-image-v2", { description: `an ornate deep racing-green lacquered foal crate with polished brass corners and brass trim, tied with a royal blue silk ribbon and bow, a gold first-place rosette on the front, a small brass plaque, sparkles; ${STYLE}`, image_size: { width: 128, height: 128 }, no_background: true, seed: 9302 }, `${OUT}/premium`),
};
await Promise.all(process.argv.slice(2).map(async (n) => {
  try { const r = await JOBS[n](); console.log(n, r.files.length, JSON.stringify(r.job?.usage ?? r.response?.usage)); }
  catch (e) { console.log(n, "FAILED", e.message.slice(0, 500)); }
}));
