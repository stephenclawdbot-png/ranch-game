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
];

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
    sourcePrompt: meta.sourcePrompt ?? r.sourcePrompt ?? null,
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
