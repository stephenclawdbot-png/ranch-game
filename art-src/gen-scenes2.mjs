// Scenes, round 2 (graphics audit round 2): a still scene per page family that still shared a
// backdrop (Profile and My pages, Invite, Pool/Beta, Sponsor, the horse sub-pages, stable
// profiles, onboarding, Bring a rival), Story's band and one scene per Story chapter, the Quick
// races gallops repainted without the motor car, and wiki-only figures and section cards so no
// wiki picture is also a page backdrop. Same recipe as gen-sections.mjs: generate-image-v2,
// 688x288, styled on the paddock diorama poster; 1920s-30s English racing world throughout.
//   node art-src/gen-scenes2.mjs [id ...]   -> art-src/raw/sections/<id>-<seed>-0.png
import { run, b64img } from "./pixellab.mjs";

const STYLE =
  "wide side-on pixel art scene, HD-2D diorama look, warm golden-hour English racing world of the 1920s, period costume, no cars, no modern objects, honey sunlight, long soft shadows, deep greens and warm browns, rich detail, high-res pixel art, selective dark outline, no text, no letters";

export const SCENES2 = {
  // --- page families -------------------------------------------------------------------------
  "story-road":
    "a young racehorse owner and an old trainer leaning on a five-bar gate at sunrise beside their first racehorse, a winding country road leading over the hills towards a distant racecourse grandstand on the horizon, a sense of a long journey ahead",
  "chapter-club":
    "a small village point-to-point race meeting in a farm field: a roped-off grass course, hay bales for seats, a white tea tent, villagers in flat caps and shawls cheering, two racehorses galloping past a hedge, a church spire beyond",
  "chapter-county":
    "a county racecourse on a summer afternoon: a modest wooden grandstand with a striped roof, a bandstand with a brass band, bunting, ladies in summer dresses and men in boaters along the white rail, racehorses cantering to the start",
  "chapter-national":
    "a great national racecourse: a huge Edwardian grandstand packed with thousands of spectators, flags flying on the roof, a wide green straight, a field of racehorses thundering towards the winning post, dramatic sky",
  "chapter-classics":
    "Classic race day on the open downs: a royal box under a striped canopy, gentlemen in top hats and morning coats, ladies in grand hats, a vast crowd on the hill, the field of racehorses sweeping round the famous bend",
  "owners-office":
    "an owner's private office off the tack room: a worn leather armchair, a roll-top desk with a candlestick telephone and a racing calendar, framed racing silks and winner photographs on the panelled wall, saddles on brass pegs, a window onto the yard",
  "club-entrance":
    "the grand wrought-iron gates of a members' racing club at golden hour: stone gateposts with brass lamps, a gravel drive to a white clubhouse, a liveried doorman welcoming guests in tweed who hold cream invitation cards",
  "prize-giving":
    "a prize-giving on a racecourse lawn: a lady in a cloche hat presenting a gleaming silver salver to a delighted owner on a small wooden stage hung with bunting and rosettes, a crowd applauding, a brass band",
  "sponsor-marquee":
    "a large striped green and cream sponsor's marquee at an English racecourse: open sides, a long table with a white cloth, silver ice buckets and tiered cakes, a blank painted banner, guests in boaters, the racecourse rail beyond",
  "grooming-bay":
    "a cobbled grooming bay in a racing yard in the morning: a grey racehorse standing in cross-ties being sponged down by one groom while another combs its mane, steaming water buckets, sponges and brushes on a shelf, sunbeams",
  "trainer-gallops":
    "close view at the top of the training gallops: a trainer in a tweed coat holding a pocket stopwatch and his head lad with binoculars, two racehorses pulling up past them with steaming breath, white marker posts, heathland, early morning sun",
  "trophy-shelf":
    "a polished oak shelf of one racehorse's prizes in a cosy room: silver cups of different sizes, rosettes, a framed photograph of a winner, a racing plate mounted on a small wooden plaque, warm lamplight",
  "logbook-desk":
    "a stable logbook desk by a window: an open handwritten daily log ledger with columns, a fountain pen and blotter, a feed chart pinned on the wall, an oil lamp, a horse looking in through the open top door",
  "stable-arch":
    "the entrance of a racing stable: a red-brick archway with a clock tower and a weathervane, a blank painted wooden sign over the arch, a cobbled yard beyond with horses looking out over green stable doors, golden hour",
  "registration-desk":
    "the racing club secretary's registration office: a big leather registration ledger open on an oak counter, an inkwell and dip pen, a rack of coloured silks swatches and cap samples, a clerk with sleeve garters smiling, sunny window",
  "owners-bar":
    "the members' bar at a racecourse: two rival racehorse owners in tweed suits raising glasses to each other at a polished mahogany bar, framed racehorse paintings, brass rail, a window onto the parade ring",
  "gallops-downs":
    "racehorses with work riders cantering up a grass gallop on the chalk downs in the early morning, a white rail along the gallop, rolling hills, morning mist, low golden sun, a trainer on a grey hack watching beside the rail, no vehicles",
  "saturday-eve":
    "the evening before a big Saturday race in a racing yard: grooms plaiting a racehorse's mane by lantern light, a trainer checking a list, saddles and polished bridles laid out ready, a dusky purple sky, a hopeful quiet mood",
  // --- wiki: section cards -------------------------------------------------------------------
  "wiki-estate-gate":
    "a country lane between hedgerows leading to the stone gateposts of a small racing estate, an open white gate, a stable block and paddocks beyond, a signpost, morning sunshine",
  "wiki-led-out":
    "a stable lad in a flat cap leading a gleaming racehorse out of its stable box into a sunny cobbled yard, a cat asleep on the wall, a water trough",
  "wiki-final-bend":
    "racehorses with jockeys in colourful silks rounding the final bend of a turf racecourse in a tight bunch, white rails, a distant grandstand, clods of turf flying",
  "wiki-mare-foal":
    "a chestnut mare and her young foal standing close together under a big oak tree in a buttercup paddock, the foal nuzzling its mother, gentle afternoon light",
  "wiki-old-champion":
    "an old champion racehorse with a greying muzzle being led by an elderly groom past a wall covered in faded rosettes and old photographs, peaceful mood",
  "wiki-auction-rostrum":
    "an auctioneer in a wing collar raising a wooden gavel at a carved rostrum, bidders in bowler hats and cloche hats on tiered benches, a sale ring rail in front",
  "wiki-trophy-cabinet":
    "a tall glass trophy cabinet in a racing club pavilion full of silver cups, plates and medals, old framed photographs of winners above it, polished floorboards",
  // --- wiki: figures -------------------------------------------------------------------------
  "wiki-estate-map":
    "a hand-painted bird's-eye estate map on old parchment pinned to a wall: a stable yard, barns, paddocks, a lake and a racecourse drawn in watercolour, a compass rose, brass drawing pins",
  "wiki-stable-row":
    "a long row of green stable doors with brass nameplates (blank) and horses of different colours looking out over each door, hanging baskets, a swept brick path",
  "wiki-turnstiles":
    "crowds of 1920s racegoers streaming through the wooden turnstiles and iron gates of a racecourse on race day, flags, a grandstand roof behind",
  "wiki-pavilion":
    "a white wooden racing club pavilion with a clock in the gable and a veranda, members in blazers on deck chairs, a flagpole, a neat lawn",
  "wiki-sales-paddock":
    "young racehorses with lot number cards on their hips being walked round a sales paddock by grooms, buyers in tweed watching and taking notes",
  "wiki-first-horse":
    "a delighted new owner in a tweed jacket patting the neck of their first racehorse held by a smiling groom in a sunny stable yard",
  "wiki-declarations":
    "a racecourse declarations office: a clerk chalking runners onto a big blackboard, owners and trainers queueing at a wooden counter with entry forms",
  "wiki-box-rest":
    "a racehorse resting in a deep golden straw box with a neatly bandaged foreleg, a vet's leather bag on a hay bale, a hay net, quiet evening lamplight",
  "wiki-meeting-day":
    "a busy country racecourse on race day seen from the hill: picnic crowds, white tents, a parade ring, a little grandstand, horses cantering on the far side",
  "wiki-final-furlong":
    "racehorses at full gallop in the final furlong, jockeys crouched low in colourful silks, the white winning post ahead, the crowd a blur behind the rail",
  "wiki-time-trial":
    "a single racehorse and jockey galloping alone past a big ornate racecourse clock on a post, an official with a stopwatch at the rail",
  "wiki-builders-plans":
    "an architect's plan of new stables pinned to a board in a stable yard, a builder in a waistcoat and the trainer pointing at it, timber stacks and bricks",
  "wiki-dictionary":
    "an old leather racing dictionary open on a wooden reading stand, a brass magnifying glass, a riding crop and a folded racecard beside it, warm window light",
  "wiki-stallion-yard":
    "a proud bay stallion being paraded on the stud yard by a stud groom in a bowler hat, a clock tower and a horse chestnut tree behind",
  "wiki-league-board":
    "close view of a brass and oak league table board in a club pavilion with sliding blank name plates and pinned rosettes, a pair of white gloves on the ledge",
  "wiki-yearlings":
    "a group of yearling racehorses playing and cantering together in a big grass paddock, bucking and kicking up their heels, a groom leaning on the gate",
  "wiki-old-friends":
    "two elderly retired racehorses resting their heads on each other's backs under an apple tree in an orchard, a donkey companion grazing nearby, late sun",
  "wiki-bloodlines":
    "a breeder and a vet looking over a broodmare in a stone-walled paddock, the breeder holding an open stud book, a foal peeping from behind its mother, soft morning light",
  "wiki-handshake":
    "two horse dealers in tweed shaking hands over a sale in a stable yard, a small leather purse of coins on a barrel, a groom holding the sold racehorse, an open stable door",
  "wiki-silver-polish":
    "a stable lad in shirtsleeves polishing a row of silver racing cups and plates on a table in a sunny tack room, rosettes pinned to the wall, saddles on racks",
  "wiki-exercise-ring":
    "an exercise ring at a racing yard: horses walking round in a circle with riders in flat caps, the trainer standing in the middle with a notebook, morning",
};

const STYLE_IMAGE = "apps/web/public/art/diorama/poster-paddock.png";
if (process.argv[1]?.endsWith("gen-scenes2.mjs")) {
  const only = process.argv.slice(2);
  const ids = only.length ? only : Object.keys(SCENES2);
  const seeds = (process.env.SEEDS ?? "9401").split(",").map(Number);
  const jobs = ids.flatMap((id) => seeds.map((s) => [id, s + Object.keys(SCENES2).indexOf(id) * 10]));
  const LIMIT = Number(process.env.LIMIT ?? 8);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const [id, seed] = jobs[next++];
      try {
        const r = await run(
          "/generate-image-v2",
          {
            description: `${STYLE}, ${SCENES2[id]}`,
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
  };
  await Promise.all(Array.from({ length: LIMIT }, worker));
}
