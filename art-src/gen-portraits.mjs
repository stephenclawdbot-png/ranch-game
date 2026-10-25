// Horse portraits: one bay master (generate-image-v2), then per-coat edits (edit-images-v2).
//   node art-src/gen-portraits.mjs master          -> raw/portraits/master-N.png
//   node art-src/gen-portraits.mjs coats <master.png> [coat ...]
import { run, b64img } from "./pixellab.mjs";
const OUT = "art-src/raw/portraits";
const COAT_TEXT = {
  bay: "bay: rich reddish-brown coat with black mane",
  dark_bay: "dark bay: very dark chocolate brown coat, almost black, with black mane",
  chestnut: "chestnut: bright coppery red-orange coat with a matching chestnut mane",
  liver_chestnut: "liver chestnut: deep dark reddish liver-brown coat with a darker brown mane",
  black: "black: glossy jet black coat with blue-grey sheen highlights and black mane",
  grey: "grey: light silver-grey coat, nearly white on the face, with a grey mane",
  dapple_grey: "dapple grey: grey coat covered with round lighter dapple rings on the neck, dark grey muzzle, grey mane",
  palomino: "palomino: golden yellow coat with a creamy white flaxen mane",
  buckskin: "buckskin: tan sandy-gold coat with black mane",
  roan: "red roan: reddish coat finely speckled with white hairs giving a pinkish frosted look, darker head, reddish-brown mane",
};
const [mode, master, ...only] = process.argv.slice(2);
if (mode === "master") {
  const r = await run("/generate-image-v2", {
    description: "portrait of a thoroughbred racehorse head and neck, three-quarter side view facing left, bay coat (rich reddish brown) with black mane, small white star on the forehead, alert ears pricked forward, bright intelligent eye, brown leather bridle, noble expression, character portrait bust cropped at the base of the neck, warm golden-hour light from the left, high-res pixel art, selective dark outline, rich shading, transparent background",
    image_size: { width: 96, height: 96 }, no_background: true, seed: 7101,
  }, `${OUT}/master`);
  console.log(r.files);
} else {
  const coats = only.length ? only : Object.keys(COAT_TEXT).filter((c) => c !== "bay");
  for (const coat of coats) {
    try {
      const r = await run("/edit-images-v2", {
        method: "edit_with_text",
        edit_images: [{ image: b64img(master), width: 96, height: 96 }],
        image_size: { width: 96, height: 96 },
        description: `change the horse's coat colour to ${COAT_TEXT[coat]}; keep exactly the same pose, framing, bridle, white star, outline, lighting and pixel art style`,
        no_background: true, seed: 7200,
      }, `${OUT}/coat-${coat}`);
      console.log(coat, r.files);
    } catch (e) { console.log(coat, "FAILED", e.message.slice(0, 300)); }
  }
}
