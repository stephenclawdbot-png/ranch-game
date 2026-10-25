// Race scene: skies, backdrops, ground tiles, billboards, props.
//   node art-src/gen-scene.mjs <job> [<job> ...]     (raw output -> art-src/raw/scene/<job>-N.png)
import { run, b64img } from "./pixellab.mjs";
import { existsSync } from "node:fs";

const OUT = "art-src/raw/scene";
const STYLE_HINT =
  "high-res pixel art, crisp hand-pixelled look, selective dark outlines, rich shading, warm golden-hour English racecourse palette: honey sunlight, deep greens, white rails";
const v2 = (description, w, h, seed, extra = {}) => ({
  ep: "/generate-image-v2",
  body: { description: `${description}, ${STYLE_HINT}`, image_size: { width: w, height: h }, seed, no_background: true, ...extra },
});
const styleRef = (file, w, h, usage = "match this pixel art style, palette and shading") =>
  existsSync(file) ? { style_image: { image: b64img(file), size: { width: w, height: h }, usage_description: usage } } : {};

export const JOBS = {
  // --- skies (opaque, 480x270) ---------------------------------------------------
  "sky-clear": v2("wide sky backdrop only, no ground: clear golden-hour summer sky, deep blue at the top fading to warm honey and peach near the bottom horizon, a few soft fluffy cumulus clouds lit gold from the low sun on the right, pixel art banding gradient", 480, 270, 5101, { no_background: false }),
  "sky-dusk": v2("wide sky backdrop only, no ground: dusk sky, violet and indigo at the top fading through magenta to bright orange at the bottom horizon, long thin streaky clouds lit orange and pink, first stars faintly at the top, pixel art banding gradient", 480, 270, 5102, { no_background: false }),
  "sky-overcast": v2("wide sky backdrop only, no ground: overcast rainy English sky, layered heavy grey clouds, slate blue-grey at the top, lighter silver grey near the horizon, soft diffuse light, pixel art banding gradient", 480, 270, 5103, { no_background: false }),
  // --- far backdrop ---------------------------------------------------------------
  "far-hills": v2("side view distant landscape strip: rolling English countryside hills with hedgerows, patchwork fields and clusters of dark green trees, a church spire far away, soft aerial perspective with hazy blue-green distance, golden-hour light from the right, transparent sky above", 480, 112, 5201),
  "far-hills-opaque": v2("side view distant landscape panorama: rolling English countryside hills with hedgerows, patchwork green and golden fields and clusters of dark green trees, a church spire far away, soft aerial perspective with hazy blue-green distance, golden-hour light from the right, the hills fill the lower two thirds, plain flat pale cream sky above the hills with no clouds", 480, 128, 5202, { no_background: false }),
  // --- billboards (transparent, side/front view) ---------------------------------------
  "bb-tree-oak": v2("a single large mature English oak tree, full round canopy of deep green leaves lit gold on the right side, thick brown trunk, side view game sprite, transparent background", 128, 128, 5301),
  "bb-tree-poplar": v2("a single tall slender Lombardy poplar tree, narrow columnar dark green canopy lit gold on the right, thin trunk, side view game sprite, transparent background", 64, 144, 5302),
  "bb-bush": v2("a round leafy green bush with a few small white and pink flowers, side view game sprite, transparent background", 64, 48, 5303),
  "bb-crowd-a": v2("a dense crowd of racegoers standing behind a rail seen from the front, side view strip, men in suits and flat caps, women in colourful summer dresses and big hats, some waving arms and holding race cards, warm golden-hour light, transparent background", 192, 64, 5304),
  "bb-crowd-b": v2("a dense crowd of excited racegoers seen from the front, side view strip, people cheering with raised arms, top hats, colourful hats and dresses, union jack bunting, warm golden-hour light, transparent background", 192, 64, 5305),
  "bb-flag": v2("a racecourse flag on a white pole, a long pennant flag in racing green with a brass gold stripe waving in the wind, side view game sprite, transparent background", 48, 96, 5306),
  "bb-grandstand": v2("a classic English racecourse grandstand building seen from the track side: two tiers of seating, green and cream striped awning roofs, white iron columns, bunting flags along the roof, crowd silhouettes in the seats, clock tower in the middle, warm golden-hour light, side view, transparent background", 320, 160, 5307),
  // --- props -----------------------------------------------------------------------
  "finish-post": v2("a racecourse winning post: a tall white pole topped with a round red and white disc sign, side view game sprite, transparent background", 32, 128, 5401),
  "furlong-pole": v2("a racecourse furlong marker pole: a slim white post with a red band and a small round red and white disc on top, side view game sprite, transparent background", 24, 96, 5402),
  "starting-gate": v2("a horse racing starting gate seen from the side, long metal frame of green and white padded stalls on wheels, side view game sprite, transparent background", 256, 128, 5403),
  "finish-post-clean": { ep: "/edit-images-v2", body: { method: "edit_with_text", edit_images: [{ image: b64img("art-src/raw/scene/finish-post-0.png"), width: 32, height: 128 }], image_size: { width: 32, height: 128 }, description: "remove the grass base block and the arrow; keep the red and white target disc and the red and white striped pole going straight down to the bottom edge, nothing else", no_background: true, seed: 5411 } },
  "furlong-pole-clean": { ep: "/edit-images-v2", body: { method: "edit_with_text", edit_images: [{ image: b64img("art-src/raw/scene/furlong-pole-2.png"), width: 24, height: 96 }], image_size: { width: 32, height: 96 }, description: "remove the grass base and the small post; keep only the round red and white disc and the white pole with red bands going straight down to the bottom edge", no_background: true, seed: 5412 } },
  "flag-wave": { ep: "/animate-pixminimax", body: { first_frame: b64img("art-src/raw/scene/bb-flag-0.png"), description: "the pennant flag ripples and flutters in a steady breeze, waves travelling along the cloth from the pole to the tip; the pole stays perfectly still; loops seamlessly", frame_count: 8, seed: 5413, direction: "east", view: "side", subject_description: "a green and gold pennant flag on a white pole", initial_pose: "flag flying out to the right", no_background: true } },
  // --- parallax strips (kept for the 2D fallback) ------------------------------------
  "rail-white": v2("side view of a white plastic racecourse running rail, two horizontal round rails on white posts, a long straight horizontal strip, transparent background", 192, 32, 5501),
  "hedge-near": v2("side view of a neatly trimmed dark green box hedge strip with small red and white flowers along its base, a long straight horizontal strip seen up close, transparent background", 192, 48, 5502),
  tiles2: {
    ep: "/create-tiles-pro",
    body: {
      description:
        "1). top-down short mowed racecourse turf, even fine green grass blades, uniform texture without stripes 2). top-down short mowed racecourse turf, even fine green grass blades, uniform texture without stripes 3). top-down dense dark green box hedge foliage seen from above, small glossy leaves filling the whole tile 4). top-down dense dark green box hedge foliage seen from above, small glossy leaves filling the whole tile",
      tile_type: "square_topdown",
      tile_size: 64,
      tile_view: "top-down",
      outline_mode: "segmentation",
      seed: 5602,
    },
  },
  // --- ground tiles (top-down, made seamless later) -----------------------------------
  tiles: {
    ep: "/create-tiles-pro",
    body: {
      description:
        "1). top-down racecourse turf: lush mowed green grass with subtle lighter mowing stripes 2). top-down racetrack dirt: raked brown loamy dirt with hoof prints and small pebbles 3). top-down meadow grass: lush deep green grass with clover and tiny daisies 4). top-down fine gravel path: light warm grey and beige pebbles 5). top-down trimmed dark green box hedge leaves seen from above, dense small leaves",
      tile_type: "square_topdown",
      tile_size: 64,
      tile_view: "top-down",
      outline_mode: "segmentation",
      seed: 5601,
    },
  },
};

const names = process.argv.slice(2);
await Promise.all(
  names.map(async (n) => {
    const j = JOBS[n];
    if (!j) throw new Error(`unknown job ${n}`);
    try {
      const r = await run(j.ep, j.body, `${OUT}/${n}`);
      console.log(n, r.files.length, JSON.stringify(r.job?.usage ?? r.response.usage));
    } catch (e) {
      console.log(n, "FAILED", e.message.slice(0, 600));
    }
  }),
);
