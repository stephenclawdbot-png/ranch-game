// Gallop animation explorations from a generate-image-v2 base frame.
import { run, b64img } from "./pixellab.mjs";
const [variant] = process.argv.slice(2);
const SUBJECT = "a bay thoroughbred racehorse with a jockey in magenta and cyan silks crouched in racing position";
const jobs = {
  // animate-with-text-v3: 8 frames from base frame 0
  v3a: () => run("/animate-with-text-v3", { first_frame: b64img("raw/hero/base-0-144.png"), action: "racehorse galloping at full speed, one complete gallop stride cycle, legs reach and gather, jockey stays crouched, seamless loop, stays in place", frame_count: 8, seed: 31, no_background: true }, "raw/hero/anim-v3a"),
  v3b: () => run("/animate-with-text-v3", { first_frame: b64img("raw/hero/base-1-144.png"), action: "racehorse galloping at full speed, one complete gallop stride cycle, legs reach and gather, jockey stays crouched, seamless loop, stays in place", frame_count: 12, seed: 32, no_background: true }, "raw/hero/anim-v3b"),
  mmA: () => run("/animate-pixminimax", { first_frame: b64img("raw/hero/base-0-144.png"), description: "gallops at full racing speed on the spot: one complete four-beat gallop stride, hind legs drive under the body, forelegs reach forward, all legs gather under the belly, then extend again; head and neck nod with the stride; jockey stays low and still; ends in the starting pose so it loops", frame_count: 8, seed: 41, direction: "east", view: "side", subject_description: SUBJECT, initial_pose: "mid-gallop with legs extended", no_background: true }, "raw/hero/anim-mmA"),
  mmB: () => run("/animate-pixminimax", { first_frame: b64img("raw/hero/base-3-144.png"), description: "gallops at full racing speed on the spot: one complete four-beat gallop stride, hind legs drive under the body, forelegs reach forward, all legs gather under the belly, then extend again; head and neck nod with the stride; jockey stays low and still; ends in the starting pose so it loops", frame_count: 12, seed: 42, direction: "east", view: "side", subject_description: SUBJECT, initial_pose: "mid-gallop", no_background: true }, "raw/hero/anim-mmB"),
};
const r = await jobs[variant]();
console.log(variant, r.files.length, JSON.stringify(r.job?.usage ?? r.response.usage));
