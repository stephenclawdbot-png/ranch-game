"use client";

import { useEffect, useRef } from "react";
import type { Silks } from "@thoroughbred/shared";
import { JOCKEY_BUST, JOCKEY_FACE, jockeyPortrait } from "@/lib/cast";
import { paintJockeyBust } from "@/lib/jockeyBust";

/**
 * A jockey's own portrait, built from layers (graphics round 2): the base face of the jockey's
 * stored look (art/portraits/jockeys, keyed for skin, lips, hair and silks) painted with that
 * look's skin tone, hair colour and accessories and their stable's silks, pattern and cap
 * included (Club grey for freelancers), so it matches the rider on the horse. "bust" is the
 * 128 px head and shoulders; "face" the 56 px head crop for lists. Integer scale, nearest filtering.
 */
export function JockeyPortrait({
  jockey,
  silks,
  variant = "bust",
  scale = 1,
  className,
}: {
  jockey: { id: string; name: string; stage: string; look?: unknown };
  silks?: (Partial<Silks> & { primary: string; secondary: string; cap: string }) | null;
  variant?: "bust" | "face";
  scale?: 1 | 2;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const art = jockeyPortrait(jockey);
  const kit = silks ? ({ pattern: "solid", ...silks } as Silks) : null;
  const key = JSON.stringify([art.look, kit]);
  const size = variant === "face" ? JOCKEY_FACE : JOCKEY_BUST;
  const [sx, sy] = variant === "face" ? art.face : [0, 0];
  useEffect(() => {
    let live = true;
    const img = new Image();
    img.onload = () => {
      const c = ref.current;
      if (!live || !c) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      // paint the whole bust (the pattern and accessories are laid out on it), then crop
      const full = document.createElement("canvas");
      full.width = JOCKEY_BUST;
      full.height = JOCKEY_BUST;
      const fx = full.getContext("2d", { willReadFrequently: true });
      if (!fx) return;
      fx.drawImage(img, 0, 0);
      const data = fx.getImageData(0, 0, JOCKEY_BUST, JOCKEY_BUST);
      paintJockeyBust(data.data, JOCKEY_BUST, art.look, kit, art.anchors);
      fx.putImageData(data, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(full, sx, sy, size, size, 0, 0, size, size);
    };
    img.src = art.src;
    return () => {
      live = false;
    };
    // the key carries the look and the kit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, art.src, size, sx, sy]);
  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      className={className}
      style={{ width: size * scale, height: size * scale, imageRendering: "pixelated", display: "block" }}
      role="img"
      aria-label={`${jockey.name}, jockey`}
      data-testid="jockey-portrait"
      data-portrait={art.id}
      data-look={`${art.look.skin}|${art.look.hair}|${art.look.acc.join("+")}`}
    />
  );
}
