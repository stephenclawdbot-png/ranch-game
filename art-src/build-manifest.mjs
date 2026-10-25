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
const readJson = (f) => (existsSync(join(ROOT, f)) ? JSON.parse(readFileSync(join(ROOT, f), "utf8")) : null);

const COATS = ["bay", "dark_bay", "chestnut", "liver_chestnut", "black", "grey", "dapple_grey", "palomino", "buckskin", "roan"];
const NOSE = { x: 0.94, y: 0.97 };

const pal = readJson("race/palette.json");
const horsePalette = pal
  ? [...pal.coat, ...pal.mane, ...(pal.points ?? []), ...pal.silksPrimary, ...pal.silksSecondary, ...pal.cap]
  : [];
const gallopMeta = readJson("race/horse-gallop.meta.json");
const extraMeta = (f) => readJson(f) ?? {};

/** @type {Array<Record<string, any>>} */
const R = [
  // --- race: horse ---------------------------------------------------------------
  {
    id: "horse.body.gallop", kind: "horse_body", depthBand: "track", src: "race/horse-gallop.png",
    frameCount: 12, fps: 14, anchor: gallopMeta?.anchor ?? NOSE, palette: horsePalette, variants: COATS,
    optimizationTier: "hero", animations: { gallop: { from: 0, to: 11, loop: true } },
    sourcePrompt: "generate-image-v2: side view thoroughbred racehorse galloping facing right, bay coat, black points, jockey crouched, flat magenta silks body, cyan sleeves, magenta cap, white saddle cloth (seed 2201) -> animate-with-text-v3 'racehorse galloping at full speed, one complete gallop stride cycle...' 12 frames (seed 32) -> role-quantised palette (art-src/process_gallop.py)",
  },
  {
    id: "horse.body.gallop.normal", kind: "horse_body", depthBand: "track", src: "race/horse-gallop-normal.png",
    frameCount: 12, fps: 14, anchor: gallopMeta?.anchor ?? NOSE, variants: ["normal-opengl"], optimizationTier: "hero",
    animations: { gallop: { from: 0, to: 11, loop: true } },
    sourcePrompt: "/normal-map mode=pro kind=character frames=12 on race/horse-gallop.png (OpenGL convention, green up)",
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
writeFileSync(join(ROOT, "manifest.json"), JSON.stringify({ version: 1, assets }, null, 1) + "\n");
console.log(`manifest.json: ${assets.length} assets`);
