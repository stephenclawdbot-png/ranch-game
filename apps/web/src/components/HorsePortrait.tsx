import { useId } from "react";
import type { HorseAppearance } from "@thoroughbred/shared";
import { MARKING_WHITE, resolveHorseColors } from "@/lib/art";

/** Head-and-neck profile, facing left, in a 200x200 box. */
const HEAD =
  "M128 40 C158 54 186 100 196 170 L200 206 L126 206 C128 172 126 140 121 119 " +
  "C115 132 99 137 87 133 C76 133 66 142 57 146 C49 150 40 147 36 141 C30 134 28 124 32 116 " +
  "C48 96 84 62 103 45 L105 14 L116 33 L125 11 Z";

const MARK = MARKING_WHITE;

/** Fixed pseudo-random speckles for roan coats (deterministic, so SSR and client agree). */
const ROAN_SPECKS: [number, number][] = (() => {
  let seed = 7;
  const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 70 }, () => [Math.round(60 + next() * 140), Math.round(60 + next() * 146)] as [number, number]);
})();
const FACE_LINE = "M113 30 L103 45 C84 62 48 96 32 116 C28 124 30 134 36 141";

function FaceMarking({ face }: { face: HorseAppearance["face"] }) {
  switch (face) {
    case "star":
      return <path d="M86 66 L90.5 72 L86 78 L81.5 72 Z" fill={MARK} />;
    case "stripe":
      return <path d="M95 64 C82 76 62 95 45 112" stroke={MARK} strokeWidth="5" strokeLinecap="round" fill="none" />;
    case "snip":
      return <ellipse cx="34" cy="127" rx="6" ry="8" fill={MARK} />;
    case "blaze":
      return <path d={FACE_LINE} stroke={MARK} strokeWidth="24" strokeLinecap="round" fill="none" />;
    case "bald":
      return (
        <>
          <path d={FACE_LINE} stroke={MARK} strokeWidth="46" strokeLinecap="round" fill="none" />
          <ellipse cx="40" cy="134" rx="16" ry="13" fill={MARK} />
        </>
      );
    default:
      return null;
  }
}

export function HorsePortrait({
  appearance,
  className,
  backdrop = true,
  title,
}: {
  appearance: HorseAppearance;
  className?: string;
  backdrop?: boolean;
  title?: string;
}) {
  const c = resolveHorseColors(appearance);
  const raw = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = (s: string) => `${s}${raw}`;
  const dapple = c.texture === "dapple";
  const roan = c.texture === "roan";

  return (
    <svg viewBox="0 0 200 200" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <defs>
        <clipPath id={id("h")}>
          <path d={HEAD} />
        </clipPath>
        <linearGradient id={id("coat")} x1="0.15" y1="0.05" x2="0.85" y2="0.95">
          <stop offset="0" stopColor={c.highlight} />
          <stop offset="0.38" stopColor={c.body} />
          <stop offset="1" stopColor={c.shade} />
        </linearGradient>
        <radialGradient id={id("bg")} cx="0.55" cy="0.45" r="0.6">
          <stop offset="0" stopColor={appearance.silks.primary} stopOpacity="0.38" />
          <stop offset="1" stopColor={appearance.silks.primary} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id("jowl")} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={c.highlight} stopOpacity="0.55" />
          <stop offset="1" stopColor={c.highlight} stopOpacity="0" />
        </radialGradient>
      </defs>

      {backdrop && <circle cx="112" cy="100" r="96" fill={`url(#${id("bg")})`} />}

      <path d={HEAD} fill={`url(#${id("coat")})`} />
      <g clipPath={`url(#${id("h")})`}>
        {/* Front-of-neck shadow and the line where the jowl meets the neck */}
        <path d="M121 119 C127 140 128 172 126 206 L156 206 C150 170 140 136 124 112 Z" fill={c.shade} opacity="0.6" />
        <path d="M88 133 C104 134 118 126 122 112 C124 100 118 88 108 84" stroke={c.shade} strokeWidth="3" fill="none" opacity="0.55" />
        {/* Jowl highlight */}
        <ellipse cx="102" cy="106" rx="20" ry="18" fill={`url(#${id("jowl")})`} />
        {/* Muzzle softness */}
        <ellipse cx="44" cy="130" rx="18" ry="14" fill={c.muzzle} opacity="0.55" />
        {dapple &&
          [
            [146, 120], [162, 142], [150, 170], [172, 182], [134, 160], [178, 152], [142, 192], [116, 92], [160, 100], [96, 116],
          ].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="7" fill={c.highlight} opacity="0.35" />)}
        {roan &&
          ROAN_SPECKS.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.5" fill="#ffffff" opacity="0.28" />)}
        <FaceMarking face={appearance.face} />
        {/* Nostril and mouth */}
        <path d="M35 119 C40 115 45 119 43 125 C40 127 36 124 35 119 Z" fill="#000" opacity="0.55" />
        <path d="M36 141 Q45 139 54 141" stroke="#000" strokeOpacity="0.45" strokeWidth="1.6" fill="none" />
        {/* Bridle: leather cheekpiece + noseband, silks-coloured browband */}
        <path d="M125 44 C112 72 84 108 55 139" stroke="#24160d" strokeWidth="3.4" fill="none" />
        <path d="M54 92 C60 108 64 124 69 142" stroke="#24160d" strokeWidth="4.5" fill="none" />
        <path d="M54 92 C60 108 64 124 69 142" stroke={appearance.silks.secondary} strokeOpacity="0.55" strokeWidth="1" fill="none" />
        <path d="M102 45 L125 49" stroke={appearance.silks.primary} strokeWidth="4.5" strokeLinecap="round" />
        <path d="M102 45 L125 49" stroke="#fff" strokeOpacity="0.3" strokeWidth="1" strokeLinecap="round" />
      </g>
      <circle cx="55" cy="139" r="4" fill="none" stroke="#d9b45a" strokeWidth="2" />

      {/* Mane along the crest + forelock */}
      <path
        d="M125 35 C154 48 184 94 194 156 L200 206 L187 206 C184 176 178 152 168 128 C173 130 171 122 163 114 C165 107 159 101 153 94 C155 88 149 82 143 76 C143 68 139 60 133 54 Z"
        fill={c.mane}
      />
      <path d="M138 52 C156 74 172 106 180 142 M146 58 C162 86 176 122 184 162" stroke="#000" strokeOpacity="0.18" strokeWidth="1.2" fill="none" />
      <path d="M114 30 C108 40 100 50 91 57 C101 55 107 52 112 49 C109 55 105 61 101 65 C112 61 120 51 121 40 Z" fill={c.mane} />

      {/* Ears: inner shading */}
      <path d="M106 19 L113 34 L108 38 Z" fill="#000" opacity="0.3" />
      <path d="M124 16 L128 38 L122 36 Z" fill="#000" opacity="0.3" />

      {/* Eye */}
      <path d="M93 67 C97 62.5 105 62.5 109 66.5 C105 71.5 97 71.5 93 67 Z" fill="#120b07" />
      <circle cx="103" cy="66" r="1.5" fill="#fff" opacity="0.85" />
      <path d="M91 62.5 C97 57 107 57 112 62" stroke="#000" strokeOpacity="0.35" strokeWidth="1.5" fill="none" />

      {/* Outline */}
      <path d={HEAD} fill="none" stroke="#000" strokeOpacity="0.35" strokeWidth="1.2" />
    </svg>
  );
}
