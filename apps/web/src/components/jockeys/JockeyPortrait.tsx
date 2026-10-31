"use client";

import { useEffect, useRef } from "react";
import { applyRecolor, recolorMap } from "../diorama/recolor";

/** Club grey silks for freelancers (body, sleeves, cap). */
const CLUB_SILKS: [string, string, string] = ["#8d9296", "#c9cdd0", "#6b7074"];
/** The rider in the first frame of the walking strip (native px): head to boots. */
const CROP = { x: 96, y: 2, w: 72, h: 64 };
const STRIP = "/art/diorama/horse-walk-jockey.png";

/**
 * A jockey's portrait: the existing walking-rider art, cropped to the rider and recoloured
 * through the strip's silks key ramps (the stable's silks, or Club grey), drawn at an integer
 * scale with nearest filtering.
 */
export function JockeyPortrait({ silks, scale = 2, className }: { silks?: { primary: string; secondary: string; cap: string } | null; scale?: 1 | 2 | 3; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const colours = silks ? ([silks.primary, silks.secondary, silks.cap] as [string, string, string]) : CLUB_SILKS;
  const key = colours.join(",");
  useEffect(() => {
    let live = true;
    const img = new Image();
    img.onload = () => {
      const c = ref.current;
      if (!live || !c) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, CROP.w, CROP.h);
      ctx.drawImage(img, CROP.x, CROP.y, CROP.w, CROP.h, 0, 0, CROP.w, CROP.h);
      const data = ctx.getImageData(0, 0, CROP.w, CROP.h);
      applyRecolor(data.data, recolorMap({ coat: "bay", silks: key.split(",") as [string, string, string] }));
      ctx.putImageData(data, 0, 0);
    };
    img.src = STRIP;
    return () => {
      live = false;
    };
  }, [key]);
  return (
    <canvas
      ref={ref}
      width={CROP.w}
      height={CROP.h}
      className={className}
      style={{ width: CROP.w * scale, height: CROP.h * scale, imageRendering: "pixelated" }}
      role="img"
      aria-label="Jockey portrait"
      data-testid="jockey-portrait"
    />
  );
}
