// Race starting stalls for the Trackside view: a single stall bay in strict side profile
// (the trackside lanes recede in depth, so one bay sprite is drawn once per lane).
//   node art-src/race/gen-stalls.mjs <job> [<job> ...]     (raw -> art-src/race/raw/<job>-N.png)
//   node art-src/race/gen-stalls.mjs --list
// The API key is read by ../pixellab.mjs from ~/.config/pixellab/key (never written anywhere).
import { existsSync } from "node:fs";
import { run, b64img } from "../pixellab.mjs";

const OUT = "art-src/race/raw";
const HD = "HD pixel art with fine detail and many small pixels";
const STYLE_HINT =
  "high-res pixel art, crisp hand-pixelled look, selective dark outlines, rich shading, warm golden-hour English racecourse palette: honey sunlight, deep racing greens, cream";
// The approved front-view gate carries the exact palette we want (green padded steel);
// used as a style reference only, never for pose.
const STYLE_REF = "apps/web/public/art/race/starting-gate.png";
// starting-gate.png is 512x211 on disk; style_image size must match the real pixels.
const styleOf = (file) =>
  existsSync(file)
    ? { style_image: { image: b64img(file), size: { width: 512, height: 211 }, usage_description: "match ONLY this pixel art style, palette, line weight and shading; ignore its camera angle completely" } }
    : {};

const SIDE = "strict perfect side profile view, looking exactly along the running rail: zero perspective, no front view, no three-quarter view, the whole sprite is seen from the side and faces right (the direction of travel)";
const BAY =
  "ONE single free-standing bay of a horse-racing starting gate (a starting stall), empty, no horse: a boxy dark racing-green painted welded steel frame on two small black wheels, a tall vertical square post at the front and one at the back joined by a flat top rail truss, low green padded side boarding between the posts with thin steel bars above it, a white and green closed padded front gate slab at the front right edge, a blank white square number board on top of the frame, ground shadowless";

const v2 = (description, w, h, seed) => ({
  ep: "/generate-image-v2",
  body: { description: `${description}, ${HD}, ${STYLE_HINT}, transparent background`, image_size: { width: w, height: h }, seed, no_background: true, ...styleOf(STYLE_REF) },
});

export const JOBS = {
  "stall-bay": v2(`${BAY}, ${SIDE}`, 320, 256, 15501),
  "stall-bay-b": v2(`${BAY}, ${SIDE}`, 320, 256, 15502),
};

const names = process.argv.slice(2);
if (names[0] === "--list") {
  console.log(Object.keys(JOBS).join("\n"));
} else {
  for (const n of names) {
    const j = JOBS[n];
    if (!j) {
      console.log(n, "unknown job");
      continue;
    }
    try {
      const r = await run(j.ep, j.body, `${OUT}/${n}`);
      console.log(n, r.files.length, JSON.stringify(r.job?.usage ?? r.response.usage));
    } catch (e) {
      console.log(n, "FAILED", e.message.slice(0, 400));
    }
  }
}
