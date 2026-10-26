#!/usr/bin/env node
// Writes src/lib/art.index.json: every approved PixelLab PNG under public/art with its size.
// Vercel functions can't read public/ at runtime, so the server falls back to this index
// (src/lib/art.server.ts). Run by `pnpm build`; a test checks it is in sync with the files.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(app, "public", "art");

function walk(dir, out) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".png")) out.push(p);
  }
}
function pngSize(file) {
  const buf = readFileSync(file);
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
const hidden = new Set();
const mf = join(ROOT, "manifest.json");
if (existsSync(mf)) {
  const m = JSON.parse(readFileSync(mf, "utf8"));
  for (const a of m.assets ?? []) if (a.src && a.status && a.status !== "approved") hidden.add(a.src.replace(/^\/?(art\/)?/, ""));
}
const files = [];
if (existsSync(ROOT)) walk(ROOT, files);
const out = [];
for (const f of files) {
  const path = relative(ROOT, f).split(sep).join("/");
  if (hidden.has(path)) continue;
  const size = pngSize(f);
  if (size) out.push({ path, ...size });
}
writeFileSync(join(app, "src/lib/art.index.json"), JSON.stringify(out, null, 0).replace(/},{/g, "},\n{") + "\n");
console.log(`art index: ${out.length} files`);
