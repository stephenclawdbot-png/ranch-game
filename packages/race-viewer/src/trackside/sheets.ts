/**
 * The per-sheet derived data of the horse strips (pure, no DOM): everything the Trackside and
 * 3D views need from one animation sheet (palette-index levels of detail, normals, marking and
 * coat masks, hair, build landmarks, silks boxes). It depends only on the sheet files and the
 * art version, never on a horse, so it is built once at build time (`sheets.bake.test.ts`
 * writes `race/sheets/*`, versioned by content hash) and the browser only decodes it. The same
 * code builds it in the browser when the precomputed files are missing or stale.
 *
 * Every sheet indexes into ONE palette, grown in `SHEET_ORDER` (gallop first), so the order is
 * part of the data: precomputed files carry that palette, and a fallback build uses the order.
 * The file format is in sheetCodec.ts.
 */
import { buildCoatGeometry, hairField, sheetSpeed, warpAnchors } from "@thoroughbred/art-pipeline";
import type { KeyPalette } from "../three/recolor";
import { applyHairField, buildMarkMasks, coatMasks, downsampleFrames, indexStrip, indexedRoleGrid, newPalette, primaryIndices, silkBoxes, stripLongHair, stripSaddleCloth, womanMasks, type Palette } from "./strips";
import type { SheetEntry, SheetId, StripSet } from "./sheetCodec";

export * from "./sheetCodec";

/** Race-day strips: same palette keys and density as the gallop (art STATUS 1b). */
export const RACE_DAY_STRIPS = ["break", "drive", "lunge", "easeup", "celebrate", "pullup"] as const;

/** Every sheet, in the order its colours enter the shared palette. */
export const SHEET_ORDER: readonly { id: SheetId; stem: string; pxPerM: number }[] = [
  { id: "gallop", stem: "horse-gallop", pxPerM: 96 },
  // The idle strip shares the key palette; its horse is drawn ~8 % larger per texel.
  { id: "idle", stem: "horse-idle", pxPerM: 104 },
  ...RACE_DAY_STRIPS.map((id) => ({ id, stem: `horse-${id}`, pxPerM: 96 })),
];

/** One sheet's decoded files (8-bit RGBA, straight alpha). */
export interface SheetSource {
  entry: SheetEntry;
  rgba: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
  /** The -normal strip (same size) or null. */
  normal: Uint8ClampedArray | Uint8Array | null;
  /** The -f strip (women riders, same size) or null. */
  woman: Uint8ClampedArray | Uint8Array | null;
}

/** Derived data of one sheet (silks boxes are filled by `finishSilk` once the palette is complete). */
export function buildStripSet(src: SheetSource, stem: string, palette: Palette, pxPerM: number, keys: KeyPalette): StripSet | null {
  const { entry, rgba, width, height } = src;
  const nrm = src.normal && src.normal.length === rgba.length ? src.normal : null;
  const fw = entry.frameWidth;
  const fh = entry.frameHeight;
  const frames = Math.max(1, Math.min(entry.frameCount, Math.floor(width / fw)));
  const anchor = { x: Math.round(entry.anchor.x * fw), y: Math.round(entry.anchor.y * fh) };
  const l1 = indexStrip(rgba, width, fh, frames, palette, anchor, nrm);
  if (!l1) return null;
  const lods = [l1, downsampleFrames(l1, 2, palette), downsampleFrames(l1, 3, palette), downsampleFrames(l1, 4, palette)];
  const grid = indexedRoleGrid(l1, palette, keys);
  const geo = buildCoatGeometry(grid);
  const speed = sheetSpeed(`race/${stem}`);
  // the feathered horse's long hair, grown once per strip (it streams back by the strip's speed)
  const hair = stripLongHair(l1, palette, keys, geo, speed);
  // the saddle cloth (V-03), found once per strip; the scenes paint it per runner (LUT) or not at all
  const cloth = stripSaddleCloth(l1, palette, keys, geo);
  const mask = buildMarkMasks(l1, palette, keys, geo, hair, cloth);
  const cm = coatMasks(l1, geo, hair, palette);
  // women riders: the -f strip's differences go into the same mask (one strip for every runner)
  if (src.woman && src.woman.length === rgba.length) {
    const lf = indexStrip(src.woman, width, fh, frames, palette, anchor, null);
    if (lf) womanMasks(l1, lf, mask);
  }
  void height;
  // per-horse mane and tail (V-05) and the build landmarks (V-04): the same as the CPU painter's
  applyHairField(l1, geo, hairField(grid, geo, speed), mask, cm.pq);
  return { lods, silk: new Float32Array(0), mask, maskUv: cm.uv, maskPq: cm.pq, geoH: cm.H, pxPerM, warp: warpAnchors(geo, grid) };
}

/** Silks boxes of every sheet (the primary keys' indices, once the palette is complete). */
export function finishSilk(sets: Iterable<StripSet | null | undefined>, palette: Palette, keys: KeyPalette): void {
  const primary = primaryIndices(palette, keys);
  for (const st of sets) if (st) st.silk = silkBoxes(st.lods[0]!, primary);
}

/** All sheets, in palette order, from their sources (missing or unindexable ones are left out). */
export function buildAllSheets(sources: Partial<Record<SheetId, SheetSource>>, keys: KeyPalette): { palette: Palette; sheets: Partial<Record<SheetId, StripSet>> } | null {
  const palette = newPalette();
  const sheets: Partial<Record<SheetId, StripSet>> = {};
  for (const s of SHEET_ORDER) {
    const src = sources[s.id];
    if (!src) continue;
    const st = buildStripSet(src, s.stem, palette, s.pxPerM, keys);
    if (st) sheets[s.id] = st;
    else if (s.id === "gallop") return null;
  }
  finishSilk(Object.values(sheets), palette, keys);
  return { palette, sheets };
}

