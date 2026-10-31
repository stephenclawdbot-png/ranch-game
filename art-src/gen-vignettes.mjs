// News and moment vignettes: one small framed picture per kind of item (generate-image-v2,
// 64x64, 16 options per call), so the news feed and stable moments stop sharing one icon.
//   node art-src/gen-vignettes.mjs [id ...]   -> art-src/raw/vignettes/<id>-<seed>-N.png
import { run, b64img } from "./pixellab.mjs";

const STYLE =
  "tiny square pixel art vignette, a little framed scene with a thin dark wood border, warm golden-hour light, racing-club palette of deep racing green, warm cream, brass gold and oxblood red, clear readable silhouette at small size, high-res pixel art, selective dark outline, no text";

export const VIGNETTES = {
  win: "a racehorse and jockey in silks crossing the finish line past the white winning post, arms raised in joy",
  "first-win": "a red and gold winner's rosette pinned on the bridle of a happy bay racehorse's head",
  "photo-finish": "two racehorse heads nose to nose at the white finish post, a bright camera flash",
  purse: "a neat stack of gold coins beside a small silver cup and a green ribbon",
  champion: "a golden champion's trophy cup inside a green laurel wreath with a brass ribbon",
  "jockey-signed": "two hands shaking over a signed contract with a folded jockey's racing silks and cap beside it",
  "jockey-retires": "a jockey's silk cap and goggles hanging on a wooden peg beside riding boots in a tack room, soft evening light, the scene fills the whole square",
  "jockey-claim": "a young apprentice jockey in silks proudly holding up a certificate with a gold seal",
  sale: "an auctioneer's wooden gavel striking its block beside a lot number card",
  claim: "a racehorse being led away by a groom holding a brown luggage tag on a lead rope",
  "hall-of-fame": "a polished brass plaque with a horse head relief framed by golden laurels on dark oak panelling",
  memorial: "a softly glowing lantern beside a single white rose on a stable windowsill at dusk, quiet and respectful",
  retired: "an old grey horse grazing peacefully under a big oak tree in a sunset meadow",
  foal: "a newborn foal on wobbly legs beside its mother in golden straw",
  vet: "a kind vet in a green coat gently checking a horse's bandaged foreleg with care, calm and reassuring",
  week: "a page-a-day calendar with three small rosettes pinned beside it",
  improver: "a racehorse galloping out of a morning mist with golden sparkles trailing behind",
  quirk: "a curious racehorse head peeking out over a stable half-door with a sheepskin noseband, one ear flopped",
  unlock: "an ornate wrought-iron estate gate swinging open onto a sunny green paddock",
  scan: "an old pedigree certificate with a hand-drawn family tree under a brass magnifying glass on a desk",
  exact: "an open trainer's notebook of handwritten form figures beside a silver stopwatch",
  legacy: "a gilt-framed painting of a proud racehorse hanging above a mantelpiece with a rosette and a candle",
  "stable-steps": "a ring of old iron keys hanging on a hook beside a green stable door",
};

const only = process.argv.slice(2);
const ids = only.length ? only : Object.keys(VIGNETTES);
const seed0 = Number(process.env.SEED ?? 9801);
const LIMIT = 8;
let next = 0;
async function worker() {
  while (next < ids.length) {
    const id = ids[next++];
    const seed = seed0 + Object.keys(VIGNETTES).indexOf(id);
    try {
      const r = await run(
        "/generate-image-v2",
        {
          description: `${STYLE}, ${VIGNETTES[id]}`,
          image_size: { width: 64, height: 64 },
          no_background: false,
          seed,
          // STYLE_REF=1: match the frame and palette of the photo-finish vignette (second pass)
          ...(process.env.STYLE_REF ? { style_image: { image: b64img("art-src/raw/vignettes/photo-finish-9803-5.png"), size: { width: 64, height: 64 } } } : {}),
        },
        `art-src/raw/vignettes/${id}-${seed}`,
      );
      console.log(id, seed, r.files.length);
    } catch (e) {
      console.log(id, "FAILED", e.message.slice(0, 400));
    }
  }
}
await Promise.all(Array.from({ length: LIMIT }, worker));
