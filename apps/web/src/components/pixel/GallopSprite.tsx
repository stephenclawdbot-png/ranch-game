"use client";

import { useEffect, useRef, useState } from "react";
import type { HorseAppearance } from "@thoroughbred/shared";
import { artUrl, resolveHorseColors } from "@/lib/art";
import { useArt } from "./ArtProvider";
import { mix } from "./PixelGrid";

interface RacePalette {
  coat: string[];
  mane: string[];
  points?: string[];
  silksPrimary: string[];
  silksSecondary: string[];
  cap: string[];
}

const FRAMES = 12;
let palettePromise: Promise<RacePalette | null> | null = null;
function loadPalette(): Promise<RacePalette | null> {
  palettePromise ??= fetch("/art/race/palette.json")
    .then((r) => (r.ok ? (r.json() as Promise<RacePalette>) : null))
    .catch(() => null);
  return palettePromise;
}

function rgbOf(c: string): [number, number, number] {
  const p = parseInt(c.slice(1), 16);
  return [(p >> 16) & 255, (p >> 8) & 255, p & 255];
}
/** Ramp of n colours dark -> light through the given stops. */
function ramp(stops: string[], n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 1 : (i / (n - 1)) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(t));
    return mix(stops[k]!, stops[k + 1]!, t - k);
  });
}

/** Deterministic hash noise for coat textures (matches the Trackside roan density). */
function noise(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Recolours the PixelLab gallop strip (key colours from race/palette.json) for one horse. */
function recolour(img: HTMLImageElement, pal: RacePalette, appearance: HorseAppearance): HTMLCanvasElement {
  const c = resolveHorseColors(appearance);
  const ink = "#0b0f0c";
  const map = new Map<number, string>();
  const put = (src: string[], dst: string[]) => src.forEach((s, i) => map.set(parseInt(s.slice(1), 16), dst[i]!));
  put(pal.coat, ramp([mix(c.shade, ink, 0.45), c.shade, c.body, c.highlight], pal.coat.length));
  put(pal.mane, ramp([mix(c.mane, ink, 0.6), c.mane], pal.mane.length));
  const silk = (base: string, n: number) => ramp([mix(base, ink, 0.5), mix(base, ink, 0.25), base, mix(base, "#ffffff", 0.18)], n);
  put(pal.silksPrimary, silk(appearance.silks.primary, pal.silksPrimary.length));
  put(pal.silksSecondary, silk(appearance.silks.secondary, pal.silksSecondary.length));
  put(pal.cap, silk(appearance.silks.cap, pal.cap.length));

  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const ctx = cv.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, cv.width, cv.height);
  const d = data.data;
  const coatKeys = new Set(pal.coat.map((s) => parseInt(s.slice(1), 16)));
  const isCoat: boolean[] = new Array(d.length / 4).fill(false);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const src = (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!;
    const to = map.get(src);
    if (to) {
      const [r, g, b] = rgbOf(to);
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      isCoat[i / 4] = coatKeys.has(src);
    }
  }
  // Coat texture over the horse's own body colour (coat-key pixels only: never mane,
  // points or silks), stable per source pixel.
  if (c.texture !== "none") {
    for (let i = 0; i < d.length; i += 4) {
      if (!isCoat[i / 4]) continue;
      const x = (i / 4) % cv.width;
      const y = Math.floor(i / 4 / cv.width);
      let t = -1;
      if (c.texture === "roan" && noise(x, y) > 0.65) t = 0.45;
      if (c.texture === "dapple") {
        const cx = (x % 6) - 2.5;
        const cy = (y % 6) - 2.5;
        if (cx * cx + cy * cy < 3.2 && noise(Math.floor(x / 6), Math.floor(y / 6)) > 0.25) t = 0.42;
      }
      if (t < 0) continue;
      d[i] = Math.round(d[i]! + (255 - d[i]!) * t);
      d[i + 1] = Math.round(d[i + 1]! + (255 - d[i + 1]!) * t);
      d[i + 2] = Math.round(d[i + 2]! + (255 - d[i + 2]!) * t);
    }
  }
  ctx.putImageData(data, 0, 0);
  // Dun: a thin dorsal stripe along the back in the palette stripe colour (the barrel
  // columns of each frame; the head/neck sit right of 55 %, the tail is mane-keyed).
  // Painted 1..3 px below the back line (the ink outline occupies the top pixel), and
  // only on columns hugging the spine height so the shoulder/chest don't catch it.
  if (appearance.dun && c.stripe) {
    const [sr, sg, sb] = rgbOf(c.stripe);
    const fw = Math.round(cv.width / 12);
    for (let f = 0; f < 12; f++) {
      const tops: [number, number][] = [];
      for (let x = Math.round(f * fw + fw * 0.08); x < f * fw + fw * 0.55; x++) {
        for (let y = 0; y < cv.height; y++) {
          const i = (y * cv.width + x) * 4;
          if (d[i + 3]! >= 8 && isCoat[y * cv.width + x]) {
            tops.push([x, y]);
            break;
          }
        }
      }
      if (!tops.length) continue;
      const ys = tops.map(([, y]) => y).sort((a, b) => a - b);
      const spine = ys[Math.floor(ys.length / 2)]!;
      for (const [x, top] of tops) {
        if (Math.abs(top - spine) > 3) continue;
        for (let y = top + 1; y <= top + 3; y++) {
          const i = (y * cv.width + x) * 4;
          if (d[i + 3]! < 8 || !isCoat[y * cv.width + x]) continue;
          const k = y === top + 1 ? 1 : y === top + 2 ? 0.85 : 0.5;
          d[i] = Math.round(d[i]! + (sr - d[i]!) * k);
          d[i + 1] = Math.round(d[i + 1]! + (sg - d[i + 1]!) * k);
          d[i + 2] = Math.round(d[i + 2]! + (sb - d[i + 2]!) * k);
        }
      }
    }
    ctx.putImageData(data, 0, 0);
  }
  return cv;
}

/**
 * The PixelLab gallop cycle, recoloured for a horse and played on a tiny canvas
 * (nearest-neighbour upscaled). Renders nothing until the art exists.
 * Pass `still` to freeze on that frame (gallery cells, reduced-motion posters).
 */
export function GallopSprite({ appearance, scale = 2, fps = 14, className, still, fit }: { appearance: HorseAppearance; scale?: number; fps?: number; className?: string; still?: number; fit?: boolean }) {
  const art = useArt(["race/horse-gallop.png"]);
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const fw = art ? Math.round(art.w / FRAMES) : 0;
  const key = `${appearance.coat}|${JSON.stringify(appearance.colour ?? null)}|${appearance.maneColor ?? ""}|${appearance.silks.primary}${appearance.silks.secondary}${appearance.silks.cap}`;

  useEffect(() => {
    if (!art) return;
    let raf = 0;
    let alive = true;
    const img = new Image();
    img.src = artUrl(art);
    Promise.all([loadPalette(), img.decode().then(() => img)]).then(([pal]) => {
      if (!alive || !pal || !ref.current) return;
      const strip = recolour(img, pal, appearance);
      const ctx = ref.current.getContext("2d")!;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const start = performance.now();
      const draw = (t: number) => {
        const f = still ?? (reduce ? 3 : Math.floor(((t - start) / 1000) * fps) % FRAMES);
        ctx.clearRect(0, 0, fw, art.h);
        ctx.drawImage(strip, f * fw, 0, fw, art.h, 0, 0, fw, art.h);
        if (still === undefined && !reduce) raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
      setReady(true);
    }).catch(() => {});
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [art?.path, key, fps, fw, still]);

  if (!art) return null;
  return (
    <canvas
      ref={ref}
      width={fw}
      height={art.h}
      aria-hidden
      className={`pixelated ${ready ? "" : "opacity-0"} ${className ?? ""}`}
      style={fit ? { width: "100%", height: "auto" } : { width: fw * scale, height: art.h * scale }}
    />
  );
}

