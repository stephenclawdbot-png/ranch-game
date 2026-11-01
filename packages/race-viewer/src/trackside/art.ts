/**
 * Trackside art loading (browser only): the keyed gallop and idle strips (+ normal maps,
 * palette) as shared palette-index textures with exact downsampled levels of detail, and
 * the track-dusk layer art (sky, hills, trees, rails, turf, posts) from the art drop.
 * Read only: the same files the "track-dusk" diorama uses. The horse sheets' derived data is
 * precomputed with the art (sheets.ts); the browser decodes it, the gallop first.
 */
import type { ArtSet } from "../three/art";
import { parseKeyPalette, type KeyPalette } from "../three/recolor";
import { sceneryArt, type CourseArtSrc, type SceneryRecipe } from "./scenery";
import { atlasFromRgba, type CoatAtlas } from "@thoroughbred/art-pipeline";
import { newPalette, type Palette } from "./strips";
import { buildStripSet, decodeSheet, finishSilk, gunzipResponse, paletteFrom, sheetFrame, SHEET_FORMAT, SHEET_ORDER, type SheetEntry, type SheetId, type SheetIndex, type SheetSource, type StripSet } from "./sheets";
import type { SheetDone, SheetJob } from "./sheet.worker";
import type { AnimId } from "../stage/motion";
import type { RaceStage } from "../stage/buildRaceStage";

export type { StripSet } from "./sheets";
export { RACE_DAY_STRIPS } from "./sheets";

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

export interface TracksideArt extends HorseSheets {
  images: Map<BackdropStem, HTMLImageElement>;
  /** The race's course scenery art (only that course's files are fetched). */
  course: Map<CourseArtSrc, HTMLImageElement>;
  /** The coat-layer atlas (race/coat-layers.png); null when it is missing (no patterns drawn). */
  atlas: CoatAtlas | null;
}

const base = (art: ArtSet) => art.base.replace(/\/$/, "");
const urlOf = (art: ArtSet, src: string) => (src.startsWith("/") || /^https?:/.test(src) ? src : `${base(art)}/${src}`);

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const i = new Image();
    i.decoding = "async";
    // decoded off the main thread before anyone draws it (a canvas draw would decode it on the spot)
    i.onload = () => (typeof i.decode === "function" ? i.decode().then(() => res(i), () => res(i)) : res(i));
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

/** A course's scenery art (manifest src paths), approved files only; missing ones are skipped. */
export async function loadCourseArt(art: ArtSet, recipe: SceneryRecipe | null): Promise<Map<CourseArtSrc, HTMLImageElement>> {
  const out = new Map<CourseArtSrc, HTMLImageElement>();
  if (!recipe || !art.manifest || typeof document === "undefined") return out;
  await Promise.all(
    sceneryArt(recipe).map(async (src) => {
      const e = approved(art, src);
      if (!e?.src) return;
      const im = await loadImg(urlOf(art, e.src));
      if (im) out.set(src, im);
    }),
  );
  return out;
}

/**
 * Every stage art file (manifest src: far panorama, midground, stand, rail decor, crowd),
 * approved files only; missing ones are skipped (the scenes fall back or leave them out).
 */
export async function loadStageArt(art: ArtSet, stage: RaceStage): Promise<Map<string, HTMLImageElement>> {
  const out = new Map<string, HTMLImageElement>();
  if (!art.manifest || typeof document === "undefined") return out;
  const sc = stage.scenery;
  const srcs = new Set<string>([sc.far, sc.stand.src, ...sc.midTemplate.items.map((i) => i.src), ...sc.crowd.map((c) => c.src), stage.landmarks.winningPost.art, "race/furlong-pole.png", ...stage.fx.emit.map((e) => `race/${e}.png`)]);
  if (sc.railDecor) srcs.add(sc.railDecor.src);
  await Promise.all(
    [...srcs].map(async (src) => {
      const e = approved(art, src);
      if (!e?.src) return;
      const im = await loadImg(urlOf(art, e.src));
      if (im) out.set(src, im);
    }),
  );
  return out;
}

/** race/fx-palette.json (ground fx recolour keys per surface); null when missing. */
export async function loadFxPalette(art: ArtSet): Promise<FxPalette | null> {
  if (!art.manifest || typeof fetch === "undefined") return null;
  return fetch(urlOf(art, "race/fx-palette.json"))
    .then((r) => (r.ok ? (r.json() as Promise<FxPalette>) : null))
    .catch(() => null);
}

export interface FxPalette {
  keys: Record<string, Record<string, string[]>>;
  surfaces: Record<string, Record<string, Record<string, string[]>>>;
  emit: Record<string, string[]>;
}

/** Sprite extents of a sheet (first level of detail), known before its pixels arrive. */
export interface SheetFrame {
  fw: number;
  fh: number;
  anchor: { x: number; y: number };
  pxPerM: number;
}

/** The horse sheets of an art set: the gallop at once, the others as they arrive. */
export interface HorseSheets {
  palette: Palette;
  keys: KeyPalette;
  gallop: StripSet;
  idle: StripSet | null;
  strips: Partial<Record<AnimId, StripSet>>;
  /** Extents of every sheet that is loaded or on its way (the layout's sprite box never changes as they arrive). */
  frames: SheetFrame[];
  /** Bumps whenever a sheet arrives: scenes adopt the new ones when it changes. */
  version: number;
  /** Resolves once every sheet has arrived (or failed). */
  complete: Promise<void>;
}

/** Sheets the views need first; the rest follow in idle time (the views fall back to the gallop meanwhile). */
export const FIRST_SHEETS: readonly SheetId[] = ["gallop"];

const sheetCache = new Map<string, Promise<HorseSheets | null>>();

/**
 * The horse sheets: the precomputed files (race/sheets, built with the art: decode only) when
 * they match the manifest, else built here from the sheet files (the same code, slower).
 * `first`: sheets to have before resolving (the gallop always). Shared by every scene of the
 * page (read only).
 */
export function loadHorseSheets(art: ArtSet, first: readonly SheetId[] = FIRST_SHEETS): Promise<HorseSheets | null> {
  if (!art.manifest || typeof document === "undefined") return Promise.resolve(null);
  const id = `${base(art)}|${art.manifest.version}`;
  let p = sheetCache.get(id);
  if (!p) {
    p = loadSheetsNow(art, first).catch((err) => {
      console.warn("[RaceViewer] horse sheets failed", err);
      return null;
    });
    sheetCache.set(id, p);
    void p.then((s) => {
      if (!s) sheetCache.delete(id);
    });
  }
  return p;
}

const yieldTask = () => new Promise<void>((r) => setTimeout(r, 0));

async function fetchJson(url: string): Promise<unknown> {
  return fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}

const sameEntry = (a: SheetEntry, b: { frameWidth: number; frameHeight: number; frameCount: number; anchor: { x: number; y: number } }) =>
  a.frameWidth === b.frameWidth && a.frameHeight === b.frameHeight && a.frameCount === b.frameCount && a.anchor.x === b.anchor.x && a.anchor.y === b.anchor.y;

// ------------------------------------------------------------------ the decoding workers

/** Up to two decoders (gallop and the next sheet at once on a multi-core phone); null = decode here. */
let decoders: Worker[] | null | undefined;
let nextDecoder = 0;
let nextJob = 1;
const waiting = new Map<number, (done: SheetDone | "failed") => void>();

function sheetDecoders(): Worker[] | null {
  if (decoders !== undefined) return decoders;
  decoders = null;
  if (typeof Worker !== "function") return null;
  // `?sheets=main` decodes on the page (comparison and tests: the same arrays either way)
  if (/[?&]sheets=main(&|$)/.test(globalThis.location?.search ?? "")) return null;
  const n = Math.max(1, Math.min(2, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1));
  try {
    const pool: Worker[] = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL("./sheet.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<SheetDone>) => {
        const r = waiting.get(e.data.id);
        waiting.delete(e.data.id);
        r?.(e.data);
      };
      w.onerror = () => {
        // a worker could not start (or died): decode what it held here
        decoders = null;
        for (const x of pool) x.terminate();
        for (const [id, r] of waiting) {
          waiting.delete(id);
          r("failed");
        }
      };
      pool.push(w);
    }
    decoders = pool;
  } catch {
    decoders = null;
  }
  return decoders;
}

function workerJob(w: Worker, job: (id: number) => SheetJob): Promise<SheetDone | "failed"> {
  return new Promise((res) => {
    const id = nextJob++;
    waiting.set(id, res);
    w.postMessage(job(id));
  });
}

/** One precomputed sheet: fetched and decoded in a worker (here when workers are unavailable). */
async function decodeAt(url: string, palette: Palette): Promise<StripSet | null> {
  const pool = sheetDecoders();
  if (pool?.length) {
    const w = pool[nextDecoder++ % pool.length]!;
    const abs = new URL(url, globalThis.location?.href).href;
    const r = await workerJob(w, (id) => ({ id, url: abs, palette: palette.colours }));
    if (r !== "failed") return r.st ?? null;
  }
  const res = await fetch(url);
  if (!res.ok) return null;
  const raw = await gunzipResponse(res);
  await yieldTask();
  return decodeSheet(raw, palette);
}

function attach(set: HorseSheets, id: SheetId, st: StripSet) {
  if (id === "gallop") set.gallop = st;
  else if (id === "idle") set.idle = st;
  else set.strips[id] = st;
  set.version++;
}

async function loadSheetsNow(art: ArtSet, firstIds: readonly SheetId[]): Promise<HorseSheets | null> {
  const gEntry = approved(art, "horse-gallop.png");
  if (!gEntry?.src) return null;
  const dir = gEntry.src.slice(0, gEntry.src.length - "horse-gallop.png".length);
  const canGunzip = typeof (globalThis as { DecompressionStream?: unknown }).DecompressionStream === "function";
  const [json, rawIndex] = await Promise.all([fetchJson(urlOf(art, `${dir}palette.json`)), canGunzip ? fetchJson(urlOf(art, `${dir}sheets/index.json`)) : Promise.resolve(null)]);
  const keys = parseKeyPalette(json);
  if (!keys) return null;
  const index = rawIndex as SheetIndex | null;
  // Precomputed: every listed sheet must match its approved manifest entry (else the art moved on: build here).
  const wanted = SHEET_ORDER.filter((s) => approved(art, `${s.stem}.png`));
  const usable =
    index &&
    index.format === SHEET_FORMAT &&
    Array.isArray(index.sheets) &&
    Array.isArray(index.palette) &&
    wanted.every((s) => {
      const e = approved(art, `${s.stem}.png`)!;
      const x = index.sheets.find((q) => q.id === s.id);
      return !!x && x.pxPerM === s.pxPerM && sameEntry(x.entry, e);
    });
  if (usable) {
    const set = await precomputed(art, dir, index, keys, firstIds);
    if (set) return set;
  }
  return buildHere(art, keys);
}

/** Decode the precomputed sheets: `first` before resolving, the rest one per task afterwards. */
async function precomputed(art: ArtSet, dir: string, index: SheetIndex, keys: KeyPalette, firstIds: readonly SheetId[]): Promise<HorseSheets | null> {
  const palette = paletteFrom(index.palette);
  const order = SHEET_ORDER.map((o) => index.sheets.find((s) => s.id === o.id)).filter((s): s is SheetIndex["sheets"][number] => !!s && !!approved(art, `${s.stem}.png`));
  const first = new Set<SheetId>(["gallop", ...firstIds]);
  const jobs = new Map<SheetId, Promise<StripSet | null>>();
  const decode = (id: SheetId) => {
    let j = jobs.get(id);
    if (!j) {
      const s = order.find((x) => x.id === id);
      j = s ? decodeAt(urlOf(art, `${dir}sheets/${s.file}`), palette).catch(() => null) : Promise.resolve(null);
      jobs.set(id, j);
    }
    return j;
  };
  // the opening picture's sheets at once (in workers, in parallel); the rest after them
  for (const s of order) if (first.has(s.id)) void decode(s.id);
  const gallop = await decode("gallop");
  if (!gallop) return null;
  let done!: () => void;
  const set: HorseSheets = {
    palette,
    keys,
    gallop,
    idle: null,
    strips: {},
    frames: order.map((s) => ({ ...sheetFrame(s.entry, Infinity), pxPerM: s.pxPerM })),
    version: 0,
    complete: new Promise<void>((r) => (done = r)),
  };
  for (const s of order) {
    if (s.id === "gallop" || !first.has(s.id)) continue;
    const st = await decode(s.id);
    if (st) attach(set, s.id, st);
  }
  void (async () => {
    for (const s of order) {
      if (first.has(s.id)) continue;
      const st = await decode(s.id);
      if (st) attach(set, s.id, st);
    }
  })().finally(done);
  return set;
}

/** Build every sheet here from its files (no precomputed data): in palette order, a task per sheet. */
async function buildHere(art: ArtSet, keys: KeyPalette): Promise<HorseSheets | null> {
  const load = async (stem: string): Promise<SheetSource | null> => {
    const entry = approved(art, `${stem}.png`);
    if (!entry?.src) return null;
    const nEntry = approved(art, `${stem}-normal.png`);
    const fEntry = approved(art, `${stem}-f.png`);
    const [img, nImg, fImg] = await Promise.all([
      loadImg(urlOf(art, entry.src)),
      nEntry?.src && nEntry.frameWidth === entry.frameWidth ? loadImg(urlOf(art, nEntry.src)) : null,
      fEntry?.src ? loadImg(urlOf(art, fEntry.src)) : null,
    ]);
    if (!img) return null;
    const same = (i: HTMLImageElement | null) => !!i && i.naturalWidth === img.naturalWidth && i.naturalHeight === img.naturalHeight;
    return { entry, rgba: pixels(img), width: img.naturalWidth, height: img.naturalHeight, normal: same(nImg) ? pixels(nImg!) : null, woman: same(fImg) ? pixels(fImg!) : null };
  };
  // all the files at once; each sheet is built in palette order as its files arrive
  const pending = SHEET_ORDER.map((s) => ({ s, src: load(s.stem).catch(() => null) }));
  const palette = newPalette();
  const built: Partial<Record<SheetId, StripSet>> = {};
  const frames: SheetFrame[] = [];
  for (const { s, src } of pending) {
    const source = await src;
    if (!source) {
      if (s.id === "gallop") return null;
      continue;
    }
    await yieldTask();
    const st = buildStripSet(source, s.stem, palette, s.pxPerM, keys);
    if (!st) {
      if (s.id === "gallop") return null;
      continue;
    }
    built[s.id] = st;
    frames.push({ ...sheetFrame(source.entry, source.width), pxPerM: s.pxPerM });
  }
  finishSilk(Object.values(built), palette, keys);
  const { gallop, idle, ...strips } = built;
  return { palette, keys, gallop: gallop!, idle: idle ?? null, strips, frames, version: 0, complete: Promise.resolve() };
}

/**
 * Everything the Trackside view needs; null when the keyed gallop strip is unavailable. The
 * horse sheets past `first` keep arriving after it resolves (`TracksideArt.version`).
 */
export async function loadTracksideArt(art: ArtSet, recipe: SceneryRecipe | null = null, first: readonly SheetId[] = FIRST_SHEETS): Promise<TracksideArt | null> {
  if (!art.manifest || typeof document === "undefined") return null;
  const images = new Map<BackdropStem, HTMLImageElement>();
  const coursePending = loadCourseArt(art, recipe);
  const atlasPending = loadCoatAtlas(art);
  const imagesPending = Promise.all(
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
  const sheets = await loadHorseSheets(art, first);
  if (!sheets) return null;
  await imagesPending;
  const course = await coursePending;
  const atlas = await atlasPending;
  // the sheets are shared (and keep arriving): read through to them
  return {
    get palette() {
      return sheets.palette;
    },
    get keys() {
      return sheets.keys;
    },
    get gallop() {
      return sheets.gallop;
    },
    get idle() {
      return sheets.idle;
    },
    get strips() {
      return sheets.strips;
    },
    get frames() {
      return sheets.frames;
    },
    get version() {
      return sheets.version;
    },
    get complete() {
      return sheets.complete;
    },
    images,
    course,
    atlas,
  };
}

/** The coat-layer atlas from the art drop (1x: race/coat-layers.png, or 2x for portraits). */
export async function loadCoatAtlas(art: ArtSet, scale: 1 | 2 = 1): Promise<CoatAtlas | null> {
  if (!art.manifest || typeof document === "undefined") return null;
  const e = approved(art, scale === 2 ? "coat-layers-2x.png" : "coat-layers.png");
  if (!e?.src) return null;
  // read in a decoding worker when there is one (the canvas readback is a long task on a phone)
  const pool = sheetDecoders();
  if (pool?.length) {
    const url = new URL(urlOf(art, e.src), globalThis.location?.href).href;
    const r = await workerJob(pool[nextDecoder++ % pool.length]!, (id) => ({ kind: "atlas", id, url }));
    if (r !== "failed" && r.atlas) return { scale, width: r.atlas.width, height: r.atlas.height, data: r.atlas.data };
  }
  const img = await loadImg(urlOf(art, e.src));
  if (!img) return null;
  return atlasFromRgba(pixels(img), img.naturalWidth, img.naturalHeight, scale);
}
