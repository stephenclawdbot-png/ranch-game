// Jockey base faces (graphics round 2): the bust is built from layers, so every face is painted
// with KEY colours that the game recolours per jockey:
//   - hair, eyebrows and beards in flat lime green (process_jockeys.py keys them to a hair ramp)
//   - silks: magenta jacket, cyan sleeves, magenta cap (keyed to race/palette.json's silks ramps)
//   - skin painted naturally, keyed to a skin ramp by luminance (and lips to a lip ramp)
// Period kit throughout: 1920s-30s soft silk caps with a short peak (no helmets, no chin straps)
// and loose buttoned silk jackets. generate-image-v2, 128 px, styled on Wilf's portrait.
//
// FACES: id -> [native hair colour, description]. The description says "{hair}" where the hair
// colour goes ("lime green" at generation time). Ids: a* apprentice, j/p* prime, v* veteran;
// the presentation (f/m) is part of the id (woman/girl/f- ids are f).
//   node art-src/gen-jockey-faces.mjs [id ...]   -> art-src/raw/jockeys/<id>-<seed>-N.png
import { existsSync, readFileSync } from "node:fs";
import { run, b64img } from "./pixellab.mjs";

export const KEY_HAIR = "hair, eyebrows and any beard or moustache painted in flat bright lime green as a colour key";
export const SILKS =
  "wearing 1920s racing silks: a loose bright magenta silk jacket with a buttoned collar and bright cyan silk sleeves, a soft bright magenta silk jockey's cap with a short peak, no helmet, no chin strap, white stock tie";
export const STYLE =
  "detailed HD character portrait bust, head and shoulders, three-quarter view facing right, cropped at the chest, warm golden-hour light from the left, high-res pixel art, selective dark outline, rich shading, transparent background, 1920s period portrait";

const BASE_FACES = {
  // ---- the first cast (round 1), repainted in period kit with keyed hair ----
  "a-freckled-lad": ["ginger", "a cheeky freckled teenage apprentice jockey boy, about 17, {hair} hair poking out under the cap, pale skin, wide grin"],
  "a-young-woman-braid": ["dark-brown", "a determined young woman apprentice jockey, about 18, light brown skin, a {hair} braid over the shoulder, focused smile"],
  "a-shy-lad": ["black", "a shy young apprentice jockey boy, about 18, East Asian, a {hair} fringe under the cap, small nervous smile"],
  "a-bright-girl": ["black", "an eager young woman apprentice jockey, about 19, Black, dark brown skin, short {hair} natural hair under the cap, big bright smile"],
  "a-lanky-lad": ["black", "a lanky young apprentice jockey boy, about 19, olive skin, {hair} curly hair, raised eyebrow, cocky smile"],
  "a-blonde-girl": ["blonde", "a young woman apprentice jockey, about 18, fair skin, a {hair} ponytail, rosy cheeks, gap-toothed laugh"],
  "a-quiet-girl": ["black", "a quiet young woman apprentice jockey, about 17, South Asian, light brown skin, {hair} hair in a low bun, shy hopeful smile"],
  "j-calm-man": ["black", "a calm jockey man in his late twenties, South Asian, light brown skin, neat short {hair} beard, steady confident look"],
  "j-sharp-woman": ["auburn", "a sharp jockey woman in her late twenties, white, high cheekbones, {hair} hair tucked under the cap, determined half smile"],
  "j-grinning-man": ["black", "a jovial jockey man around thirty, Black, dark brown skin, clean shaven, broad grin"],
  "j-stern-woman": ["black", "a stern jockey woman around thirty, Latina, tan skin, {hair} hair in a low bun, serious stare"],
  "j-irish-man": ["ginger", "a wiry jockey man around thirty, pale skin, {hair} stubble, twinkling blue eyes, wry smile"],
  "j-moustache-man": ["black", "a dapper jockey man in his thirties, olive skin, thin {hair} moustache, slicked hair, confident smile"],
  "j-kind-woman": ["black", "a friendly jockey woman in her thirties, East Asian, a {hair} bob under the cap, warm smile"],
  "j-scar-man": ["brown", "a tough jockey man in his thirties, white, broken nose, small scar on the chin, narrowed eyes"],
  "j-glasses-woman": ["black", "a thoughtful jockey woman in her thirties, Black, dark skin, round wire spectacles, gentle smile"],
  "j-curly-man": ["black", "a cheerful jockey man in his thirties, Middle Eastern, tan skin, {hair} curly hair, short {hair} beard, laughing"],
  "j-focused-woman": ["black", "a focused jockey woman in her early thirties, Indian, brown skin, nose stud, a long {hair} plait, calm gaze"],
  "j-pale-man": ["blonde", "a quiet jockey man in his thirties, very pale skin, {hair} eyebrows, freckles, serious look"],
  "j-ginger-woman": ["ginger", "a lively jockey woman in her late twenties, pale freckled skin, {hair} hair tucked under the cap, cheeky grin"],
  "v-grey-man": ["grey", "a veteran jockey man in his late forties, white, weathered lined face, {hair} sideburns, crow's feet, knowing smile"],
  "v-silver-woman": ["white", "a veteran jockey woman in her late forties, white, short {hair} hair, laugh lines, proud confident look"],
  "v-craggy-man": ["grey", "a craggy veteran jockey man about fifty, Black, dark skin, short {hair} beard, deep wrinkles, wise calm look"],
  "v-wily-man": ["grey", "a wily veteran jockey man in his late forties, tan skin, hooked nose, {hair} stubble, sly grin"],
  "v-steely-woman": ["grey", "a steely veteran jockey woman about fifty, East Asian, {hair} hair, firm unsmiling mouth"],
  "v-jolly-man": ["white", "a jolly veteran jockey man in his late forties, ruddy round cheeks, {hair} bushy eyebrows, big laugh"],
  "v-wise-woman": ["grey", "a wise veteran jockey woman about fifty, Black, dark brown skin, short {hair} hair at the temples, laugh lines, calm proud smile"],
  // ---- apprentices, boys ----
  "am-jug-ears": ["brown", "a skinny 16-year-old apprentice jockey boy, pale skin, big jug ears, short {hair} hair, gap-toothed grin"],
  "am-dimples": ["black", "a 17-year-old apprentice jockey boy, Black, dark skin, close-cropped {hair} hair, dimples, shy proud smile"],
  "am-cowlick": ["blonde", "a 15-year-old apprentice jockey boy, freckled pale skin, a {hair} cowlick sticking out under the cap, wide eyes, open-mouthed wonder"],
  "am-first-tache": ["black", "an 18-year-old apprentice jockey boy, South Asian, brown skin, neat side-parted {hair} hair, serious dark eyes, a faint first {hair} moustache"],
  "am-black-curls": ["black", "a 17-year-old apprentice jockey boy, Mediterranean olive skin, {hair} curly hair spilling out under the cap, bright cheeky grin"],
  "am-apple-cheeks": ["blonde", "a 16-year-old apprentice jockey boy, ruddy apple cheeks, {hair} straw-like hair, snub nose, laughing"],
  "am-thoughtful": ["black", "an 18-year-old apprentice jockey boy, East Asian, a straight {hair} fringe, calm thoughtful look, slight smile"],
  "am-cocky": ["brown", "a 19-year-old apprentice jockey boy, white, slicked {hair} hair, crooked nose, cocky smirk, one eyebrow raised"],
  "am-gentle": ["brown", "a 17-year-old apprentice jockey boy, light brown mixed-race skin, soft curly {hair} hair, gentle kind eyes, small smile"],
  "am-nervous": ["ginger", "a 15-year-old apprentice jockey boy, very pale skin, {hair} hair, freckles, biting his lip nervously"],
  "am-white-blond": ["blonde", "a 19-year-old apprentice jockey boy, tanned skin, {hair} hair, long thin face, determined frown"],
  "am-toothy": ["black", "a 16-year-old apprentice jockey boy, Black, deep brown skin, big bright eyes, wide toothy smile"],
  "am-mole": ["dark-brown", "an 18-year-old apprentice jockey boy, pale skin, {hair} hair, a mole on his cheek, quiet confident half smile"],
  "am-blue-eyes": ["black", "a 17-year-old Irish apprentice jockey boy, pale skin, {hair} hair, bright blue eyes, rosy nose, mischievous grin"],
  "am-thick-brows": ["black", "an 18-year-old apprentice jockey boy, Middle Eastern, tan skin, thick {hair} eyebrows, short {hair} hair, earnest look"],
  "am-sleepy": ["brown", "a 16-year-old apprentice jockey boy, white, tousled {hair} hair, heavy-lidded sleepy eyes, lopsided smile"],
  "am-black-eye": ["dark-brown", "a 17-year-old apprentice jockey boy, pale skin, a fading bruise under one eye, short {hair} hair, defiant grin"],
  "am-wavy": ["black", "an 18-year-old apprentice jockey boy, Latino, warm tan skin, wavy {hair} hair, friendly broad smile"],
  // ---- apprentices, girls ----
  "af-shingle-bob": ["dark-brown", "a 17-year-old apprentice jockey girl, pale skin, a {hair} 1920s shingled bob under the cap, bright smile"],
  "af-plaits": ["ginger", "a 16-year-old apprentice jockey girl, freckled fair skin, two {hair} plaits, eager grin"],
  "af-short-curls": ["black", "an 18-year-old apprentice jockey girl, Black, dark brown skin, short {hair} curls, confident smile"],
  "af-fringe": ["black", "a 17-year-old apprentice jockey girl, East Asian, a sleek {hair} bob with a straight fringe, focused calm gaze"],
  "af-giggle": ["brown", "a 15-year-old apprentice jockey girl, rosy pale skin, {hair} hair in a low bun, dimples, giggling"],
  "af-long-plait": ["black", "a 19-year-old apprentice jockey girl, South Asian, brown skin, a long {hair} plait over the shoulder, serious determined look"],
  "af-copper-wink": ["auburn", "an 18-year-old apprentice jockey girl, pale skin, a {hair} bob, green eyes, freckles, cheeky wink"],
  "af-tied-back": ["dark-brown", "a 17-year-old apprentice jockey girl, Latina, tan skin, wavy {hair} hair tied back, warm smile"],
  "af-shy": ["brown", "a 16-year-old apprentice jockey girl, fair skin, {hair} hair tucked under the cap, shy downcast smile"],
  "af-finger-waves": ["blonde", "an 18-year-old apprentice jockey girl, white, {hair} 1920s finger-waved hair, gap-toothed laugh"],
  "af-auburn-curls": ["auburn", "a 17-year-old apprentice jockey girl, mixed-race, light brown skin, freckles across her nose, curly {hair} hair, bright grin"],
  "af-proud": ["black", "a 19-year-old apprentice jockey girl, Black, deep dark skin, {hair} hair in a neat bun, proud raised chin, small smile"],
  "af-spectacles": ["brown", "a 16-year-old apprentice jockey girl, pale skin, round wire spectacles, a {hair} bob, earnest smile"],
  "af-dark-eyes": ["black", "an 18-year-old apprentice jockey girl, Middle Eastern, olive skin, dark eyes, {hair} hair in a bun, determined half smile"],
  "af-tomboy": ["blonde", "a 17-year-old tomboyish apprentice jockey girl, sun-tanned white skin, cropped {hair} hair, scraped nose, cheeky grin"],
  "af-dreamy": ["blonde", "a 15-year-old apprentice jockey girl, very fair skin, pale {hair} hair, big blue eyes, dreamy smile"],
  "af-steady": ["black", "an 18-year-old apprentice jockey girl, East Asian, short {hair} hair, freckles, steady confident look"],
  // ---- prime, men ----
  "pm-pencil-tache": ["black", "a dapper jockey man about 30, pale skin, a thin 1920s {hair} pencil moustache, slicked {hair} hair, sly smile"],
  "pm-boxer": ["brown", "a tough jockey man about 32, white, flattened boxer's nose, cauliflower ear, short {hair} hair, grim smile"],
  "pm-neat-tache": ["black", "a jockey man about 28, Black, dark brown skin, a neat {hair} moustache, warm confident smile"],
  "pm-trim-beard": ["black", "a jockey man about 30, South Asian, brown skin, a trimmed {hair} beard, calm proud look"],
  "pm-film-star": ["blonde", "a cheerful jockey man about 27, tanned skin, {hair} hair, bright blue eyes, film-star smile"],
  "pm-gaunt": ["dark-brown", "a gaunt wiry jockey man about 34, pale skin, hollow cheeks, {hair} stubble, intense stare"],
  "pm-ginger-burns": ["ginger", "a jockey man about 31, pale freckled skin, long {hair} sideburns, broad friendly grin"],
  "pm-cool": ["black", "a jockey man about 29, East Asian, short {hair} hair, sharp cheekbones, cool composed look"],
  "pm-big-tache": ["black", "a jockey man about 33, Latino, tan skin, a thick {hair} moustache, laughing eyes"],
  "pm-wire-specs": ["blonde", "a quiet jockey man about 30, white, round wire spectacles, {hair} hair, gentle thoughtful smile"],
  "pm-split-brow": ["black", "a jockey man about 35, Middle Eastern, tan skin, a scar through one eyebrow, a short {hair} beard, serious look"],
  "pm-baby-face": ["brown", "a jockey man about 26, white, round baby face, rosy cheeks, curly {hair} hair, jolly grin"],
  "pm-freckled": ["dark-brown", "a jockey man about 30, mixed-race, light brown skin, freckles, short curly {hair} hair, wry smile"],
  "pm-stoic": ["black", "a stoic jockey man about 36, Black, dark skin, clean shaven, deep calm eyes, slight frown"],
  // ---- prime, women ----
  "pf-platinum": ["blonde", "a glamorous jockey woman about 28, pale skin, {hair} 1920s finger waves, red lipstick, confident smile"],
  "pf-glossy-bob": ["black", "a jockey woman about 30, Black, dark skin, a glossy {hair} bob, high cheekbones, determined smile"],
  "pf-sunny": ["brown", "a jockey woman about 27, sun-tanned white skin, freckles, {hair} hair in a bun, big laugh"],
  "pf-severe": ["dark-brown", "a severe jockey woman about 35, pale skin, {hair} hair scraped back, thin lips, piercing grey eyes"],
  "pf-nose-ring": ["black", "a jockey woman about 31, South Asian, brown skin, {hair} hair in a low bun, small nose ring, warm smile"],
  "pf-playful": ["black", "a jockey woman about 29, East Asian, short layered {hair} hair, dimples, playful smile"],
  "pf-red-curls": ["ginger", "a jockey woman about 33, pale skin, wild {hair} curls escaping the cap, green eyes, fierce grin"],
  "pf-beauty-mark": ["dark-brown", "a jockey woman about 30, Latina, tan skin, wavy {hair} hair, beauty mark, sly smile"],
  "pf-composed": ["blonde", "a jockey woman about 34, white, ash {hair} hair, long face, calm composed look"],
  "pf-curly-puff": ["dark-brown", "a jockey woman about 26, mixed-race, light brown skin, curly {hair} hair in a puff, bright eyes, cheerful grin"],
  "pf-strong-brows": ["black", "a jockey woman about 32, Middle Eastern, olive skin, thick {hair} brows, {hair} hair in a plait, determined look"],
  "pf-tortoiseshell": ["brown", "a jockey woman about 31, pale skin, round tortoiseshell spectacles, a {hair} bob, clever smile"],
  "pf-squint": ["blonde", "a jockey woman about 36, weathered tanned skin, crow's feet, sandy {hair} hair in a bun, squinting friendly smile, nothing over her shoulders"],
  "pf-cropped": ["black", "a jockey woman about 28, Black, deep brown skin, short cropped {hair} hair, quiet serious gaze"],
  "pf-pixie": ["dark-brown", "a jockey woman about 27, white, a {hair} pixie crop, elfin face, mischievous smirk"],
  // ---- veterans, men ----
  "vm-walrus": ["grey", "a veteran jockey man about 55, white, a big {hair} walrus moustache, ruddy cheeks, twinkling eyes"],
  "vm-mutton-chops": ["grey", "a veteran jockey man about 50, pale skin, bushy {hair} mutton-chop sideburns, stern expression, nothing over his shoulders"],
  "vm-grey-stubble": ["grey", "a veteran jockey man about 58, Black, dark skin, {hair} stubble, deep laugh lines, warm grin"],
  "vm-hawk": ["grey", "a veteran jockey man about 52, white, hawk nose, sunken cheeks, {hair} eyebrows, steely stare"],
  "vm-white-beard": ["white", "a veteran jockey man about 54, South Asian, brown skin, a neat {hair} beard, gentle wise smile"],
  "vm-wry": ["grey", "a veteran jockey man about 50, East Asian, short {hair} hair, lined face, calm wry smile"],
  "vm-missing-tooth": ["brown", "a battered veteran jockey man about 48, pale skin, twice-broken nose, a missing tooth, cheerful grin"],
  "vm-kindly": ["grey", "a veteran jockey man about 56, white, small round spectacles, a {hair} moustache, kindly look"],
  "vm-proud": ["grey", "a veteran jockey man about 51, Latino, tan weathered skin, a {hair} moustache, deep crow's feet, proud smile"],
  "vm-faded-ginger": ["auburn", "a veteran jockey man about 49, pale freckled skin, faded {hair} hair, a {hair} beard, wry smile"],
  "vm-heavy-lids": ["grey", "a veteran jockey man about 53, Middle Eastern, olive skin, a {hair} beard, heavy-lidded wise eyes"],
  "vm-haunted": ["white", "a gaunt veteran jockey man about 57, very pale skin, deep wrinkles, {hair} stubble, haunted stare"],
  "vm-belly-laugh": ["white", "a jolly veteran jockey man about 50, Black, dark brown skin, a {hair} moustache, big belly laugh"],
  "vm-scowl": ["white", "a grumpy veteran jockey man about 55, white, bushy {hair} eyebrows, deep scowl, pursed lips"],
  "vm-silver-tache": ["grey", "a dapper veteran jockey man about 52, tanned skin, a {hair} pencil moustache, charming smile"],
  "vm-cheek-scar": ["grey", "a veteran jockey man about 49, mixed-race, light brown skin, a long scar on the cheek, {hair} temples, steady look"],
  "vm-leathery": ["white", "a wiry veteran jockey man about 60, white, leathery skin, {hair} wisps of hair, sharp knowing smile"],
  // ---- veterans, women ----
  "vf-silver-bob": ["grey", "a veteran jockey woman about 52, pale skin, a sleek {hair} bob, crow's feet, wry smile"],
  "vf-grey-curls": ["grey", "a veteran jockey woman about 55, Black, dark skin, short {hair} curls, warm laugh lines, proud smile"],
  "vf-weathered": ["grey", "a weather-beaten veteran jockey woman about 50, tanned white skin, {hair} hair in a bun, squinting grin"],
  "vf-round-face": ["grey", "a veteran jockey woman about 54, East Asian, a {hair} bob, round face, calm gentle smile"],
  "vf-grey-streak": ["black", "a veteran jockey woman about 51, South Asian, brown skin, {hair} hair, bindi, wise look"],
  "vf-stern": ["white", "a stern veteran jockey woman about 58, pale skin, {hair} hair scraped back, hawk nose, unsmiling"],
  "vf-faded-red": ["auburn", "a veteran jockey woman about 49, pale freckled skin, faded {hair} hair, lively grin"],
  "vf-knowing": ["grey", "a veteran jockey woman about 53, Latina, tan skin, wavy {hair} hair, beauty mark, knowing smile"],
  "vf-half-moons": ["grey", "a veteran jockey woman about 56, white, half-moon spectacles, a {hair} bun, shrewd look"],
  "vf-plait": ["grey", "a veteran jockey woman about 50, Middle Eastern, olive skin, a {hair} plait, strong brows, steady gaze"],
  "vf-hearty": ["white", "a jolly veteran jockey woman about 54, ruddy round cheeks, {hair} curls, big hearty laugh"],
  "vf-afro-puff": ["grey", "a veteran jockey woman about 48, mixed-race, light brown skin, a {hair} afro puff, crinkly-eyed smile"],
  "vf-lean": ["white", "a lean veteran jockey woman about 57, pale skin, sharp cheekbones, cropped {hair} hair, intense stare"],
  "vf-pearls": ["grey", "an elegant veteran jockey woman about 52, white, {hair} finger waves, pearl earrings, serene smile"],
  "vf-dignified": ["grey", "a veteran jockey woman about 55, Black, deep brown skin, cropped {hair} hair, quiet dignified look"],
  "vf-grey-pixie": ["grey", "a mischievous veteran jockey woman about 50, white, a {hair} pixie cut, crooked grin, raised eyebrow"],
  "vf-chin-scar": ["grey", "a tough veteran jockey woman about 53, tanned skin, a scar on the chin, a {hair} ponytail, determined smirk"],
  "vf-soft-smile": ["white", "a kindly veteran jockey woman about 58, East Asian, {hair} hair in a bun, wrinkles, soft smile"],
};

/** The cast: the base faces plus any grown by grow-jockey-faces.mjs (art-src/jockey_faces_grown.json). */
const GROWN = new URL("./jockey_faces_grown.json", import.meta.url);
export const FACES = { ...BASE_FACES, ...(existsSync(GROWN) ? JSON.parse(readFileSync(GROWN, "utf8")) : {}) };

/** Stage and presentation from a face id. */
export function faceMeta(id) {
  const stage = id[0] === "a" ? "apprentice" : id[0] === "v" ? "veteran" : "prime";
  const presents = /^(af|pf|vf)-/.test(id) || /woman|girl/.test(id) ? "f" : "m";
  return { stage, presents };
}

export const describe = (id, hair = "lime green") => FACES[id][1].replaceAll("{hair}", hair);
export const STYLE_IMAGE = "apps/web/public/art/portraits/mentor-wilf.png";

/** One face: generate-image-v2 request (also used by grow-jockey-faces.mjs). */
export function faceRequest(text, seed) {
  return {
    description: `${STYLE}, ${text}, ${KEY_HAIR}, ${SILKS}`,
    image_size: { width: 128, height: 128 },
    no_background: true,
    seed,
    style_image: { image: b64img(STYLE_IMAGE), size: { width: 128, height: 128 } },
    style_options: { color_palette: false, outline: true, detail: true, shading: true },
  };
}

if (process.argv[1]?.endsWith("gen-jockey-faces.mjs")) {
  const only = process.argv.slice(2);
  const ids = only.length ? only : Object.keys(FACES);
  const seed0 = Number(process.env.SEED ?? 7101);
  const LIMIT = Number(process.env.LIMIT ?? 12);
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      const seed = seed0 + Object.keys(FACES).indexOf(id);
      try {
        const r = await run("/generate-image-v2", faceRequest(describe(id), seed), `art-src/raw/jockeys/${id}-${seed}`);
        console.log(id, r.files.length);
      } catch (e) {
        console.log(id, "FAILED", e.message.slice(0, 300));
      }
    }
  };
  await Promise.all(Array.from({ length: LIMIT }, worker));
}
