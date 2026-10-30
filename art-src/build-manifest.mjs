#!/usr/bin/env node
// Builds apps/web/public/art/manifest.json from the registry below + the files on disk.
// Only entries whose src file exists are written. Frame sizes are read from the PNG header
// (width / frameCount) unless given. Run: node art-src/build-manifest.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "apps/web/public/art");
const LICENSE = "PixelLab generated (commercial use per PixelLab ToS)";

function pngSize(file) {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
const META = join(ROOT, "..", "..", "..", "..", "art-src", "meta");
const readJson = (f) => {
  const p = f.endsWith(".meta.json") ? join(META, f) : join(ROOT, f);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
};

const COATS = ["bay", "dark_bay", "chestnut", "liver_chestnut", "black", "grey", "dapple_grey", "palomino", "buckskin", "roan"];
const NOSE = { x: 0.94, y: 0.97 };

const pal = readJson("race/palette.json");
const horsePalette = pal
  ? [...pal.coat, ...pal.mane, ...(pal.points ?? []), ...pal.silksPrimary, ...pal.silksSecondary, ...pal.cap]
  : [];
const gallopMeta = readJson("race/horse-gallop.meta.json");
const loMeta = readJson("race/horse-gallop-lo.meta.json");
const lp = readJson("race/palette-lo.json");
const loPalette = lp ? [...lp.coat, ...lp.mane, ...(lp.points ?? []), ...lp.silksPrimary, ...lp.silksSecondary, ...lp.cap] : [];
const extraMeta = (f) => readJson(f) ?? {};

/** @type {Array<Record<string, any>>} */
const R = [
  // --- race: horse ---------------------------------------------------------------
  {
    id: "horse.body.gallop", kind: "horse_body", depthBand: "track", src: "race/horse-gallop.png",
    frameCount: 12, fps: 14, anchor: gallopMeta?.anchor ?? NOSE, palette: horsePalette, variants: COATS,
    optimizationTier: "hero", animations: { gallop: { from: 0, to: 11, loop: true } },
    sourcePrompt: "HD v2: generate-image-v2 224x140 'detailed side view of a thoroughbred racehorse galloping at full stretch facing right... bay coat, black points, jockey crouched, flat magenta silks body, cyan sleeves, magenta cap, white saddle cloth' (seed 11004) -> padded 256x168 -> animate-with-text-v3 12 frames (seed 32) -> role-quantised palette (art-src/process_gallop.py --hd)",
  },
  {
    id: "horse.body.gallop.normal", kind: "horse_body", depthBand: "track", src: "race/horse-gallop-normal.png",
    frameCount: 12, fps: 14, anchor: gallopMeta?.anchor ?? NOSE, variants: ["normal-opengl"], optimizationTier: "hero",
    animations: { gallop: { from: 0, to: 11, loop: true } },
    sourcePrompt: "/normal-map mode=pro kind=character per frame of race/horse-gallop.png (OpenGL convention, green up)",
  },
  {
    id: "horse.body.gallop.lo", kind: "horse_body", depthBand: "track", src: "race/horse-gallop-lo.png",
    frameCount: 12, fps: 14, anchor: loMeta?.anchor ?? NOSE, palette: loPalette, variants: COATS,
    optimizationTier: "standard", animations: { gallop: { from: 0, to: 11, loop: true } },
    sourcePrompt: "v1 fallback 118x72: generate-image-v2 128x96 (seed 2201) -> animate-with-text-v3 12 frames (seed 32) -> role palette (race/palette-lo.json)",
  },
  {
    id: "horse.body.gallop.lo.normal", kind: "horse_body", depthBand: "track", src: "race/horse-gallop-lo-normal.png",
    frameCount: 12, fps: 14, anchor: loMeta?.anchor ?? NOSE, variants: ["normal-opengl"], optimizationTier: "standard",
    animations: { gallop: { from: 0, to: 11, loop: true } },
    sourcePrompt: "/normal-map mode=pro kind=character frames=12 on race/horse-gallop-lo.png",
  },
  { id: "horse.body.canter", kind: "horse_body", depthBand: "track", src: "race/horse-canter.png", fpsFrom: "race/horse-canter.meta.json", fps: 10, anchor: NOSE, palette: horsePalette, variants: COATS, optimizationTier: "hero", sourcePromptFrom: "race/horse-canter.meta.json" },
  { id: "horse.body.idle", kind: "horse_body", depthBand: "track", src: "race/horse-idle.png", fps: 6, anchor: NOSE, palette: horsePalette, variants: COATS, optimizationTier: "hero", sourcePromptFrom: "race/horse-idle.meta.json" },
  { id: "horse.body.idle.normal", kind: "horse_body", depthBand: "track", src: "race/horse-idle-normal.png", fps: 6, anchor: NOSE, variants: ["normal-opengl"], optimizationTier: "hero", sourcePromptFrom: "race/horse-idle.meta.json", sourcePrompt: "/normal-map mode=pro kind=character per frame of race/horse-idle.png (OpenGL)" },
  // --- race-day animations (art-src/race/gen-raceanims.mjs + build_raceanims.sh; STATUS.md "Race-day animations")
  ...raceDay(),
];

/** Race-day strips: 256x192, keyed with race/palette.json, anchor = the gallop's nose/ground point. */
function raceDay() {
  const SEED = "seed = race/horse-gallop.png frames pasted at a fixed offset (art-src/race/prep_raceanims.py)";
  const KEYED = "keyed to race/palette.json (art-src/race/process_raceanims.py)";
  const strips = [
    ["break", 12, false, `${SEED}; edit-images-v2 stall stance (seed 31004) -> animate-with-text-v3 8 frames with last_frame = gallop frame 0 (seed 31602): 'the starting stalls open: the racehorse springs forward out of the stalls, pushing off powerfully with both hind legs... lands into its first full galloping stride'; ${KEYED}`],
    ["drive", 14, true, `${SEED}; edit-images-v2 drive key (seed 31003: jockey crouched lower, arms pushing along the neck, no whip) -> animate-with-text-v3 12 frames (seed 31103): 'all-out gallop in the final furlong... jockey pushes hard, both hands pumping forward along the neck, heels squeezing; no whip; seamless loop'; ${KEYED}`],
    ["lunge", 12, false, `drive frame 11 -> animate-with-text-v3 6 frames with last_frame = edit-images-v2 lunge key (seeds 31005, 31702): 'one last lunge: head and neck stretched far forward and down, jockey throws both hands forward along the neck'; ${KEYED}`],
    ["easeup", 10, false, `${SEED}; animate-with-text-v3 12 frames with last_frame = a trotting frame (seed 31203): 'after the winning post the racehorse eases down: gallop, relaxed canter, slow bouncy trot; the jockey sits up gradually'; ${KEYED}`],
    ["celebrate", 10, true, `${SEED}; edit-images-v2 (seed 31002: jockey stands in the stirrups, right arm raised) -> animate-with-text-v3 10 frames (seed 31401): 'the racehorse canters... the winning jockey stands up in the stirrups and waves his raised right arm'; ${KEYED}`],
    ["pullup", 8, false, `${SEED}; animate-with-text-v3 12 frames (seed 31301): 'the jockey sits up and pulls the racehorse up mid-race... short uneven steps as if favouring its right foreleg' + 6 frames (seed 31302) to a standstill; every 2nd frame + 3 of the stop; ${KEYED}`],
  ];
  const out = [];
  for (const [name, fps, loop, prompt] of strips) {
    const meta = `race/horse-${name}.meta.json`;
    const anim = (n) => ({ [name]: { from: 0, to: n - 1, loop } });
    const n = extraMeta(meta).frameCount ?? 1;
    out.push(
      { id: `horse.body.${name}`, kind: "horse_body", depthBand: "track", src: `race/horse-${name}.png`, frameCount: n, fps, palette: horsePalette, variants: COATS, optimizationTier: "hero", sourcePromptFrom: meta, sourcePrompt: prompt, animations: anim(n) },
      { id: `horse.body.${name}.normal`, kind: "horse_body", depthBand: "track", src: `race/horse-${name}-normal.png`, frameCount: n, fps, variants: ["normal-opengl"], optimizationTier: "hero", sourcePromptFrom: meta, sourcePrompt: `/normal-map mode=pro kind=character per frame of race/horse-${name}.png (OpenGL)`, animations: anim(n) },
    );
  }
  for (const [name, what] of [["mud", "wet mud clods"], ["dust", "a dry dust puff"], ["divot", "turf divots"]]) {
    const meta = `race/fx-${name}.meta.json`;
    out.push(
      { id: `race.fx-${name}`, kind: "vfx", depthBand: "track", src: `race/fx-${name}.png`, frameCount: 8, sourcePromptFrom: meta, variants: ["keyed-recolour"], optimizationTier: "standard", animations: { [`fx-${name}`]: { from: 0, to: 7, loop: false } }, sourcePrompt: `/vfx artist=pro, 48x32, 8 frames: ${what} kicked up backwards behind a galloping hoof (prompts in art-src/race/gen-raceanims.mjs); keyed to a few source colours, tinted per surface/going via race/fx-palette.json (art-src/race/process_fx.py)` },
      { id: `race.fx-${name}.normal`, kind: "vfx", depthBand: "track", src: `race/fx-${name}-normal.png`, frameCount: 8, sourcePromptFrom: meta, variants: ["normal-opengl"], optimizationTier: "standard", animations: { [`fx-${name}`]: { from: 0, to: 7, loop: false } }, sourcePrompt: "computed in code: silhouette inflated to domes, OpenGL (art-src/race/fx_normals.py)" },
    );
  }
  const cheer = "animate-with-text-v3 8 frames on two overlapping 256 px windows of race/crowd.png (seeds 31501/31502): 'the racegoers behind the white rail cheer wildly... wave their arms and race cards, jump up and down, clap'; stitched with min-cut seams, snapped to crowd.png's palette, frames 0-5 ping-pong (art-src/race/process_crowd.py)";
  out.push(
    { id: "race.crowd-cheer", kind: "track_layer", depthBand: "mid", src: "race/crowd-cheer.png", frameCount: 10, fps: 8, anchor: { x: 0.5, y: 1 }, variants: ["seamless-x"], optimizationTier: "standard", sourcePrompt: cheer, animations: { "crowd-cheer": { from: 0, to: 9, loop: true } } },
    { id: "race.crowd-cheer.normal", kind: "track_layer", depthBand: "mid", src: "race/crowd-cheer-normal.png", frameCount: 10, fps: 8, anchor: { x: 0.5, y: 1 }, variants: ["normal-opengl"], optimizationTier: "standard", sourcePrompt: "/normal-map mode=lite kind=object per unique frame of race/crowd-cheer.png (OpenGL; ping-pong frames reuse their twin's map)", animations: { "crowd-cheer": { from: 0, to: 9, loop: true } } },
  );
  return out;
}

// Generic single-image entries registered by later batches (see art-src/assets.json).
const extra = existsSync(join(ROOT, "..", "..", "..", "..", "art-src", "assets.json"))
  ? JSON.parse(readFileSync(join(ROOT, "..", "..", "..", "..", "art-src", "assets.json"), "utf8"))
  : [];
R.push(...extra);

const assets = [];
for (const r of R) {
  const file = join(ROOT, r.src);
  if (!existsSync(file)) continue;
  const { w, h } = pngSize(file);
  const meta = r.sourcePromptFrom ? extraMeta(r.sourcePromptFrom) : {};
  const frameCount = r.frameCount ?? meta.frameCount ?? 1;
  const e = {
    id: r.id,
    kind: r.kind,
    origin: "pixellab",
    license: LICENSE,
    status: "approved",
    frameCount,
    frameWidth: r.frameWidth ?? Math.round(w / frameCount),
    frameHeight: r.frameHeight ?? h,
    fps: meta.fps ?? r.fps ?? 0,
    anchor: meta.anchor ?? r.anchor ?? { x: 0.5, y: 1 },
    depthBand: r.depthBand,
    palette: r.palette ?? [],
    variants: r.variants ?? [],
    sourcePrompt: (r.variants?.includes("normal-opengl") ? r.sourcePrompt : meta.sourcePrompt) ?? r.sourcePrompt ?? meta.sourcePrompt ?? null,
    optimizationTier: r.optimizationTier ?? "standard",
    src: r.src,
  };
  const anim = r.animations ?? (frameCount > 1 ? { [r.id.split(".").pop()]: { from: 0, to: frameCount - 1, loop: true } } : undefined);
  if (anim) e.animations = anim;
  assets.push(e);
}
// Keep entries other agents added (e.g. rig/*) that this script does not own.
const MINE = /^(race|portraits|ui|scenes)\//;
const prev = readJson("manifest.json");
const ids = new Set(assets.map((a) => a.id));
for (const a of prev?.assets ?? []) {
  if (!ids.has(a.id) && !(a.src && MINE.test(a.src))) assets.push(a);
}
writeFileSync(join(ROOT, "manifest.json"), JSON.stringify({ version: 1, assets }, null, 1) + "\n");
console.log(`manifest.json: ${assets.length} assets`);
