// UI kit: icons/badges (create-1-direction-object, one consistent sheet), panels/buttons/logo (generate-ui-v2 / generate-image-v2).
//   node art-src/gen-ui.mjs <job> [...]
import { run, b64img } from "./pixellab.mjs";
const OUT = "art-src/raw/ui";
const PALETTE = "deep racing green #0f2a1d, warm cream #f3e7c9, brass gold #d9a441, oxblood red #7a1f1f, ink black #0b0f0c";
export const ICONS = [
  ["coin", "a shiny gold credit coin with an embossed horseshoe, front view"],
  ["trophy", "a gold racing trophy cup with two handles on a dark green base"],
  ["horseshoe", "a polished steel horseshoe, open end up, with nail holes"],
  ["stopwatch", "a brass stopwatch with white face and black hands"],
  ["flag", "a chequered racing finish flag on a short pole"],
  ["star", "a five-pointed gold star"],
  ["rosette", "a red rosette ribbon award with a gold centre and two tails"],
  ["saddle", "a brown leather racing saddle, side view"],
  ["calendar", "a small paper calendar page with a red header and rings on top"],
  ["badge-gold", "a round gold medal badge with a laurel border"],
  ["badge-silver", "a round silver medal badge with a laurel border"],
  ["badge-bronze", "a round bronze medal badge with a laurel border"],
  ["horse-head", "a horse head silhouette in brass, side view facing left"],
  ["ticket", "a cream racecourse admission ticket stub with a red stripe"],
  ["binoculars", "black and brass race binoculars"],
  ["whip", "a jockey's riding crop with a black grip"],
];
const JOBS = {
  icons: () => run("/create-1-direction-object", {
    description: `small game UI icon, chunky readable pixel art with dark ink outline, warm racing-club palette: ${PALETTE}`,
    size: 32, view: "sidescroller", item_descriptions: ICONS.map(([, d]) => d),
  }, `${OUT}/icons`),
  panel: () => run("/generate-ui-v2", { description: "square game UI window panel frame: deep racing green #0f2a1d flat fill with a thick polished brass gold #d9a441 trim border, ornate brass corner rivets, thin dark ink outline, empty centre, symmetrical, pixel art", image_size: { width: 96, height: 96 }, color_palette: PALETTE, seed: 8101 }, `${OUT}/panel`),
  card: () => run("/generate-ui-v2", { description: "square game UI card frame: warm cream #f3e7c9 parchment paper fill with a thin oxblood red #7a1f1f double border line and small brass corner ornaments, subtle paper texture, empty centre, symmetrical, pixel art", image_size: { width: 96, height: 96 }, color_palette: "cream parchment, oxblood red, brass gold", seed: 8102 }, `${OUT}/card`),
  button: () => run("/generate-ui-v2", { description: "wide rectangular game UI button, oxblood red #7a1f1f with a brass gold #d9a441 bevelled border, soft top highlight and darker bottom edge, no text, empty centre, symmetrical, pixel art", image_size: { width: 96, height: 32 }, color_palette: "oxblood red and brass gold", seed: 8103 }, `${OUT}/button`),
  "button-green": () => run("/generate-ui-v2", { description: "wide rectangular game UI button, deep racing green #1d4a32 with a brass gold #d9a441 bevelled border, soft top highlight and darker bottom edge, no text, empty centre, symmetrical, pixel art", image_size: { width: 96, height: 32 }, color_palette: "racing green and brass gold", seed: 8104 }, `${OUT}/button-green`),
  logo: () => run("/generate-image-v2", { description: "game logo emblem crest: a brass gold horseshoe framing a heraldic shield in deep racing green with a galloping thoroughbred horse silhouette in cream, laurel leaves at the sides, an oxblood red ribbon banner across the bottom (blank, no text), polished metal shading, high-res pixel art, selective dark outline, transparent background", image_size: { width: 128, height: 128 }, no_background: true, seed: 8105 }, `${OUT}/logo`),
};
await Promise.all(process.argv.slice(2).map(async (n) => {
  try { const r = await JOBS[n](); console.log(n, r.files.length, JSON.stringify(r.job?.usage ?? r.response.usage)); }
  catch (e) { console.log(n, "FAILED", e.message.slice(0, 500)); }
}));
