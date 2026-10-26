import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { ArtFile } from "./art";
import ART_INDEX from "./art.index.json";

const ROOT = join(process.cwd(), "public", "art");

/** PNG intrinsic size from the IHDR chunk (bytes 16..23). */
function pngSize(file: string): { w: number; h: number } | null {
  try {
    const buf = readFileSync(file);
    if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".png")) out.push(p);
  }
}

/** Files the manifest explicitly marks as not approved (drafts) are hidden from the UI. */
function unapproved(): Set<string> {
  const out = new Set<string>();
  const mf = join(ROOT, "manifest.json");
  if (!existsSync(mf)) return out;
  try {
    const m = JSON.parse(readFileSync(mf, "utf8")) as { assets?: { src?: string | null; status?: string }[] };
    for (const a of m.assets ?? []) {
      if (a.src && a.status && a.status !== "approved") out.add(a.src.replace(/^\/?(art\/)?/, ""));
    }
  } catch {
    /* malformed manifest: trust files on disk */
  }
  return out;
}

/**
 * Every approved PixelLab PNG under public/art (read at render time, or the build-time index).
 * Small (a few dozen entries), passed to the client through <ArtProvider>.
 */
export function listArt(): ArtFile[] {
  // Vercel functions don't ship public/ (the CDN serves it): use the build-time index
  // (scripts/art-index.mjs). Locally the folder is read live, so new art shows at once.
  if (!existsSync(ROOT)) return ART_INDEX as ArtFile[];
  const files: string[] = [];
  try {
    walk(ROOT, files);
  } catch {
    return ART_INDEX as ArtFile[];
  }
  if (files.length === 0) return ART_INDEX as ArtFile[];
  const hidden = unapproved();
  const out: ArtFile[] = [];
  for (const f of files) {
    const path = relative(ROOT, f).split(sep).join("/");
    if (hidden.has(path)) continue;
    const size = pngSize(f);
    if (size) out.push({ path, ...size });
  }
  return out;
}
