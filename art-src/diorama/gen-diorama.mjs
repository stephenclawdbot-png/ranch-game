// HD-2D diorama layers: raw PixelLab generations for the <Diorama> scenes.
//   node art-src/diorama/gen-diorama.mjs <job> [<job> ...]     (raw -> art-src/diorama/raw/<job>-N.png)
//   node art-src/diorama/gen-diorama.mjs --list
// The API key is read by ../pixellab.mjs from ~/.config/pixellab/key (never written anywhere).
// Every call is appended to art-src/generation-log.jsonl (endpoint, usage) by pixellab.mjs.
import { existsSync } from "node:fs";
import { run, b64img } from "../pixellab.mjs";

const OUT = "art-src/diorama/raw";
const STYLE =
  "high-res HD pixel art with fine detail and many small pixels, crisp hand-pixelled look, selective dark outlines, rich shading, warm golden-hour English racing palette: honey sunlight, red brick, deep greens, cream";
const yardRef = "apps/web/public/art/scenes/stable-yard.png";
const barnRef = "apps/web/public/art/scenes/barn-interior.png";
const styleOf = (file, w = 688, h = 288) =>
  existsSync(file)
    ? { style_image: { image: b64img(file), size: { width: w, height: h }, usage_description: "match this pixel art style, pixel density, palette and golden-hour lighting" } }
    : {};
const img = (description, w, h, seed, { opaque = false, ref = yardRef } = {}) => ({
  ep: "/generate-image-v2",
  body: { description: `${description}, ${STYLE}`, image_size: { width: w, height: h }, seed, no_background: !opaque, ...(ref ? styleOf(ref) : {}) },
});
const anim = (first, action, frames, seed) => ({
  ep: "/animate-with-text-v3",
  body: () => ({ first_frame: b64img(first), action, frame_count: frames, seed, no_background: true }),
});

export const JOBS = {
  // ---- yard (Home) -------------------------------------------------------------------
  "yard-stables": img(
    "a long single-storey red-brick racehorse stable block seen straight from the front as a flat facade, grey slate roof, a row of stable doorways each with a closed green wooden lower half-door and a completely black empty open top half with no horse, a tall central brick archway with a small white clock tower and weathervane above it, hanging flower baskets between the doors, ivy on the corners, side view front elevation, game background layer, transparent background around the building",
    688, 256, 21001),
  "yard-ground": img(
    "flat cobblestone stable yard floor seen from a low angle, rounded honey and grey cobbles in neat rows, mossy gaps between the stones, a few wisps of straw, warm golden-hour light, the cobbles fill the entire image edge to edge, no walls, no objects, no sky",
    688, 160, 21002, { opaque: true }),
  "yard-props": img(
    "stable yard props in a row on a transparent background: two stacked golden hay bales, a wooden water trough, a wooden wheelbarrow full of straw, a half wine barrel planter with red geraniums, a metal bucket, side view game sprites, each prop separate",
    384, 128, 21003),
  "yard-trees": img(
    "a dense row of tall mature English trees, oaks and limes with full rounded canopies, deep green leaves lit gold at the top from the low sun, seen from the side at a distance, no ground, no buildings, transparent background",
    688, 224, 21004),
  // ---- shared foreground framing (drawn out of focus) ---------------------------------
  "fg-branch": img(
    "a leafy oak branch hanging down into the frame from the top left corner, clusters of oak leaves, dark green with golden rim light on the leaf edges, transparent background",
    256, 192, 21011),
  "fg-grass": img(
    "a long low strip of tall meadow grass and wildflowers seen up close at ground level: green and golden grass blades, buttercups, daisies and clover, side view, transparent background",
    512, 112, 21012),
  // ---- paddock -----------------------------------------------------------------------
  "paddock-pavilion": img(
    "a Victorian racecourse weighing room pavilion seen from the front: red brick with cream stone trim, a white veranda with iron columns, a central gable with a small clock cupola, flower boxes, bunting flags, side view front elevation, transparent background",
    384, 256, 21021),
  // ---- barn --------------------------------------------------------------------------
  "barn-wall": img(
    "the interior back wall of a cosy wooden racehorse barn seen straight-on: warm oak plank wall, heavy dark timber beams and posts, two high square windows full of bright golden sunlight, bridles and halters hanging on wooden pegs, a saddle on a rack, a lantern on a hook, flat front elevation, no floor, no stalls, the wall fills the whole image",
    688, 288, 21031, { opaque: true, ref: barnRef }),
  "barn-stalls": img(
    "a row of three wooden horse stall fronts in a barn seen straight-on: oak lower doors with diagonal cross braces, black iron bars on the upper halves only at the sides, brass name plates, each stall has a wide completely black empty open top opening in the middle with no horse, side view front elevation, transparent background",
    688, 224, 21032, { ref: barnRef }),
  "barn-floor": img(
    "a barn aisle floor of worn wooden planks scattered with golden straw seen from a low angle, warm lantern light, fills the entire image edge to edge, no walls, no objects",
    688, 128, 21033, { opaque: true, ref: barnRef }),
  "barn-props": img(
    "barn props in a row on a transparent background: a stack of golden hay bales, a wooden feed bin, a hanging brass oil lantern glowing warm, a leather saddle on a wooden saddle rack, a pitchfork leaning, a metal water bucket, side view game sprites, each prop separate",
    384, 128, 21034, { ref: barnRef }),
  // ---- people ------------------------------------------------------------------------
  "groom": img(
    "a stable lad groom walking to the right, side view, flat tweed cap, white shirt with rolled sleeves, brown waistcoat, dark trousers and boots, one arm held forward holding a lead rope, full body game sprite, transparent background",
    80, 128, 21041, { ref: null }),
  "groom-hd": img(
    "a stable lad groom walking to the right, side view, flat tweed cap, white shirt with rolled sleeves, brown waistcoat, dark trousers and leather boots, one arm held forward holding a lead rope, full body game sprite filling the full height of the image, transparent background",
    96, 176, 21042, { ref: null }),
  // ---- stall horses that lean OUT over the half-door (owner: "make the body visible") ---
  "stall-horse": img(
    "a bay thoroughbred racehorse in a stable stall leaning its head and long neck out over a half-door, seen from the front three-quarter view facing left, head, full arched neck, chest and shoulders visible, withers and back receding into the stall behind, white blaze, ears pricked, leather halter, no door drawn, the chest reaches the bottom edge, transparent background",
    112, 128, 21061, { ref: null }),
  "stall-interior": img(
    "the inside of an empty horse stall seen straight through its open top door: dim wooden back wall with planks, a full hay net hanging on the wall, deep golden straw bedding at the bottom, a warm shaft of light falling in from a small high window on the right, cosy depth, the interior fills the whole image, no horse, no door frame",
    96, 96, 21062, { opaque: true, ref: barnRef }),
  // ---- animations (first frames come from existing approved art) --------------------
  "anim-walk-jockey": anim("art-src/raw/rig-hd/horse-jockey-neutral-256.png",
    "racehorse walking calmly at a slow four-beat walk in the parade ring, legs step one at a time, head nods gently with each step, jockey sits upright and still, one complete walk cycle, seamless loop, stays in place", 8, 21051),
  "anim-walk-led": anim("art-src/raw/rig-hd/horse-neutral-stance-256.png",
    "saddled racehorse walking calmly at a slow four-beat walk, legs step one at a time, head nods gently with each step, tail swings softly, one complete walk cycle, seamless loop, stays in place", 8, 21052),
  "anim-head-bay": anim("apps/web/public/art/portraits/horse-bay.png",
    "the horse looking out over a stable door slowly turns its head to the left and back, ears flick forward, blinks, gentle breathing, seamless loop", 8, 21053),
  "anim-head-chestnut": anim("apps/web/public/art/portraits/horse-chestnut.png",
    "the horse looking out over a stable door lowers its head a little and nods, ears swivel, blinks, gentle breathing, seamless loop", 8, 21054),
  "anim-groom": anim("art-src/diorama/raw/groom-0.png",
    "the stable lad walks steadily to the right at a calm pace, arms swing gently, one complete walk cycle, seamless loop, stays in place", 8, 21056),
  "anim-groom-hd": anim("art-src/diorama/raw/groom-hd-0.png",
    "the stable lad walks steadily to the right at a calm pace, arms swing gently, one complete walk cycle, seamless loop, stays in place, keep the same size", 8, 21057),
  "anim-stall-horse": anim("art-src/diorama/raw/stall-horse-3.png",
    "the horse leaning over the stable door slowly turns its head towards the viewer and back, ears flick forward and back, blinks, soft breathing in the chest, body stays in place, seamless loop", 8, 21063),
  "anim-aisle-idle": anim("art-src/raw/rig-hd/horse-standing-alt-256.png",
    "horse standing cross-tied in a barn aisle, idle: shifts its weight from one hind leg to the other, swishes its tail, flicks its ears, turns its head slightly towards the viewer and back, feet stay planted, seamless loop", 8, 21064),
  "anim-groom-brush": anim("art-src/diorama/raw/groom-hd-0.png",
    "the stable lad stops and stands still facing right, grooming a horse with a body brush held in his raised right hand, brushing in slow strokes, feet planted, seamless loop, keep the same size", 8, 21065),
  "anim-head-grey": anim("apps/web/public/art/portraits/horse-grey.png",
    "the horse looking out over a stable door slowly turns its head to the left and back, ears flick, blinks, gentle breathing, seamless loop", 8, 21055),
};

const names = process.argv.slice(2);
if (names[0] === "--list") {
  console.log(Object.keys(JOBS).join("\n"));
} else {
  await Promise.all(
    names.map(async (n) => {
      const j = JOBS[n];
      if (!j) return console.log(n, "unknown job");
      try {
        const body = typeof j.body === "function" ? j.body() : j.body;
        const r = await run(j.ep, body, `${OUT}/${n}`);
        console.log(n, r.files.length, JSON.stringify(r.job?.usage ?? r.response.usage));
      } catch (e) {
        console.log(n, "FAILED", e.message.slice(0, 400));
      }
    }),
  );
}
