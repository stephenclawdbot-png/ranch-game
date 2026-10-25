// HD v2 racehorse: base frames at 256x160, then 12-frame gallop with animate-with-text-v3.
//   node art-src/gen-hd-hero.mjs base <seed...>      -> raw/hd/base-<seed>-0.png
//   node art-src/gen-hd-hero.mjs anim <base.png> <seed> <name> [frames]
import { run, b64img } from "./pixellab.mjs";
const OUT = "art-src/raw/hd";
const DESC = "detailed side view of a thoroughbred racehorse galloping at full stretch facing right, the horse fills the whole width of the image, bay coat (rich reddish brown with warm golden highlights and defined muscles), black mane, black flowing tail and black lower legs, small white saddle cloth, a jockey crouched low over the withers in racing position with short stirrups, jockey silks: flat bright magenta body with cyan sleeves, magenta cap with peak, white breeches, black boots, goggles, holding the reins forward; game sprite, high-res HD pixel art with fine detail, clean selective dark outline, rich shading, golden-hour light from the right";
const [mode, ...a] = process.argv.slice(2);
if (mode === "base") {
  await Promise.all(a.map(async (seed) => {
    const r = await run("/generate-image-v2", { description: DESC, image_size: { width: 224, height: 140 }, no_background: true, seed: Number(seed) }, `${OUT}/base224-${seed}`);
    console.log(seed, r.files, JSON.stringify(r.job?.usage));
  }));
} else if (mode === "anim") {
  const [base, seed, name, frames = "12"] = a;
  const r = await run("/animate-with-text-v3", {
    first_frame: b64img(base),
    action: "racehorse galloping at full speed, one complete gallop stride cycle, legs reach and gather, jockey stays crouched, seamless loop, stays in place",
    frame_count: Number(frames), seed: Number(seed), no_background: true,
  }, `${OUT}/anim-${name}`);
  console.log(name, r.files.length, JSON.stringify(r.job?.usage));
}
