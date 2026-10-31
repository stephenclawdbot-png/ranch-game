"use client";

import { useEffect, useRef, useState } from "react";
import type { HorseAppearance } from "@thoroughbred/shared";
import { artUrl } from "@/lib/art";
import { COAT_ATLAS_SRC, coatAtlasOf, paintHorseSheet } from "../diorama/recolor";
import { useArt } from "./ArtProvider";

const FRAMES = 12;

/** The coat-layer atlas (patterns, markings, long hair), loaded once for every gallop sprite. */
let atlasPromise: Promise<HTMLImageElement | null> | null = null;
function loadAtlas(): Promise<HTMLImageElement | null> {
  atlasPromise ??= new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = `/art/${COAT_ATLAS_SRC}`;
  });
  return atlasPromise;
}

/**
 * Recolours the PixelLab gallop strip for one horse with the same painter as the ranch, the
 * paddock and the race views (coat palette, silks, rider look, then the coat layers: patterns,
 * markings, shades and feathered long hair from the one pattern definition).
 */
function recolour(img: HTMLImageElement, atlasImg: HTMLImageElement | null, appearance: HorseAppearance): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, cv.width, cv.height);
  paintHorseSheet(data.data, cv.width, cv.height, Math.round(cv.width / FRAMES), { coat: appearance.coat, appearance }, coatAtlasOf(atlasImg), "race/horse-gallop");
  ctx.putImageData(data, 0, 0);
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
  const key = `${appearance.coat}|${JSON.stringify(appearance.colour ?? null)}|${appearance.maneColor ?? ""}|${appearance.silks.primary}${appearance.silks.secondary}${appearance.silks.cap}|${appearance.face}|${appearance.legs.join(",")}|${appearance.feather ? 1 : 0}|${appearance.dun ? 1 : 0}`;

  useEffect(() => {
    if (!art) return;
    let raf = 0;
    let alive = true;
    const img = new Image();
    img.src = artUrl(art);
    Promise.all([loadAtlas(), img.decode().then(() => img)]).then(([atlasImg]) => {
      if (!alive || !ref.current) return;
      const strip = recolour(img, atlasImg, appearance);
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

