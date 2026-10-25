// Clean side-view sources for the pixel-rig agent (horse alone, jockey alone, combined neutral).
import { run, b64img } from "./pixellab.mjs";
const STYLE = { image: b64img("raw/hero/v2-a-1.png"), size: { width: 128, height: 96 }, usage_description: "match this pixel art style, outline, palette and shading exactly" };
const HORSE = "bay coat (rich reddish brown with warm highlights), black mane, black tail and black lower legs";
const jobs = {
  combo: () => run("/generate-image-v2", { description: `side view, facing right, a thoroughbred racehorse standing still in a neutral square stance, all four legs straight and clearly separated with visible gaps between them, head up, tail hanging, ${HORSE}, white saddle cloth, a jockey crouched in racing position on top with flat magenta silks body, cyan sleeves, magenta cap, white breeches, black boots, game sprite, high-res pixel art, selective dark outline`, image_size: { width: 128, height: 96 }, no_background: true, seed: 3301, style_image: STYLE }, "raw/rig/combo"),
  horse: () => run("/generate-image-v2", { description: `side view, facing right, a riderless thoroughbred racehorse standing in a neutral open stance, near legs and far legs clearly separated with gaps between all four legs, neck extended forward, ${HORSE}, small racing saddle on a white saddle cloth, no rider, game sprite, high-res pixel art, selective dark outline`, image_size: { width: 128, height: 96 }, no_background: true, seed: 3302, style_image: STYLE }, "raw/rig/horse"),
  editJockey: () => run("/edit-images-v2", { method: "edit_with_text", edit_images: [{ image: b64img("raw/hero/v2-a-1.png"), width: 128, height: 96 }], image_size: { width: 128, height: 96 }, description: "remove the horse completely, keep only the jockey exactly as drawn in the same position and pose, crouched with knees bent and hands forward holding reins, transparent background", no_background: true, seed: 3303 }, "raw/rig/edit-jockey"),
  editHorse: () => run("/edit-images-v2", { method: "edit_with_text", edit_images: [{ image: b64img("raw/hero/v2-a-1.png"), width: 128, height: 96 }], image_size: { width: 128, height: 96 }, description: "remove the jockey rider completely, keep the horse, saddle cloth and saddle exactly as drawn, fill the horse's back and neck where the rider was", no_background: true, seed: 3304 }, "raw/rig/edit-horse"),
  neutral: () => run("/edit-images-v2", { method: "edit_with_text", edit_images: [{ image: b64img("raw/rig/horse-gallop-pose-aligned.png"), width: 128, height: 96 }], image_size: { width: 128, height: 96 }, description: "the same horse standing in a neutral extended stance: all four legs straight and vertical, forelegs apart and hind legs apart so there is a clear gap between every leg, hooves on one ground line, neck forward, tail hanging relaxed; keep the exact same colours, saddle, saddle cloth, outline and size", no_background: true, seed: 3305 }, "raw/rig/edit-neutral"),
  normals: async () => {
    const out = [];
    for (const [name, kind] of [["horse-gallop-pose-aligned", "character"], ["jockey-crouch-aligned", "character"], ["horse-2", "character"], ["combo-1", "character"]]) {
      out.push(await run("/normal-map", { image: b64img(`raw/rig/${name}.png`), mode: "pro", kind }, `raw/rig/normal-${name}`));
    }
    return { files: out.flatMap((o) => o.files), response: {} };
  },
};
const v = process.argv[2];
const r = await jobs[v]();
console.log(v, r.files.length, JSON.stringify(r.job?.usage ?? r.response.usage));
// (appended) neutral-stance edit + normal maps — run: node gen-rig-src.mjs neutral|normals
