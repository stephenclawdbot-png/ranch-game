import type { Silks as SilksT } from "@thoroughbred/shared";
import { PixelGrid, mix } from "./pixel/PixelGrid";

/**
 * Racing silks as true pixel art: a 16x13 jersey (+ a cap sprite above it).
 * Patterns are evaluated per pixel so every one of the 8 designs reads at 16 px.
 */
const CAP = [
  ".....OOOOO......",
  "....OPPPPPO.....",
  "...OPWWPPPPO....",
  "...OPWPPPPPPOOO.",
  "...OOOOOOOOPPPPO",
  "...........OOOO.",
  "................",
];
const JERSEY = [
  "...OOOO..OOOO...",
  ".OOSSBBOOBBSSOO.",
  "OSSSBBBCCBBBSSSO",
  "OSSSBBBBBBBBSSSO",
  "OSSOBBBBBBBBOSSO",
  "OKKOBBBBBBBBOKKO",
  ".OOOBBBBBBBBOOO.",
  "...OBBBBBBBBO...",
  "...OBBBBBBBBO...",
  "...OBBBBBBBBO...",
  "...OBBBBBBBBO...",
  "...OBBBBBBBBO...",
  "...OOOOOOOOOO...",
];
const STAR_CENTRES: [number, number][] = [
  [6, 4], [10, 5], [5, 9], [9, 9], [2, 3], [13, 3],
];

function patternAt(pattern: SilksT["pattern"], x: number, y: number): boolean {
  switch (pattern) {
    case "hoops":
      return y >= 2 && (y - 2) % 4 >= 2;
    case "stripes":
      return x % 3 === 2;
    case "chevron":
      return Math.floor(y + Math.abs(x - 7.5)) % 5 < 2;
    case "diamonds":
      return (Math.floor((x + y) / 3) + Math.floor((x - y + 30) / 3)) % 2 === 0;
    case "sash":
      return Math.abs(x - (3 + y * 0.72)) < 1.4;
    case "quartered":
      return x >= 8 !== y >= 7;
    case "stars":
      return STAR_CENTRES.some(([cx, cy]) => Math.abs(x - cx) + Math.abs(y - cy) <= 1);
    default:
      return false;
  }
}

export function Silks({ silks, className, cap = true, title }: { silks: SilksT; className?: string; cap?: boolean; title?: string }) {
  const rows = cap ? [...CAP, ...JERSEY] : JERSEY;
  const off = cap ? CAP.length : 0;
  const ink = "#0b0f0c";
  const outline = mix(silks.primary, ink, 0.78);
  const capOutline = mix(silks.cap, ink, 0.78);
  return (
    <PixelGrid
      rows={rows}
      palette={{}}
      className={className}
      title={title}
      pixel={(x, y, ch) => {
        if (ch === ".") return undefined;
        if (y < off) {
          if (ch === "O") return capOutline;
          if (ch === "W") return mix(silks.cap, "#ffffff", 0.45);
          return x >= 9 && y >= 3 ? mix(silks.cap, ink, 0.18) : silks.cap;
        }
        const jy = y - off;
        if (ch === "O") return outline;
        if (ch === "C" || ch === "K") return silks.secondary;
        const base = patternAt(silks.pattern, x, jy) ? silks.secondary : silks.primary;
        // Light from the top-left: highlight the first lit column, shade the right flank and hem.
        if ((x === 4 && jy >= 2) || (jy === 1 && x < 7) || (x === 1 && jy === 2)) return mix(base, "#ffffff", 0.22);
        if (x >= 10 || jy >= 10 || x >= 13) return mix(base, ink, 0.22);
        return base;
      }}
    />
  );
}

/** Jersey in a small square pixel tile (lists, tables, nav). */
export function SilksIcon({ silks, className }: { silks: SilksT; className?: string }) {
  return (
    <span className={`px-tile inline-flex shrink-0 items-center justify-center ${className ?? ""}`}>
      <Silks silks={silks} cap={false} className="h-[74%] w-[74%]" />
    </span>
  );
}
