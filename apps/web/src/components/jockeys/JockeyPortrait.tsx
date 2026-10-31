"use client";

import { useEffect, useRef } from "react";
import { JOCKEY_BUST, JOCKEY_FACE, jockeyPortrait } from "@/lib/cast";
import { applyRecolor, recolorMap } from "../diorama/recolor";
import PALETTE from "../../../public/art/race/palette.json";

/** Club grey silks for freelancers (body, sleeves, cap). */
const CLUB_SILKS: [string, string, string] = ["#8d9296", "#c9cdd0", "#6b7074"];

const hexKey = (h: string) => Number.parseInt(h.replace("#", ""), 16);
/** Only the silks keys: nothing else in a face is ever recoloured. */
const SILK_KEYS = new Set(
  (["silksPrimary", "silksSecondary", "cap"] as const).flatMap((role) => (PALETTE as unknown as Record<string, string[]>)[role]!.map(hexKey)),
);

/**
 * A jockey's own portrait: one of the cast of PixelLab busts (art/portraits/jockeys), picked by
 * the jockey's id, stage and name (lib/cast), with the keyed silks painted in their stable's
 * colours (Club grey for freelancers). "bust" is the 128 px head and shoulders; "face" the 56 px
 * head crop for lists. Drawn at an integer scale with nearest filtering.
 */
export function JockeyPortrait({
  jockey,
  silks,
  variant = "bust",
  scale = 1,
  className,
}: {
  jockey: { id: string; name: string; stage: string };
  silks?: { primary: string; secondary: string; cap: string } | null;
  variant?: "bust" | "face";
  scale?: 1 | 2;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const art = jockeyPortrait(jockey);
  const colours = silks ? ([silks.primary, silks.secondary, silks.cap] as [string, string, string]) : CLUB_SILKS;
  const key = colours.join(",");
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
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, sx, sy, size, size, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size);
      const map = recolorMap({ coat: "bay", silks: key.split(",") as [string, string, string] });
      for (const k of [...map.keys()]) if (!SILK_KEYS.has(k)) map.delete(k);
      applyRecolor(data.data, map);
      ctx.putImageData(data, 0, 0);
    };
    img.src = art.src;
    return () => {
      live = false;
    };
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
    />
  );
}
