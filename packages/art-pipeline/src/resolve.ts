import type { AssetEntry, AssetManifest } from "./manifest";

export interface ResolvedAsset {
  /** The manifest entry, if the slot exists. */
  entry: AssetEntry | undefined;
  /** True when the renderer must draw this slot procedurally. */
  fallback: boolean;
  /** Human-readable reason (useful in debug overlays). */
  reason: "approved" | "missing" | "not_approved" | "no_src";
}

/**
 * Look up a slot. Only `approved` entries with a `src` are used as real art;
 * everything else (placeholder, pending review, missing) falls back to procedural.
 */
export function resolveAsset(manifest: AssetManifest, id: string): ResolvedAsset {
  const entry = manifest.assets.find((a) => a.id === id);
  if (!entry) return { entry: undefined, fallback: true, reason: "missing" };
  if (entry.status !== "approved") return { entry, fallback: true, reason: "not_approved" };
  if (!entry.src) return { entry, fallback: true, reason: "no_src" };
  return { entry, fallback: false, reason: "approved" };
}
