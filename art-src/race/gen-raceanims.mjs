// Race-day animations (break, drive, lunge, ease-up, celebrate, pull-up, ground fx, cheering crowd).
//   python3 -I art-src/race/prep_raceanims.py           # seed frames from race/horse-gallop.png
//   node art-src/race/gen-raceanims.mjs <job...>        # -> art-src/race/raw/anims/<job>-N.png (+ .json)
//   node art-src/race/gen-raceanims.mjs list
// Seeds are gallop frames pasted at a fixed offset (see prep_raceanims.py), so every strip keeps
// the HD v2 gallop's scale, outline and key colours. Processing: art-src/race/process_raceanims.py.
import { existsSync, writeFileSync } from "node:fs";
import { run, b64img } from "../pixellab.mjs";

const RAW = "art-src/race/raw/anims";
const S = (f) => `${RAW}/${f}`;
const STYLE = "same horse, same jockey, same size and position, same colours and pixel art style, facing right, side view";

const anim = (first, action, frames, seed, last = null) => ({
  ep: "/animate-with-text-v3",
  body: () => ({ first_frame: b64img(first), ...(last ? { last_frame: b64img(last) } : {}), action, frame_count: frames, seed, no_background: true }),
});
const edit = (image, description, w, h, seed) => ({
  ep: "/edit-images-v2",
  body: () => ({ method: "edit_with_text", edit_images: [{ image: b64img(image), width: w, height: h }], image_size: { width: w, height: h }, description, seed, no_background: true }),
});
const gen = (description, w, h, seed) => ({
  ep: "/generate-image-v2",
  body: () => ({ description, image_size: { width: w, height: h }, no_background: true, seed }),
});

const DRIVE = "racehorse at an all-out flat-out gallop in the final furlong, maximum effort, body stretched long and low, neck extended forward, one complete gallop stride cycle; the jockey crouches very low and pushes hard, both hands pumping forward along the horse's neck in rhythm with the stride, elbows working, heels squeezing; no whip; seamless loop, stays in place";
const JOBS = {
  // --- keyframes (edit-images-v2, 1 image) ----------------------------------------------
  "key-stall": edit(S("seed-g3-168.png"), `${STYLE}. The racehorse stands still in the starting stalls ready to break: all four hooves planted on the ground, hind legs gathered under the body, weight sitting back on the hindquarters, head up and alert; the jockey crouched low over the withers holding the reins short`, 256, 168, 31001),
  "key-celebrate": edit(S("seed-g0-192.png"), `${STYLE}. The jockey has won the race: he stands up tall in the stirrups, body upright above the saddle, his right arm raised high in the air with a clenched fist, the other hand holding the reins; the horse canters`, 256, 192, 31002),
  "key-drive": edit(S("seed-g0-168.png"), `${STYLE}. The jockey crouches much lower and flatter over the horse's neck, both arms stretched far forward pushing the reins along the neck, urging the horse on with hands and heels; no whip`, 256, 168, 31003),
  // --- strips (animate-with-text-v3; output 0 is the first frame) ------------------------
  "anim-drive-a": anim(S("seed-g0-168.png"), DRIVE, 12, 31101),
  "anim-drive-b": anim(S("seed-g0-168.png"), DRIVE, 12, 31102),
  "anim-easeup-a": anim(S("seed-g0-168.png"), "after the winning post the racehorse eases down: it gallops, then slows to a relaxed canter, then to a slow bouncy trot; the jockey sits up gradually and lets the reins go loose; stays in place", 12, 31201),
  "anim-pullup-a": anim(S("seed-g0-168.png"), "the jockey sits up and pulls the racehorse up mid-race: the horse slows from a gallop to a trot to a walk, taking short uneven steps as if it is favouring its right foreleg, then stops and stands still with all four hooves on the ground; the jockey sits upright looking down at the leg; stays in place", 12, 31301),
  "anim-celebrate-a": existsSync(S("key-celebrate-0.png"))
    ? anim(S("key-celebrate-0.png"), "the racehorse canters smoothly in a relaxed three-beat canter cycle; the winning jockey stands up in the stirrups and waves his raised right arm in celebration, punching the air; seamless loop, stays in place", 10, 31401)
    : null,
};

// Ground effects: /vfx (pro) without a sprite, small canvases; downloaded spritesheets are keyed
// to a 4-step grey ramp afterwards (process_fx.py) so the viewer tints them per surface.
const vfx = (description, seedName) => ({ ep: "/vfx", vfx: true, body: () => ({ description, artist: "pro", name: seedName }) });
Object.assign(JOBS, {
  "vfx-mud": vfx("Small pixel-art particle effect for a side-view horse race game, seen from the side: a burst of wet mud clods kicked up backwards by a galloping hoof. 5 to 8 chunky lumps of dark wet mud of different sizes (2 to 6 px) fly up and backwards to the LEFT in an arc, tumble, then fall to the ground; a few tiny splatter droplets. Dark brown mud, glossy highlight pixel on each clod, 1 px darker outline. No smoke, no glow. 8 frames, canvas about 48x32 px, not looping, transparent background, crisp hard pixels, no anti-aliasing.", "race-fx-mud"),
  "vfx-dust": vfx("Small pixel-art particle effect for a side-view horse race game, seen from the side: a dust puff kicked up behind a galloping hoof on a dry dirt track. A low cloud of dry sandy dust bursts from the ground, billows up and drifts backwards to the LEFT, grows, thins out and dissolves into a few specks. Soft beige-tan dust in 3-4 flat shades, chunky pixel clusters, no outline, no glow. 8 frames, canvas about 48x32 px, not looping, transparent background, crisp hard pixels, no anti-aliasing.", "race-fx-dust"),
  "vfx-divot": vfx("Small pixel-art particle effect for a side-view horse race game, seen from the side: a turf divot kicked out by a galloping hoof. 2 or 3 small chunks of grass turf (green grass blades on top, dark brown soil underneath) and a few loose grass blades flip up and backwards to the LEFT in an arc, tumble and fall to the ground. 1 px darker outline. No smoke, no glow. 8 frames, canvas about 48x32 px, not looping, transparent background, crisp hard pixels, no anti-aliasing.", "race-fx-divot"),
});

// Cheering crowd: race/crowd.png is 320 px wide (> 256), so two overlapping 256 px windows are
// animated (A = columns 0..255, B = columns 160..319 + 0..95, wrapped) and stitched per frame
// with min-cut seams (process_crowd.py), keeping the strip seamless in x.
const CHEER = "the racegoers behind the white rail cheer wildly as the horses pass: they wave their arms and race cards in the air, jump up and down on the spot, clap and punch the air, hats bob; everyone stays in place, the white rail stays perfectly still; seamless loop";
Object.assign(JOBS, {
  "anim-crowd-A": anim(S("seed-crowd-A.png"), CHEER, 8, 31501),
  "anim-crowd-B": anim(S("seed-crowd-B.png"), CHEER, 8, 31502),
});

// Second pass: drive animated from the drive keyframe; stall stance without the gate.
Object.assign(JOBS, {
  "anim-drive-c": anim(S("key-drive-0.png"), DRIVE, 12, 31103),
  "anim-drive-d": anim(S("key-drive-0.png"), DRIVE, 12, 31104),
  "key-stall-b": edit(S("seed-g3-168.png"), `${STYLE}. Transparent empty background, no starting gate, no stalls, no ground. The racehorse stands perfectly still on all four legs, all four hooves flat on the ground under the body, hind legs gathered under the belly, weight back on the hindquarters, head up, ready to jump forward; the jockey crouched low over the withers holding the reins short`, 256, 168, 31004),
});

// Ease-up stage 2: from the last ease-up frame (jockey already sitting up) down to a trot.
Object.assign(JOBS, {
  "anim-easeup-b": anim(S("anim-easeup-a-12.png"), "the racehorse slows down from a canter to a relaxed, bouncy two-beat trot: diagonal pairs of legs move together, shorter steps, head and neck relax and lower slightly; the jockey sits upright in the saddle with long loose reins; one smooth slowing movement, stays in place", 12, 31202),
});

// Third pass. key-stall-b-up = key-stall-b lifted 8 px so its hooves sit on the gallop seed's
// ground row (158). Break ends on the gallop's first frame; ease-up ends on a trotting frame.
const EASE = "after the winning post the racehorse eases down: it gallops, then slows to a relaxed canter, then to a slow bouncy two-beat trot with diagonal legs moving together; the jockey sits up gradually and lets the reins go long; stays in place";
Object.assign(JOBS, {
  "anim-break-a": anim(S("key-stall-b-up.png"), "the starting stalls open: the racehorse springs forward out of the stalls, pushing off powerfully with both hind legs, front legs lifting, then lands into its first full galloping stride; the jockey stays crouched low and goes with the horse; stays in place", 8, 31601, S("seed-g0-168.png")),
  "anim-break-b": anim(S("key-stall-b-up.png"), "the starting stalls open: the racehorse springs forward out of the stalls, pushing off powerfully with both hind legs, front legs lifting, then lands into its first full galloping stride; the jockey stays crouched low and goes with the horse; stays in place", 8, 31602, S("seed-g0-168.png")),
  "anim-lunge-a": anim(S("anim-drive-c-11.png"), "on the winning line the racehorse makes one last lunging stride: it stretches its head and neck far forward and down, nose reaching out as far as possible, front legs reaching; the jockey throws both hands forward along the neck to give the horse its head; stays in place", 6, 31701),
  "anim-easeup-c": anim(S("seed-g0-168.png"), EASE, 12, 31203, S("anim-pullup-a-10.png")),
  "anim-easeup-d": anim(S("seed-g0-168.png"), EASE, 12, 31204, S("anim-easeup-b-8.png")),
  "anim-pullup-b": anim(S("anim-pullup-a-12.png"), "the racehorse takes one more short careful step and comes to a complete stop, then stands still with all four hooves on the ground, weight off its right foreleg; the jockey sits upright and still holding the reins; stays in place", 6, 31302),
});

// Lunge, second try (anim-lunge-a was only another stride): a keyframe of the lunge itself,
// then drive frame 11 -> keyframe. Inputs are shifted 12 px left (*-L12.png) so the stretched
// nose fits the 256 px canvas; the lunge strip carries its own anchor.
Object.assign(JOBS, {
  "key-lunge": edit(S("anim-drive-c-0-L12.png"), `${STYLE}. Photo finish lunge on the winning line: the racehorse throws its head and neck far forward and DOWN, neck stretched long and almost level with its back, nose pushed out in front as far as it can reach, ears back, front legs reaching far forward; the jockey crouched flat with both arms fully extended forward along the neck, hands near the horse's ears, body low over the withers. No whip`, 256, 168, 31005),
});
if (existsSync(S("key-lunge-0.png"))) {
  JOBS["anim-lunge-b"] = anim(S("anim-drive-c-11-L12.png"), "on the winning line the racehorse makes one last lunge: it stretches its head and neck far forward and down to reach the line first, and the jockey throws both hands forward along the neck; stays in place", 6, 31702, S("key-lunge-0.png"));
  JOBS["anim-lunge-c"] = anim(S("anim-drive-c-11-L12.png"), "on the winning line the racehorse makes one last lunge: it stretches its head and neck far forward and down to reach the line first, and the jockey throws both hands forward along the neck; stays in place", 6, 31703, S("key-lunge-0.png"));
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === "list") {
  console.log(Object.keys(JOBS).join("\n"));
  process.exit(0);
}
const names = [cmd, ...rest];
await Promise.all(
  names.map(async (name) => {
    const j = JOBS[name];
    if (!j) throw new Error(`unknown or not ready: ${name}`);
    try {
      const r = await run(j.ep, j.body(), `${RAW}/${name}`);
      if (j.vfx) {
        // files are plain download links: keep the spritesheet + its json
        const files = r.job?.last_response?.files ?? {};
        const links = Array.isArray(files) ? files : Object.values(files);
        for (const l of links.flat()) {
          const url = typeof l === "string" ? l : l?.url;
          if (!url || !/\.(png|json)(\?|$)/.test(url)) continue;
          const base = url.split("?")[0].split("/").pop();
          const res = await fetch(url);
          writeFileSync(`${RAW}/${name}--${base}`, Buffer.from(await res.arrayBuffer()));
        }
      }
      console.log(name, r.files.length, JSON.stringify(r.job?.usage ?? r.response.usage));
    } catch (e) {
      console.error(name, "FAILED", e.message.slice(0, 400));
    }
  }),
);
