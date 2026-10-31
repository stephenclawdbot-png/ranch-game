// Graphics round 2, the small pieces (generate-image-v2):
//   icons     one 32 px icon per meaning that used to share horseshoe / stopwatch / shield /
//             ticket, styled on the existing icon set (icon-horseshoe.png as style image)
//   vignettes empty states that borrowed a news picture (64 px, same recipe as gen-vignettes.mjs)
//   trainers  three Story trainers repainted in period dress (128 px, as gen-trainers.mjs)
//   node art-src/gen-round2.mjs icons|vignettes|trainers [id ...]
import { run, b64img } from "./pixellab.mjs";

const ICON_STYLE =
  "small game UI icon, single object centred, chunky readable pixel art with dark ink outline, warm racing-club palette: deep racing green, warm cream, brass gold, oxblood red, ink black, transparent background, no text";
export const ICONS2 = {
  "stall-empty": "an empty wooden stable stall with its half door open and golden straw on the floor",
  telephone: "a black 1920s candlestick telephone with brass trim and an earpiece on a hook",
  "race-diary": "a brown leather diary book with a gold horseshoe on the cover and a red ribbon bookmark",
  "results-board": "a small green wooden results board on two legs with three empty white number slots",
  "record-plaque": "a brass record plaque with a small clock face and a laurel sprig",
  licence: "a folded cream licence card with a red wax crest stamp and a small photo square",
  "purse-lock": "a brown leather coin purse fastened with a small brass padlock",
  "wax-seal": "a cream envelope closed with a round red wax seal",
  invitation: "a cream invitation card with gold edges tucked in an envelope with a green ribbon",
  "stalls-empty": "an empty green racecourse starting stall with both front gates open",
  "race-clock": "a round brass racecourse clock on a short green post",
  "training-chart": "a wooden clipboard holding a training chart with a red tick and a small horseshoe clip",
  "cap-peg": "an empty wooden coat peg with a jockey's silk cap hanging on it",
  "door-key": "an old brass door key with a green paper tag",
  "lead-rope": "a coiled lead rope with a brass clip",
  "sale-board": "a small wooden auction lot board on a stand with a gavel resting on it",
};

const VIG_STYLE =
  "tiny square pixel art vignette, a little framed scene with a thin dark wood border, warm golden-hour light, racing-club palette of deep racing green, warm cream, brass gold and oxblood red, clear readable silhouette at small size, high-res pixel art, selective dark outline, no text";
export const VIGNETTES2 = {
  "empty-bench": "an empty wooden bench in a jockeys' weighing room under a row of bare coat pegs, one forgotten silk cap on the bench",
  "sale-closed": "the closed double doors of an old auction house with a small brass padlock and a lantern beside them",
  "lost-race": "a crumpled racecard lying on the grass beside a brass magnifying glass, an empty white racecourse rail behind",
};

const TR_STYLE =
  "detailed HD character portrait bust, head and shoulders, three-quarter view, cropped at the chest, warm golden-hour light from the left, high-res pixel art, selective dark outline, rich shading, transparent background, 1920s period clothing";
export const TRAINERS2 = {
  "house-larkspur":
    "Cass Lark, a cheerful young woman racehorse trainer in her twenties, freckles, chestnut hair in a 1920s bob under a royal blue felt cloche hat with a white star pin, big friendly grin, royal blue tweed riding jacket over a cream knitted jumper",
  "house-saltmarsh":
    "Jory Salt, a rugged weatherbeaten Cornish racehorse trainer man in his fifties, salt-and-pepper beard, squinting into the wind, navy wool flat cap, a sky blue and white striped fisherman's smock under a heavy navy reefer jacket",
  "house-kestrel":
    "Rhea Kestrel, a sharp fast-talking woman racehorse trainer in her forties, Black, dark skin, sleek 1920s finger-waved short hair, gold hoop earrings, knowing smirk, purple tailored tweed riding jacket with a yellow diamond-pattern silk scarf",
};

const JOBS = {
  icons: (id, seed) => ({
    req: {
      description: `${ICON_STYLE}, ${ICONS2[id]}`,
      image_size: { width: 32, height: 32 },
      no_background: true,
      seed,
      style_image: { image: b64img("apps/web/public/art/ui/icon-horseshoe.png"), size: { width: 32, height: 32 } },
      style_options: { color_palette: true, outline: true, detail: true, shading: true },
    },
    dir: "ui2",
    list: ICONS2,
  }),
  vignettes: (id, seed) => ({
    req: {
      description: `${VIG_STYLE}, ${VIGNETTES2[id]}`,
      image_size: { width: 64, height: 64 },
      no_background: false,
      seed,
      style_image: { image: b64img("art-src/raw/vignettes/photo-finish-9803-5.png"), size: { width: 64, height: 64 } },
    },
    dir: "vignettes",
    list: VIGNETTES2,
  }),
  trainers: (id, seed) => ({
    req: {
      description: `${TR_STYLE}, ${TRAINERS2[id]}`,
      image_size: { width: 128, height: 128 },
      no_background: true,
      seed,
      style_image: { image: b64img("apps/web/public/art/portraits/mentor-wilf.png"), size: { width: 128, height: 128 } },
      style_options: { color_palette: false, outline: true, detail: true, shading: true },
    },
    dir: "trainers",
    list: TRAINERS2,
  }),
};
const SEED0 = { icons: 9601, vignettes: 9881, trainers: 9351 };

if (process.argv[1]?.endsWith("gen-round2.mjs")) {
  const [kind, ...only] = process.argv.slice(2);
  const list = JOBS[kind]("x", 0).list;
  const ids = only.length ? only : Object.keys(list);
  const seed0 = Number(process.env.SEED ?? SEED0[kind]);
  await Promise.all(
    ids.map(async (id) => {
      const seed = seed0 + Object.keys(list).indexOf(id);
      const { req, dir } = JOBS[kind](id, seed);
      try {
        const r = await run("/generate-image-v2", req, `art-src/raw/${dir}/${id}-${seed}`);
        console.log(kind, id, r.files.length);
      } catch (e) {
        console.log(kind, id, "FAILED", e.message.slice(0, 400));
      }
    }),
  );
}
