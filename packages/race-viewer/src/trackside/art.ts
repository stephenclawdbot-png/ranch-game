/**
 * Trackside art loading (browser only): the keyed gallop and idle strips (+ normal maps,
 * palette) as shared palette-index textures with exact downsampled levels of detail, and
 * the track-dusk layer art (sky, hills, trees, rails, turf, posts) from the art drop.
 * Read only: the same files the "track-dusk" diorama uses.
 */
import type { ArtSet } from "../three/art";
import { parseKeyPalette, type KeyPalette } from "../three/recolor";
import { downsampleFrames, buildMarkMasks, indexStrip, newPalette, primaryIndices, silkBoxes, type IndexedFrames, type Palette } from "./strips";

export const BACKDROP_STEMS = [
  "sky-dusk",
  "sky-clear",
  "sky-overcast",
  "far-hills",
  "bb-tree-oak",
  "bb-tree-oak-b",
  "bb-tree-poplar",
  "rail-far",
  "rail-near",
  "track-turf",
  "track-dirt",
  "finish-post",
  "furlong-pole",
  "starting-stall",
  "starting-stall-front",
  "starting-stall-door",
] as const;
export type BackdropStem = (typeof BACKDROP_STEMS)[number];

export interface StripSet {
  /** Levels of detail: lods[s - 1] is the s:1 copy (s = 1..4). */
  lods: IndexedFrames[];
  /** Per-frame silks box (source texels). */
  silk: Float32Array;
  /** Marking masks at lods[0] resolution (RGBA grid; R region, G param, B face edge). */
  mask: Uint8Array;
  /** Source texels per metre (the idle strip is authored a little larger). */
  pxPerM: number;
}

export interface TracksideArt {
  palette: Palette;
  keys: KeyPalette;
  gallop: StripSet;
  idle: StripSet | null;
  images: Map<BackdropStem, HTMLImageElement>;
}

const base = (art: ArtSet) => art.base.replace(/\/$/, "");
const urlOf = (art: ArtSet, src: string) => (src.startsWith("/") || /^https?:/.test(src) ? src : `${base(art)}/${src}`);

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const i = new Image();
    i.decoding = "async";
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
}

function pixels(img: HTMLImageElement): Uint8ClampedArray {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(img, 0, 0);
  return x.getImageData(0, 0, c.width, c.height).data;
}

function approved(art: ArtSet, file: string) {
  return art.manifest?.assets.find((a) => a.status === "approved" && a.src && (a.src === file || a.src.endsWith(`/${file}`)));
}

async function stripSet(art: ArtSet, stem: string, palette: Palette, pxPerM: number, keys: KeyPalette): Promise<StripSet | null> {
  const entry = approved(art, `${stem}.png`);
  if (!entry?.src) return null;
  const img = await loadImg(urlOf(art, entry.src));
  if (!img) return null;
  const nEntry = approved(art, `${stem}-normal.png`);
  const nImg = nEntry?.src && nEntry.frameWidth === entry.frameWidth ? await loadImg(urlOf(art, nEntry.src)) : null;
  const rgba = pixels(img);
  const nrm = nImg && nImg.naturalWidth === img.naturalWidth && nImg.naturalHeight === img.naturalHeight ? pixels(nImg) : null;
  const fw = entry.frameWidth;
  const fh = entry.frameHeight;
  const frames = Math.max(1, Math.min(entry.frameCount, Math.floor(img.naturalWidth / fw)));
  const anchor = { x: Math.round(entry.anchor.x * fw), y: Math.round(entry.anchor.y * fh) };
  const l1 = indexStrip(rgba, img.naturalWidth, fh, frames, palette, anchor, nrm);
  if (!l1) return null;
  const lods = [l1, downsampleFrames(l1, 2, palette), downsampleFrames(l1, 3, palette), downsampleFrames(l1, 4, palette)];
  return { lods, silk: new Float32Array(0), mask: buildMarkMasks(l1, palette, keys), pxPerM };
}

/** Everything the Trackside view needs; null when the keyed gallop strip is unavailable. */
export async function loadTracksideArt(art: ArtSet): Promise<TracksideArt | null> {
  if (!art.manifest || typeof document === "undefined") return null;
  const gEntry = approved(art, "horse-gallop.png");
  if (!gEntry?.src) return null;
  const dir = gEntry.src.slice(0, gEntry.src.length - "horse-gallop.png".length);
  const json = await fetch(urlOf(art, `${dir}palette.json`))
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const keys = parseKeyPalette(json);
  if (!keys) return null;
  const palette = newPalette();
  const gallop = await stripSet(art, "horse-gallop", palette, 96, keys);
  if (!gallop) return null;
  // The idle strip shares the key palette; its horse is drawn ~8 % larger per texel.
  const idle = await stripSet(art, "horse-idle", palette, 104, keys).catch(() => null);
  const primary = primaryIndices(palette, keys);
  gallop.silk = silkBoxes(gallop.lods[0]!, primary);
  if (idle) idle.silk = silkBoxes(idle.lods[0]!, primary);

  const images = new Map<BackdropStem, HTMLImageElement>();
  await Promise.all(
    BACKDROP_STEMS.map(async (stem) => {
      const have = art.images.get(stem);
      if (have) {
        images.set(stem, have);
        return;
      }
      const e = approved(art, `${stem}.png`);
      if (!e?.src) return;
      const im = await loadImg(urlOf(art, e.src));
      if (im) images.set(stem, im);
    }),
  );
  return { palette, keys, gallop, idle, images };
}
