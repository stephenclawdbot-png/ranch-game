// Women riders (graphics round 2): a female variant of every keyed rider strip, edited with
// PixelLab from the existing frames so the animation timing, the poses and the key colours stay
// identical. Per strip, each frame's rider is cropped (64x64 around the cap, the back and the
// torso), all crops go to edit-animation-v2 in one request (consistent across frames) with the
// strip's own key colours plus three lime HAIR keys as the target palette, and
// art-src/process_female_riders.py pastes the rider pixels back into a copy of the strip.
//   node art-src/gen-female-riders.mjs [strip ...]   -> art-src/raw/riders/<strip>-<seed>-N.png
import { execFileSync } from "node:child_process";
import { run } from "./pixellab.mjs";

export const EDIT =
  "turn the jockey into a woman jockey: a slightly slimmer, narrower back and shoulders, and a ponytail of bright lime green hair hanging from under the back of the cap down to the shoulders; keep the pose, the cap, the silks colours, the goggles, the hands and the whole horse exactly the same";
export const HAIR_KEYS = ["#3f8f1a", "#6fcf2f", "#a8f060"];
export const STRIPS = {
  "race/horse-gallop": 12,
  "race/horse-idle": 14,
  "race/horse-break": 8,
  "race/horse-drive": 12,
  "race/horse-lunge": 6,
  "race/horse-easeup": 13,
  "race/horse-celebrate": 11,
  "race/horse-pullup": 10,
  "diorama/horse-canter": 12,
  "diorama/horse-walk-jockey": 8,
};

if (process.argv[1]?.endsWith("gen-female-riders.mjs")) {
  const only = process.argv.slice(2);
  const names = only.length ? only : Object.keys(STRIPS);
  await Promise.all(
    names.map(async (name, i) => {
      // crops (and their colours) from the shared Python helper
      const out = execFileSync("python3", ["-I", "art-src/process_female_riders.py", "--crops", name], { encoding: "utf8", maxBuffer: 64 << 20 });
      const { frames, colours, size } = JSON.parse(out);
      const seed = 7701 + Object.keys(STRIPS).indexOf(name);
      const palette = [...new Set([...colours, ...HAIR_KEYS])];
      try {
        const r = await run(
          "/edit-animation-v2",
          {
            description: EDIT,
            frames: frames.map((b64) => ({ image: { type: "base64", base64: b64, format: "png" }, size: { width: size, height: size } })),
            image_size: { width: size, height: size },
            seed,
            no_background: true,
            target_palette: palette.length <= 64 ? { colors: palette } : { max_colors: 64 },
          },
          `art-src/raw/riders/${name.replace("/", "--")}-${seed}`,
        );
        console.log(name, r.files.length, palette.length);
      } catch (e) {
        console.log(name, "FAILED", e.message.slice(0, 400));
      }
    }),
  );
}
