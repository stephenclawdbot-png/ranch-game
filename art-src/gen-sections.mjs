// Section scenes: one wide golden-hour backdrop per game section that used to borrow another
// page's diorama (generate-image-v2, 688x288, styled on the paddock diorama poster so they sit
// with the living scenes). Served as scenes/<id>.png; the page kit shows them at integer scale.
//   node art-src/gen-sections.mjs [id ...]   -> art-src/raw/sections/<id>-<seed>-0.png
import { run, b64img } from "./pixellab.mjs";

const STYLE =
  "wide side-on pixel art scene, HD-2D diorama look, warm golden-hour English racing world, honey sunlight, long soft shadows, deep greens and warm browns, rich detail, high-res pixel art, selective dark outline, no text, no letters";

export const SECTIONS = {
  "club-lawn":
    "the members' lawn of an old English racing club: a white Georgian clubhouse with dark green awnings and a clock above the door, a big wooden league table board with brass name plates on the lawn, members in tweed chatting with glasses, hanging flower baskets, bunting",
  "winners-enclosure":
    "the winners' enclosure at an English racecourse: a gleaming gold cup trophy on a table draped in green velvet with rosettes, a bay racehorse wearing a garland of flowers held by a groom, a jockey in silks patting its neck, a crowd clapping behind white rails, bunting",
  "weighing-room":
    "interior of an old jockeys' weighing room at an English racecourse: rows of colourful racing silks hanging on wooden pegs along the wall, saddles on wooden racks, a big brass weighing scale with a round dial, riding boots and helmets on a bench, tall windows with sunbeams",
  "stud-dawn":
    "a misty spring dawn on a stud farm: mares with young foals grazing in a dewy paddock behind white post-and-rail fencing, an old red-brick foaling barn with a weathervane, cherry blossom trees, low sun glowing through the mist",
  "hall-of-fame":
    "a grand oak-panelled hall of fame inside a Victorian racecourse: gilt-framed oil paintings of champion racehorses on the walls, polished brass plaques, a marble horse statue on a plinth, a red carpet runner, a tall stained-glass window, warm chandelier light",
  "press-room":
    "the press room of an old English racecourse: journalists at desks with typewriters and telephones, a large chalkboard of race results, racing newspapers pinned to a cork board, a big window overlooking the racetrack and grandstand, warm afternoon light",
  "form-rail":
    "race-goers leaning on the white running rail at an English racecourse studying racecards and looking through binoculars, a chalkboard of the day's tips under a striped awning, the green track and a distant grandstand beyond",
  "foaling-barn":
    "inside a cosy wooden foaling barn: a bay mare and her young foal in a deep golden straw stall, warm lantern light, hay racks and a wooden feed bucket, swallows on the oak beams, sunbeams through a half-door",
  "estate-office":
    "an old estate office in an English racing stable: a big oak desk with an open account ledger, an inkwell and pen, a brass desk lamp, neat stacks of gold coins, framed horse paintings and rosettes on the wall, a window onto the stable yard at golden hour",
  "retirement-meadow":
    "a peaceful retirement farm at sunset: old retired racehorses grazing in a wildflower meadow, a weathered wooden barn, a great old oak tree, rolling hills, long golden shadows, a calm and gentle mood",
  "gallops-morning":
    "racehorses with work riders cantering up a grass gallop on the chalk downs in the early morning, a white rail along the gallop, rolling hills, morning mist, low golden sun, a trainer watching from a landrover",
  "club-library":
    "an old racing club library: tall dark bookshelves full of leather-bound stud books, a reading desk with an open book and a bronze horse statuette, a globe, rolled pedigree charts, a fireplace, warm lamplight",
  "yard-works":
    "a racing stable yard being extended: a new red-brick stable block under wooden scaffolding with ladders, stacks of timber and slates, a wheelbarrow, a curious horse looking out of an old stable door, golden hour",
  "vet-room":
    "a clean whitewashed equine vet room in a racing stable: a kind vet in a green coat gently examining a calm bay horse's foreleg, a groom holding the head collar, shelves of bottles and bandages, a lamp, sunlight from a high window, reassuring mood",
  "grooming-aisle":
    "a stable aisle at golden hour: a groom brushing a gleaming chestnut racehorse tied in the aisle, grooming kit in a wooden box, hay nets, horses looking out of their stalls, dust motes in sunbeams",
  "farrier-forge":
    "a farrier's forge in a racing yard: a farrier in a leather apron fitting a racing plate to a calm horse's hoof, a glowing coal forge, an anvil, horseshoes hanging on the wall, warm firelight",
  "stud-book":
    "a still life on an old oak desk: an open stud book with handwritten pedigree family trees, rolled pedigree charts, a brass magnifying glass, a horseshoe paperweight, an inkwell, warm lamplight, a window onto paddocks",
  "starting-stalls":
    "racehorses with jockeys in colourful silks being loaded into green metal starting stalls on a racecourse, handlers leading them in, the white rail and green turf, a distant grandstand, golden hour",
  // generated at seed 9671 (before starting-stalls moved ahead of it)
  "pedigree-wall":
    "a breeder's study wall: a large hand-drawn pedigree family tree of a racehorse line with small painted horse portraits linked by red threads, a bloodstock sales catalogue on a side table, a desk lamp, warm evening light",
};

const STYLE_IMAGE = "apps/web/public/art/diorama/poster-paddock.png";
const only = process.argv.slice(2);
const ids = only.length ? only : Object.keys(SECTIONS);
const seeds = (process.env.SEEDS ?? "9501").split(",").map(Number);
const jobs = ids.flatMap((id) => seeds.map((s) => [id, s + Object.keys(SECTIONS).indexOf(id) * 10]));
const LIMIT = 8;
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const [id, seed] = jobs[next++];
    try {
      const r = await run(
        "/generate-image-v2",
        {
          description: `${STYLE}, ${SECTIONS[id]}`,
          image_size: { width: 688, height: 288 },
          no_background: false,
          seed,
          style_image: { image: b64img(STYLE_IMAGE), size: { width: 880, height: 360 } },
          style_options: { color_palette: true, outline: true, detail: true, shading: true },
        },
        `art-src/raw/sections/${id}-${seed}`,
      );
      console.log(id, seed, r.files.length);
    } catch (e) {
      console.log(id, seed, "FAILED", e.message.slice(0, 400));
    }
  }
}
await Promise.all(Array.from({ length: LIMIT }, worker));
