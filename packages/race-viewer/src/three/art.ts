/**
 * Runtime art lookup: `${base}/manifest.json` (AssetManifestSchema). Only approved
 * entries with a src are used; anything missing (or a 404 manifest) falls back to
 * the code-drawn textures. Lookups are by file name (`race/tex-turf.png`) so the
 * art agent's ids don't matter.
 */
import { AssetManifestSchema, type AssetManifest } from "@thoroughbred/art-pipeline";

export interface ArtSet {
  base: string;
  manifest: AssetManifest | null;
  /** Loaded images keyed by file stem, e.g. "tex-turf", "bb-tree-oak". */
  images: Map<string, HTMLImageElement>;
}

function resolveSrc(base: string, src: string): string {
  if (/^(https?:)?\/\//.test(src) || src.startsWith("/")) return src;
  return `${base.replace(/\/$/, "")}/${src.replace(/^\.\//, "")}`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

/** Stems the 3D scene can use from the art drop. */
export const SCENE_ART = [
  "tex-turf",
  "tex-dirt",
  "tex-grass",
  "tex-gravel",
  "tex-hedge",
  "bb-tree-oak",
  "bb-tree-poplar",
  "bb-bush",
  "bb-crowd-a",
  "bb-crowd-b",
  "bb-flag",
  "bb-grandstand",
  "far-hills",
  "sky-clear",
  "sky-dusk",
  "sky-overcast",
  "finish-post",
  "furlong-pole",
] as const;

export async function loadArt(base: string | null, timeoutMs = 4000): Promise<ArtSet> {
  const empty: ArtSet = { base: base ?? "", manifest: null, images: new Map() };
  if (!base || typeof fetch === "undefined") return empty;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${base.replace(/\/$/, "")}/manifest.json`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return empty;
    const parsed = AssetManifestSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn("[RaceViewer] art manifest failed validation; using code-drawn art", parsed.error.issues.slice(0, 3));
      return empty;
    }
    const manifest = parsed.data;
    const wanted = new Set<string>(SCENE_ART);
    const images = new Map<string, HTMLImageElement>();
    await Promise.all(
      manifest.assets
        .filter((a) => a.status === "approved" && a.src)
        .map(async (a) => {
          const stem = a.src!.split("/").pop()!.replace(/\.png$/i, "");
          if (!wanted.has(stem)) return;
          try {
            images.set(stem, await loadImage(resolveSrc(base, a.src!)));
          } catch {
            /* fall back for this slot */
          }
        }),
    );
    return { base, manifest, images };
  } catch {
    return empty;
  }
}
