// Racecourse scenery for the Trackside view (one set per `CourseScenery` in
// packages/game-core/src/courses.ts): far layers, midground sprites, rail decor and a
// grandstand per course. Raw PixelLab generations land in art-src/course/raw/<job>-N.png;
// art-src/course/finish-course.py turns them into apps/web/public/art/course/*.png.
//   node art-src/course/gen-course.mjs <job> [<job> ...]
//   node art-src/course/gen-course.mjs --list
// The API key is read by ../pixellab.mjs from ~/.config/pixellab/key (never written anywhere).
// Parkland (Ashcombe) keeps the original race art (far-hills, oaks, poplars, grandstand).
import { existsSync } from "node:fs";
import { run, b64img } from "../pixellab.mjs";

const OUT = "art-src/course/raw";
const HD = "HD pixel art with fine detail and many small pixels";
const STYLE_HINT =
  "high-res pixel art, crisp hand-pixelled look, selective dark outlines, rich shading, warm golden-hour English racecourse palette: honey sunlight, deep greens, cream";
// Style references (approved art): the far-hills raw for far layers, the oak / grandstand for
// sprites. Style only, never subject or framing.
const FAR_REF = ["art-src/raw/scene/hd-far-hills-3-0.png", 688, 224];
const TREE_REF = ["apps/web/public/art/race/bb-tree-oak.png", 240, 226];
const STAND_REF = ["apps/web/public/art/race/grandstand.png", 640, 319];
const styleOf = ([file, w, h]) =>
  existsSync(file)
    ? { style_image: { image: b64img(file), size: { width: w, height: h }, usage_description: "match ONLY this pixel art style, pixel density, palette, line weight and golden-hour lighting; draw the new subject described, not this picture's subject" } }
    : {};

const FAR_TAIL =
  "wide side view panorama strip seen from far away, soft hazy aerial perspective, golden-hour light from the right; the landscape fills only the bottom half of the image, the entire upper half is empty plain flat pale cream sky with nothing in it, no clouds, no birds";
const far = (subject, seed) => ({
  ep: "/generate-image-v2",
  body: { description: `${subject}, ${FAR_TAIL}, ${HD}, ${STYLE_HINT}`, image_size: { width: 688, height: 224 }, seed, no_background: false, ...styleOf(FAR_REF) },
});
const sprite = (subject, w, h, seed, ref = TREE_REF) => ({
  ep: "/generate-image-v2",
  body: { description: `${subject}, side view game sprite, ${HD}, ${STYLE_HINT}, transparent background`, image_size: { width: w, height: h }, seed, no_background: true, ...styleOf(ref) },
});
const STAND_TAIL = "seen from the racetrack side as a flat side elevation, the whole building in view standing on a flat ground line, packed crowd of racegoers in the seats";

export const JOBS = {
  // ---- chalk downs (Kestrel Downs) -----------------------------------------------------
  "far-downs": far(
    "rolling English chalk downland: smooth round grassy whale-backed hills, a huge white chalk horse figure cut into the turf on the side of the biggest hill, small beech copses on the hilltops, pale chalk tracks, sheep dots",
    31001,
  ),
  "mid-hawthorn": sprite("a single windswept hawthorn tree on the chalk downs, bent and leaning to the left by the wind, dense dark green crown, twisted grey trunk", 200, 200, 31011),
  "mid-gorse": sprite("a low round gorse bush covered in bright yellow flowers, spiky dark green", 120, 72, 31012),
  "stand-downs": sprite(`a small country racecourse grandstand: white painted weatherboard and flint walls, a green corrugated tin roof, one tier of wooden benches, a little weather vane, ${STAND_TAIL}`, 512, 256, 31021, STAND_REF),
  // ---- coastal (Saltmarsh) -------------------------------------------------------------
  "far-coast": far(
    "the open sea seen from the shore: a calm blue-green sea filling the band to a perfectly straight flat horizon, a white lighthouse on a low grassy headland on the left, a distant sailing boat, a strip of golden sand dunes and saltmarsh creeks along the bottom edge",
    31002,
  ),
  "mid-dunes": sprite("a long low sand dune covered in tufts of pale green marram grass, golden sand, a few wooden fence posts, wide and low", 384, 112, 31013),
  "mid-huts": sprite("a row of five colourful wooden seaside beach huts with pitched roofs, pastel blue, yellow, red, mint and white stripes, standing on sand", 384, 128, 31014),
  "stand-coast": sprite(`an Art Deco seaside racecourse grandstand: white rendered walls with sea-blue trim, curved streamline balconies, a flat roof with flagpoles and pennants, porthole windows, ${STAND_TAIL}`, 640, 320, 31022, STAND_REF),
  // ---- city (Bellmont) -------------------------------------------------------------------
  "far-city": far(
    "a distant city skyline: tall office towers, a grand domed cathedral, a Victorian clock tower, church spires, rows of rooftops and chimneys, two construction cranes, a few lit windows",
    31003,
  ),
  "mid-terrace": sprite("a long row of tall Victorian red brick city terrace houses and a corner pub with shop fronts, slate roofs, chimney pots, sash windows lit warm, flat front elevation", 640, 256, 31015),
  "mid-lamp": sprite("a single tall black cast iron Victorian street lamp post with a glowing lantern", 40, 160, 31016),
  "stand-city": sprite(`a big modern city racecourse grandstand of steel and glass: three tiers of seating under a sweeping white cantilever roof, glass-fronted hospitality boxes, a large blank video screen on the side, ${STAND_TAIL}`, 640, 320, 31023, STAND_REF),
  "rail-boards": sprite("a long low row of plain racecourse trackside advertising boards on short legs, alternating racing green, cream, brass yellow and oxblood red panels with simple blank white stripes, no letters, no text, flat front elevation", 384, 48, 31031, STAND_REF),
  // ---- meadow (Larkspur) -----------------------------------------------------------------
  "far-meadow": far(
    "gentle low English meadow hills covered in wildflowers: patches of red poppies, yellow buttercups and purple cornflowers, soft hedgerows, a white windmill with sails on a low rise, a thatched cottage, warm summer haze",
    31004,
  ),
  "mid-willow": sprite("a single large weeping willow tree with long drooping pale green branches lit gold, thick trunk", 240, 240, 31017),
  "mid-flowers": sprite("a long low strip of wildflower meadow seen from the side: tall grasses, red poppies, white ox-eye daisies, blue cornflowers and yellow buttercups, wide and low", 384, 96, 31018),
  "stand-meadow": sprite(`a summer country racecourse enclosure: a small thatched wooden pavilion with a veranda flanked by two striped cream and green marquee tents with bunting, ${STAND_TAIL}`, 640, 288, 31024, STAND_REF),
  // ---- moorland (Harrowgate) -------------------------------------------------------------
  "far-moor": far(
    "bleak upland moorland: long sweeping purple and russet heather moors rising to jagged grey granite tors and rocky crags, a lonely stone farmhouse, dry-stone walls climbing the slopes, brooding",
    31005,
  ),
  "mid-wall": sprite("a long straight dry-stone wall of stacked grey and brown flat stones with moss and a few tufts of grass, wide and low, no gate", 384, 64, 31019),
  "mid-heather": sprite("a low wide clump of purple flowering heather and brown bracken on a mossy bank, wide and low", 256, 80, 31020),
  "mid-rowan": sprite("a single small windswept moorland rowan tree leaning right, sparse crown with clusters of red berries, gnarled trunk growing from rocks", 180, 200, 31026),
  "stand-moor": sprite(`a sturdy old northern racecourse grandstand built of dark grey millstone grit stone with a grey slate roof, arched openings, tall chimneys, a stone clock gable, ${STAND_TAIL}`, 640, 320, 31025, STAND_REF),
};

const names = process.argv.slice(2);
if (names[0] === "--list") {
  console.log(Object.keys(JOBS).join("\n"));
} else {
  await Promise.all(
    names.map(async (n) => {
      const j = JOBS[n];
      if (!j) return console.log(n, "unknown job");
      const seed = process.env.SEED ? Number(process.env.SEED) : null;
      const body = seed ? { ...j.body, seed } : { ...j.body };
      // NOREF=1: no style image (on wide far layers the reference can ghost its own
      // composition into the upper half of the picture).
      if (process.env.NOREF) delete body.style_image;
      const tag = `${n}${seed ? `-s${seed}` : ""}${process.env.NOREF ? "-noref" : ""}`;
      try {
        const r = await run(j.ep, body, `${OUT}/${tag}`);
        console.log(tag, r.files.length, JSON.stringify(r.job?.usage ?? r.response.usage));
      } catch (e) {
        console.log(tag, "FAILED", e.message.slice(0, 400));
      }
    }),
  );
}
