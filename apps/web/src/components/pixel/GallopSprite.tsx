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
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const to = map.get((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
    if (to) {
      const [r, g, b] = rgbOf(to);
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
    }
  }
  ctx.putImageData(data, 0, 0);
  return cv;
}

/**
 * The PixelLab gallop cycle, recoloured for a horse and played on a tiny canvas
 * (nearest-neighbour upscaled). Renders nothing until the art exists.
 */
export function GallopSprite({ appearance, scale = 2, fps = 14, className }: { appearance: HorseAppearance; scale?: number; fps?: number; className?: string }) {
  const art = useArt(["race/horse-gallop.png"]);
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const fw = art ? Math.round(art.w / FRAMES) : 0;
  const key = `${appearance.coat}${appearance.silks.primary}${appearance.silks.secondary}${appearance.silks.cap}`;

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
        const f = reduce ? 3 : Math.floor(((t - start) / 1000) * fps) % FRAMES;
        ctx.clearRect(0, 0, fw, art.h);
        ctx.drawImage(strip, f * fw, 0, fw, art.h, 0, 0, fw, art.h);
        if (!reduce) raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
      setReady(true);
    }).catch(() => {});
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [art?.path, key, fps, fw]);

  if (!art) return null;
  return (
    <canvas
      ref={ref}
      width={fw}
      height={art.h}
      aria-hidden
      className={`pixelated ${ready ? "" : "opacity-0"} ${className ?? ""}`}
      style={{ width: fw * scale, height: art.h * scale }}
    />
  );
}

