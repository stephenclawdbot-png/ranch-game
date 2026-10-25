/**
 * Horse sprite source for the 3D scene. Uses `@thoroughbred/pixel-rig` when its
 * implementation is present at runtime; otherwise the code-drawn placeholder strip
 * below (same `HorseRig` contract, so the scene doesn't care which it gets).
 */
import type * as THREE from "three";
import type { HorseRig, HorseRigFactory, HorseRigState } from "@thoroughbred/pixel-rig";
import type { HorseAppearance } from "@thoroughbred/shared";
import type { ArtSet } from "./art";
import { PH_ANCHOR, PH_FRAMES, PH_H, PH_W, placeholderStripFor } from "./placeholderHorse";
import { appearanceKey, applyRecolor, buildRecolorPlan, parseKeyPalette, type KeyPalette } from "./recolor";

export type { HorseRig, HorseRigFactory, HorseRigState };

/** Our strip rigs may also carry a tangent-space normal map (same frame layout). */
export type LitHorseRig = HorseRig & { normalMap?: THREE.Texture };

export type RigKind = "pixel-rig" | "pixellab-strip" | "placeholder";

/**
 * Horse sprites, best first: the pixel-rig package (code-driven skeletal rig), then the
 * approved PixelLab gallop strip recoloured per horse, then the code-drawn placeholder.
 */
/**
 * The pixel rig is still in development, so it is opt-in: `?rig=1` on the page URL or
 * NEXT_PUBLIC_PIXEL_RIG=1 at build time. Without it the approved PixelLab strip is used.
 */
function pixelRigEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_PIXEL_RIG === "1") return true;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("rig") === "1";
}

export async function createRigFactory(three: typeof THREE, artBaseUrl: string | null, art?: ArtSet): Promise<{ factory: HorseRigFactory; kind: RigKind }> {
  if (pixelRigEnabled()) try {
    const mod = (await import("@thoroughbred/pixel-rig")) as { createHorseRigFactory?: (o?: { artBaseUrl?: string }) => HorseRigFactory };
    if (typeof mod.createHorseRigFactory === "function") {
      const factory = mod.createHorseRigFactory(artBaseUrl ? { artBaseUrl } : undefined);
      await factory.ready();
      return { factory, kind: "pixel-rig" };
    }
  } catch (err) {
    console.warn("[RaceViewer] pixel-rig unavailable, using placeholder horses", err);
  }
  const strip = art ? await loadGallopStrip(art) : null;
  if (strip) return { factory: stripFactory(three, strip), kind: "pixellab-strip" };
  return { factory: placeholderFactory(three), kind: "placeholder" };
}

interface GallopStrip {
  data: ImageData;
  frameCount: number;
  frameWidth: number;
  frameHeight: number;
  anchor: { x: number; y: number };
  keys: KeyPalette;
  normal: HTMLImageElement | null;
}

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
}

/** Share of opaque pixels that are exact palette keys (guards against a stale palette). */
function keyCoverage(data: ImageData, keys: KeyPalette): number {
  const set = new Set<number>();
  for (const ramp of [keys.coat, keys.mane, keys.points, keys.silksPrimary, keys.silksSecondary, keys.cap]) {
    for (const h of ramp ?? []) set.add(Number.parseInt(h.slice(1), 16));
  }
  let opaque = 0;
  let hit = 0;
  const d = data.data;
  for (let i = 0; i < d.length; i += 16) {
    if (d[i + 3]! < 128) continue;
    opaque++;
    if (set.has((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!)) hit++;
  }
  return opaque ? hit / opaque : 0;
}

/**
 * The approved gallop strip: the HD strip (`race/horse-gallop.png`, ~240x150 frames)
 * first, then the low-res `race/horse-gallop-lo.png`. Each needs a palette whose keys
 * actually occur in it (`palette-<stem>.json`, else `palette.json`).
 */
async function loadGallopStrip(art: ArtSet): Promise<GallopStrip | null> {
  const base = art.base.replace(/\/$/, "");
  const url = (src: string) => (src.startsWith("/") || /^https?:/.test(src) ? src : `${base}/${src}`);
  const approved = (re: RegExp) => art.manifest?.assets.find((a) => a.status === "approved" && a.src && re.test(a.src));
  const candidates = [approved(/(^|\/)horse-gallop\.png$/), approved(/(^|\/)horse-gallop-lo\.png$/)]
    .filter((e): e is NonNullable<typeof e> => !!e)
    .sort((a, b) => b.frameWidth - a.frameWidth);
  for (const entry of candidates) {
    try {
      const src = entry.src!;
      const stem = src.split("/").pop()!.replace(/\.png$/, "");
      const dir = src.slice(0, src.length - stem.length - 4);
      const img = await loadImg(url(src));
      if (!img) continue;
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height);
      let keys: KeyPalette | null = null;
      // Only the documented palette files (art-direction contract): race/palette.json for
      // the main strip, race/palette-<suffix>.json for variants (e.g. -lo). No probing.
      const suffix = stem.replace(/^horse-gallop-?/, "");
      const palettes = [...(suffix ? [`${dir}palette-${suffix}.json`] : []), `${dir}palette.json`];
      for (const pal of palettes) {
        const json = await fetch(url(pal))
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        const k = parseKeyPalette(json);
        if (k && keyCoverage(data, k) > 0.25) {
          keys = k;
          break;
        }
      }
      if (!keys) continue;
      const nEntry = approved(new RegExp(`(^|/)${stem}-normal\\.png$`));
      const normal = nEntry?.src && nEntry.frameWidth === entry.frameWidth ? await loadImg(url(nEntry.src)) : null;
      return {
        data,
        frameCount: entry.frameCount,
        frameWidth: entry.frameWidth,
        frameHeight: entry.frameHeight,
        anchor: { x: Math.round(entry.anchor.x * entry.frameWidth), y: Math.round(entry.anchor.y * entry.frameHeight) },
        keys,
        normal,
      };
    } catch {
      /* try the next strip */
    }
  }
  return null;
}

function stripFactory(three: typeof THREE, strip: GallopStrip): HorseRigFactory {
  const cache = new Map<string, HTMLCanvasElement>();
  const recoloured = (a: HorseAppearance) => {
    const k = appearanceKey(a);
    let c = cache.get(k);
    if (!c) {
      const data = new Uint8ClampedArray(strip.data.data);
      applyRecolor(data, strip.data.width, strip.data.height, strip.frameWidth, buildRecolorPlan(strip.keys, a));
      c = document.createElement("canvas");
      c.width = strip.data.width;
      c.height = strip.data.height;
      c.getContext("2d")!.putImageData(new ImageData(data, strip.data.width, strip.data.height), 0, 0);
      cache.set(k, c);
    }
    return c;
  };
  let normalBase: THREE.Texture | null = null;
  if (strip.normal) {
    normalBase = new three.Texture(strip.normal);
    normalBase.magFilter = three.NearestFilter;
    normalBase.minFilter = three.NearestFilter;
    normalBase.generateMipmaps = false;
    normalBase.colorSpace = three.NoColorSpace;
    normalBase.needsUpdate = true;
  }
  const f = frameStripFactory(three, recoloured, strip.frameCount, strip.frameWidth, strip.frameHeight, strip.anchor, normalBase);
  return {
    ...f,
    dispose() {
      f.dispose();
      normalBase?.dispose();
    },
  };
}

function placeholderFactory(three: typeof THREE): HorseRigFactory {
  return frameStripFactory(three, placeholderStripFor, PH_FRAMES, PH_W, PH_H, PH_ANCHOR);
}

/** A HorseRig over a horizontal strip of gallop frames; the frame follows the stride phase. */
function frameStripFactory(
  three: typeof THREE,
  stripFor: (a: HorseAppearance) => HTMLCanvasElement,
  frames: number,
  fw: number,
  fh: number,
  anchor: { x: number; y: number },
  normalBase: THREE.Texture | null = null,
): HorseRigFactory {
  const rigs = new Set<HorseRig>();
  return {
    ready: async () => {},
    create(appearance: HorseAppearance): HorseRig {
      const canvas = stripFor(appearance);
      const tex = new three.CanvasTexture(canvas);
      tex.magFilter = three.NearestFilter;
      tex.minFilter = three.NearestFilter;
      tex.generateMipmaps = false;
      tex.colorSpace = three.SRGBColorSpace;
      tex.repeat.set(1 / frames, 1);
      tex.needsUpdate = true;
      // Shares the GPU image with normalBase; only the frame offset differs per horse.
      const normalMap = normalBase ? normalBase.clone() : undefined;
      normalMap?.repeat.set(1 / frames, 1);
      const rig: LitHorseRig = {
        texture: tex,
        normalMap,
        width: fw,
        height: fh,
        anchor,
        update(_r, state: HorseRigState) {
          const f = Math.floor((state.phase - Math.floor(state.phase)) * frames) % frames;
          tex.offset.x = f / frames;
          if (normalMap) normalMap.offset.x = f / frames;
        },
        dispose() {
          tex.dispose();
          normalMap?.dispose();
          rigs.delete(rig);
        },
      };
      rigs.add(rig);
      return rig;
    },
    dispose() {
      for (const r of [...rigs]) r.dispose();
    },
  };
}
