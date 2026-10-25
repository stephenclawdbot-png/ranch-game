// HD v2 rig sources (256x192): neutral-stance horse with/without jockey, separated layers.
//   node art-src/gen-hd-rig.mjs combo <seed...> | horse <seed...> | split <combo.png> <name>
import { run, b64img } from "./pixellab.mjs";
const OUT = "art-src/raw/rig-hd";
const HORSE = "bay coat (rich reddish brown with warm golden highlights and defined muscles), black mane, black tail and black lower legs";
const STANCE = "standing still in a neutral extended stance, all four legs straight and clearly separated with visible gaps between every leg, forelegs apart and hind legs apart, hooves on one flat ground line, neck forward, tail hanging relaxed";
const STYLE = "game sprite, high-res HD pixel art with fine detail, clean selective dark outline, rich shading, light from the right, transparent background";
const [mode, ...a] = process.argv.slice(2);
if (mode === "combo" || mode === "horse") {
  await Promise.all(a.map(async (seed) => {
    const description = mode === "combo"
      ? `detailed side view, facing right, a thoroughbred racehorse ${STANCE}, ${HORSE}, small racing saddle on a white saddle cloth, a jockey crouched in racing position on top with short stirrups, flat bright magenta silks body, cyan sleeves, magenta cap with peak, goggles, white breeches, black boots, ${STYLE}`
      : `detailed side view, facing right, a riderless thoroughbred racehorse ${STANCE}, ${HORSE}, small racing saddle on a white saddle cloth, no rider, ${STYLE}`;
    const r = await run("/generate-image-v2", { description, image_size: { width: 256, height: 192 }, no_background: true, seed: Number(seed) }, `${OUT}/${mode}-${seed}`);
    console.log(mode, seed, r.files);
  }));
} else if (mode === "split") {
  const [src, name] = a;
  const img = { image: b64img(src), width: 256, height: 192 };
  await Promise.all([
    run("/edit-images-v2", { method: "edit_with_text", edit_images: [img], image_size: { width: 256, height: 192 }, description: "remove the horse completely, keep only the jockey exactly as drawn in the same position, size and pose, crouched with knees bent and hands forward holding the reins, transparent background", no_background: true, seed: 12001 }, `${OUT}/${name}-jockey`),
    run("/edit-images-v2", { method: "edit_with_text", edit_images: [img], image_size: { width: 256, height: 192 }, description: "remove the jockey rider completely, keep the horse, saddle and saddle cloth exactly as drawn in the same position and size, fill the horse's back and neck where the rider was", no_background: true, seed: 12002 }, `${OUT}/${name}-horse`),
  ]).then((rs) => console.log(rs.map((r) => r.files)));
}
