"use client";

import type { HorseAppearance } from "@thoroughbred/shared";
import { ART_SLOTS, MARKING_WHITE, artUrl, resolveHorseColors } from "@/lib/art";
import { useArt } from "./pixel/ArtProvider";
import { PixelGrid, mix } from "./pixel/PixelGrid";
import { FACE_MARKS, HEAD_ROWS, HEAD_SIZE } from "./pixel/horseHeadData";

/** Deterministic hash noise for roan/dapple texture (SSR and client agree). */
function noise(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Code-drawn pixel portrait (48x48), used until the PixelLab portrait for this coat exists. */
function PixelHead({ appearance, className, title }: { appearance: HorseAppearance; className?: string; title?: string }) {
  const c = resolveHorseColors(appearance);
  const ink = "#0b0f0c";
  const marks = appearance.face !== "none" ? FACE_MARKS[appearance.face] : null;
  const ramp: Record<string, string> = {
    h: c.highlight,
    b: c.body,
    d: c.shade,
    x: mix(c.shade, ink, 0.35),
    u: mix(c.muzzle, c.highlight, 0.25),
    U: c.muzzle,
    m: c.mane,
    M: mix(c.mane, "#ffffff", 0.18),
    n: mix(c.mane, ink, 0.55),
    o: mix(c.shade, ink, 0.55),
    e: "#120b07",
    i: "#f3e7c9",
    k: mix(c.muzzle, ink, 0.6),
    l: "#3a2414",
    s: appearance.silks.primary,
    g: "#d9a441",
  };
  const white = MARKING_WHITE;
  return (
    <PixelGrid
      rows={HEAD_ROWS}
      palette={ramp}
      className={className}
      title={title}
      testId="horse-portrait"
      pixel={(x, y, ch) => {
        if (ch === ".") return undefined;
        if (marks && marks[y]![x] === "1") return ch === "d" || ch === "x" ? mix(white, c.shade, 0.25) : white;
        if (c.texture === "roan" && "hbd".includes(ch) && noise(x, y) > 0.72) return mix(ramp[ch]!, "#ffffff", 0.45);
        if (c.texture === "dapple" && "bd".includes(ch)) {
          // Rings of lighter coat: classic dapple, quantised to the pixel grid.
          const cx = (x % 6) - 2.5;
          const cy = (y % 6) - 2.5;
          if (cx * cx + cy * cy < 3.2 && noise(Math.floor(x / 6), Math.floor(y / 6)) > 0.25) return mix(ramp[ch]!, c.highlight, 0.55);
        }
        return ramp[ch];
      }}
    />
  );
}

/**
 * Horse head-and-neck portrait (facing left). Uses the PixelLab portrait for the coat
 * when it exists (nearest-neighbour, pixelated), otherwise a code-drawn pixel head.
 * The image is sized by its container (`className`), keeping its aspect ratio.
 */
export function HorsePortrait({
  appearance,
  className,
  title,
}: {
  appearance: HorseAppearance;
  className?: string;
  /** @deprecated kept for call-site compatibility; portraits never draw a vector backdrop now. */
  backdrop?: boolean;
  title?: string;
}) {
  const art = useArt(ART_SLOTS.portrait(appearance.coat));
  if (art) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={artUrl(art)}
        width={art.w}
        height={art.h}
        alt={title ?? ""}
        aria-hidden={title ? undefined : true}
        className={`pixelated object-contain object-bottom ${className ?? ""}`}
        data-testid="horse-portrait"
        draggable={false}
      />
    );
  }
  return <PixelHead appearance={appearance} className={className} title={title} />;
}

export { HEAD_SIZE };
