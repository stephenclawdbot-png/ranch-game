// Story rival trainers (game-core story.ts RIVAL_STABLES): one PixelLab bust each
// (generate-image-v2, 128 px), styled on Wilf's portrait so the cast reads as one set, dressed
// in their stable's colours.
//   node art-src/gen-trainers.mjs [id ...]   -> art-src/raw/trainers/<id>-<seed>-N.png
import { run, b64img } from "./pixellab.mjs";

const STYLE =
  "detailed HD character portrait bust, head and shoulders, three-quarter view, cropped at the chest, warm golden-hour light from the left, high-res pixel art, selective dark outline, rich shading, transparent background";

export const TRAINERS = {
  "house-harrowgate":
    "Eleanor Harrow, a formidable old-guard English racehorse trainer woman in her seventies, white hair in a tight bun, stern raised eyebrow, pearl earrings, navy blue tweed hunting jacket with gold buttons and a gold silk scarf",
  "house-larkspur":
    "Cass Lark, a cheerful young woman racehorse trainer in her twenties, freckles, messy chestnut hair in a ponytail, big friendly grin, royal blue quilted gilet with a white star pin over a cream jumper, pink woolly hat",
  "house-vicarage":
    "Tom Penrose, a gentle retired country parson turned racehorse trainer in his sixties, bald with white side hair, round spectacles, patient kind smile, emerald green cardigan over a white clerical collar shirt",
  "house-saltmarsh":
    "Jory Salt, a rugged weatherbeaten Cornish racehorse trainer man in his fifties, salt-and-pepper beard, squinting into the wind, sky blue and white striped oilskin fisherman's smock, navy knitted beanie",
  "house-kestrel":
    "Rhea Kestrel, a sharp fast-talking woman racehorse trainer in her forties, Black, dark skin, sleek short undercut hair, gold hoop earrings, knowing smirk, purple leather bomber jacket with yellow diamond trim",
  "house-bellmont":
    "Marcus Bellamy, a charming wealthy racehorse trainer man in his fifties, tanned, silver swept-back hair, perfect white teeth, confident smile, cream linen suit with a red silk tie and red pocket square",
  "house-copperfield":
    "Ada Copperfield, a scholarly bloodline-obsessed racehorse trainer woman in her sixties, South Asian, grey hair in a long plait, half-moon reading glasses on a chain, burnt orange wool coat with a charcoal scarf",
  "house-ashcombe":
    "Lady Helena Ashcombe, an elegant aristocratic champion racehorse trainer woman in her fifties, auburn hair in a chignon, polite serene smile, burgundy tailored riding coat with a grey velvet collar, pearl necklace",
};

const STYLE_IMAGE = "apps/web/public/art/portraits/mentor-wilf.png";
const only = process.argv.slice(2);
const ids = only.length ? only : Object.keys(TRAINERS);
const seed0 = Number(process.env.SEED ?? 9301);
await Promise.all(
  ids.map(async (id) => {
    const seed = seed0 + Object.keys(TRAINERS).indexOf(id);
    try {
      const r = await run(
        "/generate-image-v2",
        {
          description: `${STYLE}, ${TRAINERS[id]}`,
          image_size: { width: 128, height: 128 },
          no_background: true,
          seed,
          style_image: { image: b64img(STYLE_IMAGE), size: { width: 128, height: 128 } },
          style_options: { color_palette: false, outline: true, detail: true, shading: true },
        },
        `art-src/raw/trainers/${id}-${seed}`,
      );
      console.log(id, r.files.length);
    } catch (e) {
      console.log(id, "FAILED", e.message.slice(0, 400));
    }
  }),
);
