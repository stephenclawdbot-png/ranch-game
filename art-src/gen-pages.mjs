// Page backdrops (scenes/*.png), 480x200 native, opaque.
//   node art-src/gen-pages.mjs <job> [...]
import { run, b64img } from "./pixellab.mjs";
const OUT = "art-src/raw/pages";
const STYLE = "high-res pixel art, crisp hand-pixelled look, selective dark outlines, rich shading, cohesive warm palette, wide cinematic side-on view, game background";
const style = { style_image: { image: b64img("art-src/raw/scene/far-hills-opaque-0.png"), size: { width: 480, height: 128 }, usage_description: "match this pixel art style, palette and golden-hour lighting" } };
const J = (d, seed, extra = {}) => ({ description: `${d}, ${STYLE}`, image_size: { width: 480, height: 200 }, no_background: false, seed, ...extra });
const JOBS = {
  "stable-yard": J("an English racehorse stable yard at golden hour: a courtyard of red-brick stable blocks with green half-doors, a clock tower over the arch, horses looking out over the stable doors, hay bales, a water trough, cobbled yard, hanging flower baskets, long warm shadows, honey sunlight", 9101, style),
  paddock: J("a racecourse parade paddock at golden hour: an oval of manicured grass with a white rail, thoroughbred racehorses with jockeys in colourful silks being led around by grooms, spectators along the rail, mature oak trees and a Victorian weighing room building behind, bunting, warm late sunlight", 9102, style),
  grandstand: J("a racecourse finish line at golden hour seen from the track: the red and white winning post in front of a grand Victorian grandstand with green and cream striped roofs, packed cheering crowd, bunting and flags, white running rails, lush green turf track in the foreground, warm low sun", 9103, style),
  "barn-interior": J("interior of a cosy wooden racehorse barn: a long aisle of oak stalls with brass name plates, a chestnut horse looking out, saddles and bridles hanging on pegs, hay on the floor, warm lantern light and golden sunbeams through high windows with dust motes", 9104),
};
await Promise.all(process.argv.slice(2).map(async (n) => {
  try { const r = await run("/generate-image-v2", JOBS[n], `${OUT}/${n}`); console.log(n, r.files.length, JSON.stringify(r.job?.usage ?? r.response.usage)); }
  catch (e) { console.log(n, "FAILED", e.message.slice(0, 400)); }
}));
