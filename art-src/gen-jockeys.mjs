// Jockey portraits: one PixelLab bust per jockey face (generate-image-v2, 128 px), styled on
// Wilf's portrait (portraits/mentor-wilf.png) so the cast reads as one set. Every jockey wears
// the same KEY silks (magenta body, cyan sleeves, magenta cap) that process_jockeys.py snaps to
// race/palette.json's silks ramps, so the game paints each jockey in their stable's colours.
//   node art-src/gen-jockeys.mjs [id ...]      -> art-src/raw/jockeys/<id>-<seed>-N.png
import { run, b64img } from "./pixellab.mjs";

const SILKS =
  "wearing shiny racing silks: a bright magenta silk jersey with bright cyan sleeves and a bright magenta silk skull cap with a short peak, white stock collar";
const STYLE =
  "detailed HD character portrait bust, head and shoulders, three-quarter view facing right, cropped at the chest, warm golden-hour light from the left, high-res pixel art, selective dark outline, rich shading, transparent background";

/** id -> who (age, look, expression). Apprentices (a-*) are young, veterans (v-*) older. */
export const JOCKEYS = {
  "a-freckled-lad": "a cheeky freckled teenage apprentice jockey boy, about 17, ginger hair poking out under the cap, pale skin, wide grin",
  "a-young-woman-braid": "a determined young woman apprentice jockey, about 18, light brown skin, dark braid over the shoulder, focused smile",
  "a-shy-lad": "a shy young apprentice jockey, about 18, East Asian, black fringe under the cap, small nervous smile",
  "a-bright-girl": "an eager young woman apprentice jockey, about 19, Black, dark brown skin, short natural hair under the cap, big bright smile",
  "a-lanky-lad": "a lanky young apprentice jockey, about 19, olive skin, dark curly hair, raised eyebrow, cocky smirk",
  "a-blonde-girl": "a young woman apprentice jockey, about 18, fair skin, blonde ponytail, rosy cheeks, gap-toothed laugh",
  "j-calm-man": "a calm professional jockey man in his late twenties, South Asian, light brown skin, neat short beard, steady confident look",
  "j-sharp-woman": "a sharp professional jockey woman in her late twenties, white, high cheekbones, auburn hair tucked under the cap, determined half smile",
  "j-grinning-man": "a jovial professional jockey man around thirty, Black, dark brown skin, clean shaven, broad grin",
  "j-stern-woman": "a stern professional jockey woman around thirty, Latina, tan skin, dark hair in a low bun, serious stare",
  "j-irish-man": "a wiry professional jockey man around thirty, pale skin, red stubble, twinkling blue eyes, wry smile",
  "j-moustache-man": "a dapper professional jockey man in his thirties, olive skin, thin dark moustache, slicked dark hair, confident smile",
  "j-kind-woman": "a friendly professional jockey woman in her thirties, East Asian, black bob haircut under the cap, warm smile",
  "j-scar-man": "a tough professional jockey man in his thirties, white, broken nose, small scar on the chin, narrowed eyes",
  "j-glasses-woman": "a thoughtful professional jockey woman in her thirties, Black, dark skin, round sports glasses, gentle smile",
  "j-curly-man": "a cheerful professional jockey man in his thirties, Middle Eastern, tan skin, curly black hair, short black beard, laughing",
  "j-focused-woman": "a focused professional jockey woman in her early thirties, Indian, brown skin, nose stud, long black plait, calm gaze",
  "j-pale-man": "a quiet professional jockey man in his thirties, very pale skin, light blond eyebrows, freckles, serious look",
  "v-grey-man": "a veteran jockey man in his late forties, white, weathered lined face, grey sideburns, crow's feet, knowing smile",
  "v-silver-woman": "a veteran jockey woman in her late forties, white, short silver hair, laugh lines, proud confident look",
  "v-craggy-man": "a craggy veteran jockey man about fifty, Black, dark skin, grey-flecked short beard, deep wrinkles, wise calm look",
  "v-wily-man": "a wily veteran jockey man in his late forties, tan skin, hooked nose, salt-and-pepper stubble, sly grin",
  "v-steely-woman": "a steely veteran jockey woman about fifty, East Asian, grey streaks in black hair, firm unsmiling mouth",
  "v-jolly-man": "a jolly veteran jockey man in his late forties, ruddy round cheeks, white bushy eyebrows, big laugh",
  "v-wise-woman": "a wise veteran jockey woman about fifty, Black, dark brown skin, short grey hair at the temples, laugh lines, calm proud smile",
  "a-quiet-girl": "a quiet young woman apprentice jockey, about 17, South Asian, light brown skin, black hair in a low bun, shy hopeful smile",
  "j-ginger-woman": "a lively professional jockey woman in her late twenties, pale freckled skin, copper red hair tucked under the cap, cheeky grin",
};

const STYLE_IMAGE = "apps/web/public/art/portraits/mentor-wilf.png";
const only = process.argv.slice(2);
const ids = only.length ? only : Object.keys(JOCKEYS);
const seed0 = Number(process.env.SEED ?? 9101);
await Promise.all(
  ids.map(async (id, i) => {
    const seed = seed0 + Object.keys(JOCKEYS).indexOf(id);
    try {
      const r = await run(
        "/generate-image-v2",
        {
          description: `${STYLE}, ${JOCKEYS[id]}, ${SILKS}`,
          image_size: { width: 128, height: 128 },
          no_background: true,
          seed,
          style_image: { image: b64img(STYLE_IMAGE), size: { width: 128, height: 128 } },
          style_options: { color_palette: false, outline: true, detail: true, shading: true },
        },
        `art-src/raw/jockeys/${id}-${seed}`,
      );
      console.log(id, r.files.length);
    } catch (e) {
      console.log(id, "FAILED", e.message.slice(0, 400));
    }
  }),
);
