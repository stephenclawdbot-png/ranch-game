"use client";

import { useEffect, useRef, useState } from "react";
import type { HorseAppearance } from "@thoroughbred/shared";
import { lookShapeKey } from "@thoroughbred/art-pipeline";
import { requestSheet } from "../diorama/sheetPainter";
import { useArt } from "./ArtProvider";

const FRAMES = 12;
const SRC = "race/horse-gallop.png";

/**
 * The PixelLab gallop cycle, recoloured for a horse and played on a tiny canvas
 * (nearest-neighbour upscaled). Painted with the same painter as the ranch, the paddock and the
 * race views (coat palette, silks, rider look, then the coat layers, build and long hair), in the
 * paint worker (diorama/sheetPainter.ts): the quick recolour shows first, the finished strip
 * when it is ready. Renders nothing until the art exists.
 * Pass `still` to freeze on that frame (gallery cells, reduced-motion posters).
 */
export function GallopSprite({ appearance, scale = 2, fps = 14, className, still, fit }: { appearance: HorseAppearance; scale?: number; fps?: number; className?: string; still?: number; fit?: boolean }) {
  const art = useArt([SRC]);
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const fw = art ? Math.round(art.w / FRAMES) : 0;
  const key = `${appearance.coat}|${JSON.stringify(appearance.colour ?? null)}|${appearance.maneColor ?? ""}|${appearance.silks.primary}${appearance.silks.secondary}${appearance.silks.cap}|${appearance.face}|${appearance.legs.join(",")}|${appearance.feather ? 1 : 0}|${appearance.dun ? 1 : 0}${lookShapeKey(appearance)}`;

  useEffect(() => {
    if (!art) return;
    let raf = 0;
    const handle = requestSheet(SRC, art.w, art.h, fw, FRAMES, { coat: appearance.coat, appearance });
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    const draw = (t: number) => {
      const strip = handle.image();
      const ctx = ref.current?.getContext("2d");
      if (strip && ctx) {
        const f = still ?? (reduce ? 3 : Math.floor(((t - start) / 1000) * fps) % FRAMES);
        ctx.clearRect(0, 0, fw, art.h);
        ctx.drawImage(strip, f * fw, 0, fw, art.h, 0, 0, fw, art.h);
      }
      if (still === undefined && !reduce) raf = requestAnimationFrame(draw);
    };
    const show = () => {
      if (!handle.image()) return;
      setReady(true);
      if (still !== undefined || reduce) draw(performance.now());
    };
    const off = handle.listen(show);
    show();
    if (still === undefined && !reduce) raf = requestAnimationFrame(draw);
    return () => {
      off();
      handle.release();
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
