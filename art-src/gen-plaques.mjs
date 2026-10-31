// Trophy Room plaques: one brass plaque per achievement (game-core social.ts ACHIEVEMENTS), each
// engraved with its own emblem (generate-image-v2, 48x48, 25 options per call), styled on the old
// shared plaque (raw/plaques/style-old-plaque.png, cut from diorama/trophies.png) so the shelf
// still reads as one set.
//   node art-src/gen-plaques.mjs [id ...]   -> art-src/raw/plaques/<id>-<seed>-N.png
import { run, b64img } from "./pixellab.mjs";

const STYLE =
  "a small polished brass achievement plaque mounted on a dark oak board, seen from the front, the emblem raised in relief on the brass, warm lamplight glint, high-res pixel art, selective dark outline, transparent background, no text";

export const PLAQUES = {
  first_race: "emblem: a little starting gate with open doors",
  first_win: "emblem: a winner's rosette with ribbons",
  ten_wins: "emblem: a ring of ten small stars around a horseshoe",
  photo_win: "emblem: two horse heads nose to nose",
  graded_win: "emblem: a single large five-pointed star",
  g1_win: "emblem: a royal crown above a horseshoe",
  first_foal: "emblem: a small foal standing on long legs",
  bred_b: "emblem: a young oak sapling with three leaves",
  bred_a: "emblem: a horse head with a bright star on its forehead",
  bred_s: "emblem: a winged horse rearing",
  cup_regular: "emblem: a pocket stopwatch",
  cup_top10: "emblem: a small cup inside a laurel wreath",
  promoted: "emblem: a bold upward chevron arrow",
  final_win: "emblem: a large two-handled championship cup",
  hall_of_fame: "emblem: a classical column wrapped in laurel",
  carer: "emblem: a grooming brush and a small heart",
  stable_steps: "emblem: an old iron key",
};

const STYLE_IMAGE = "art-src/raw/plaques/style-old-plaque.png";
const only = process.argv.slice(2);
const ids = only.length ? only : Object.keys(PLAQUES);
const seed0 = Number(process.env.SEED ?? 9901);
const LIMIT = 4;
let next = 0;
async function worker() {
  while (next < ids.length) {
    const id = ids[next++];
    const seed = seed0 + Object.keys(PLAQUES).indexOf(id);
    try {
      const r = await run(
        "/generate-image-v2",
        {
          description: `${STYLE}, ${PLAQUES[id]}`,
          image_size: { width: 48, height: 48 },
          no_background: true,
          seed,
          style_image: { image: b64img(STYLE_IMAGE), size: { width: 45, height: 34 } },
          style_options: { color_palette: true, outline: true, detail: false, shading: true },
        },
        `art-src/raw/plaques/${id}-${seed}`,
      );
      console.log(id, seed, r.files.length);
    } catch (e) {
      console.log(id, "FAILED", e.message.slice(0, 400));
    }
  }
}
await Promise.all(Array.from({ length: LIMIT }, worker));
