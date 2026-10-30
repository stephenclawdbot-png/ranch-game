"use client";

import type { HorseAppearance } from "@thoroughbred/shared";
import { portraitRecolours } from "@thoroughbred/art-pipeline";
import { ART_SLOTS, MARKING_WHITE, artUrl, resolveHorseColors } from "@/lib/art";
import { useArt } from "./pixel/ArtProvider";
import { useGeneticPortrait } from "./pixel/geneticPortrait";
import { PixelGrid, mix } from "./pixel/PixelGrid";
import ANIM_INDEX from "../../public/art/portraits/anim/index.json";
import { FACE_MARKS, HEAD_ROWS, HEAD_SIZE } from "./pixel/horseHeadData";

/** Deterministic hash noise for roan/dapple texture (SSR and client agree). */
function noise(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Code-drawn pixel portrait (48x48), used until the PixelLab portrait for this coat exists. */
function PixelHead({ appearance, className, title, style }: { appearance: HorseAppearance; className?: string; title?: string; style?: React.CSSProperties }) {
  const c = resolveHorseColors(appearance);
  const ink = "#0b0f0c";
  const marks = appearance.face !== "none" ? FACE_MARKS[appearance.face] : null;
  // Grullo / smoky grullo: duns on black carry a dark face mask (points shade, not grey).
  const darkHead = !!appearance.colour?.dun && appearance.colour.base === "black" && appearance.colour.grey === "none";
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
    e: c.eye ?? "#120b07",
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
      style={style}
      title={title}
      testId="horse-portrait"
      pixel={(x, y, ch) => {
        if (ch === ".") return undefined;
        if (marks && marks[y]![x] === "1") return ch === "d" || ch === "x" ? mix(white, c.shade, 0.25) : white;
        // Roan: ~35 % of body/neck pixels ticked toward white, stable per pixel, never on
        // the blaze/white face markings (handled above).
        if (c.texture === "roan" && "hbd".includes(ch) && noise(x, y) > 0.65) return mix(ramp[ch]!, "#ffffff", 0.45);
        if (c.texture === "dapple" && "bd".includes(ch)) {
          // Rings of lighter coat: classic dapple, quantised to the pixel grid.
          const cx = (x % 6) - 2.5;
          const cy = (y % 6) - 2.5;
          if (cx * cx + cy * cy < 3.2 && noise(Math.floor(x / 6), Math.floor(y / 6)) > 0.25) return mix(ramp[ch]!, c.highlight, 0.55);
        }
        if (darkHead && "hbd".includes(ch)) {
          const k = ch === "h" ? 0.3 : ch === "b" ? 0.6 : 0.45;
          return mix(ramp[ch]!, c.points, k);
        }
        return ramp[ch];
      }}
    />
  );
}

/** Portrait scales: a thumbnail is half the native art (exact 1:1 device pixels on 2x screens). */
export type PortraitScale = "thumb" | 1 | 2 | 3;

/** Native portrait size in art pixels (PixelLab portraits; the code fallback is drawn to fit). */
export function usePortraitNative(coat: HorseAppearance["coat"]): number {
  const art = useArt(ART_SLOTS.portrait(coat));
  return art?.w ?? 96;
}

/** Frame counts of the animated 3/4 portraits (art-src/portrait_anims.py). */
const ANIM = ANIM_INDEX as Record<string, { frames: number; kept?: number; size: number }>;
/** Seconds per frame of the idle loop (blink, ear flick, breath). */
const FRAME_S = 0.16;

function phaseOf(a: HorseAppearance): number {
  const k = `${a.coat}|${a.silks.primary}|${a.face}|${a.legs.join("")}`;
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0;
  return Math.abs(h % 997) / 997;
}

/**
 * Horse head-and-neck portrait (facing left): the 3/4 pixel portrait for the coat, animated like
 * a gif (an idle loop: blink, ear flick, breath) where the coat has a loop, else the still 3/4
 * portrait. Never the flat code-drawn head (that stays for dev galleries via `codeDrawn`).
 * Horses with layered coat genetics are recoloured from their genes (coat, dilutions,
 * patterns, face marking) after hydration (`useGeneticPortrait`); until then, and if that
 * fails, the painted file for the nearest coat shows in the same box.
 * Pass `scale` to lock it to an integer multiple of the native art (one pixel density per
 * screen); otherwise it is sized by its container (`className`). Reduced motion holds frame 0.
 */
export function HorsePortrait({
  appearance,
  className,
  title,
  scale,
  codeDrawn,
}: {
  appearance: HorseAppearance;
  className?: string;
  /** @deprecated kept for call-site compatibility; portraits never draw a vector backdrop now. */
  backdrop?: boolean;
  title?: string;
  scale?: PortraitScale;
  /** Always use the code-drawn pixel head (dev galleries), ignoring PixelLab portrait art. */
  codeDrawn?: boolean;
}) {
  const full = useArt(ART_SLOTS.portrait(appearance.coat));
  const thumb = useArt(ART_SLOTS.thumb(appearance.coat));
  const coat = appearance.coat;
  const anim = ANIM[coat];
  const animated = !!anim && anim.frames > 1;
  // native 128 px art only: the role map is drawn for it
  const genetic = useGeneticPortrait(appearance, scale === "thumb", animated ? anim : null, !codeDrawn && (full?.w ?? 128) === 128 && portraitRecolours(appearance));
  if (codeDrawn) return <PixelHead appearance={appearance} className={`shrink-0 ${className ?? ""}`} title={title} />;
  const native = full?.w ?? 128;
  const px = scale === undefined ? undefined : scale === "thumb" ? native / 2 : native * scale;
  const box = px ? { width: px, height: px } : undefined;
  // the still 3/4 portrait: the genetic recolour, else from the art manifest, or straight from the served file
  const painted = scale === "thumb" ? (thumb ? artUrl(thumb) : `/art/portraits/thumb/horse-${coat}.png`) : full ? artUrl(full) : `/art/portraits/horse-${coat}.png`;
  const still = genetic?.still ?? painted;
  if (animated) {
    const strip = genetic?.strip ?? (scale === "thumb" ? `/art/portraits/anim/thumb/horse-${coat}.png` : `/art/portraits/anim/horse-${coat}.png`);
    const dur = anim.frames * FRAME_S;
    return (
      <span
        className={`portrait-anim shrink-0 ${className ?? ""}`}
        style={box}
        role={title ? "img" : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : true}
        data-testid="horse-portrait"
        data-still={still}
        data-genetic={genetic ? "" : undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={strip}
          alt=""
          draggable={false}
          className={scale === "thumb" ? "" : "pixelated"}
          style={{ width: `${anim.frames * 100}%`, animationDuration: `${dur}s`, animationTimingFunction: `steps(${anim.frames})`, animationDelay: `${-phaseOf(appearance) * dur}s` }}
        />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={still}
      width={px ?? native}
      height={px ?? native}
      style={box}
      alt={title ?? ""}
      aria-hidden={title ? undefined : true}
      className={`pixelated shrink-0 object-contain object-bottom ${className ?? ""}`}
      data-testid="horse-portrait"
      data-still={still}
      data-genetic={genetic ? "" : undefined}
      draggable={false}
    />
  );
}

export { HEAD_SIZE };
