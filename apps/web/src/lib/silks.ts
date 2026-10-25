import type { SilkPattern, Silks } from "@thoroughbred/shared";

/** Curated racing-colour palette used by onboarding and demo data. */
export const SILK_COLORS: readonly { name: string; hex: string }[] = [
  { name: "Racing Green", hex: "#0f5a3a" },
  { name: "Emerald", hex: "#1f9d5c" },
  { name: "Royal Blue", hex: "#2346a8" },
  { name: "Sky", hex: "#6fb3e6" },
  { name: "Navy", hex: "#16224d" },
  { name: "Scarlet", hex: "#c8242f" },
  { name: "Maroon", hex: "#6e1b2b" },
  { name: "Tangerine", hex: "#e8742a" },
  { name: "Gold", hex: "#e2b33c" },
  { name: "Primrose", hex: "#f2e27a" },
  { name: "Rose", hex: "#e47aa5" },
  { name: "Purple", hex: "#5b2f8f" },
  { name: "Ivory", hex: "#f4efe3" },
  { name: "Silver", hex: "#a9b0b8" },
  { name: "Charcoal", hex: "#2d2f33" },
  { name: "Chocolate", hex: "#5a3826" },
];

export const SILK_PATTERNS: readonly { id: SilkPattern; label: string }[] = [
  { id: "solid", label: "Plain" },
  { id: "hoops", label: "Hoops" },
  { id: "stripes", label: "Stripes" },
  { id: "chevron", label: "Chevron" },
  { id: "diamonds", label: "Diamonds" },
  { id: "sash", label: "Sash" },
  { id: "quartered", label: "Quartered" },
  { id: "stars", label: "Stars" },
];

const HEX = /^#[0-9a-fA-F]{6}$/;
const PATTERN_IDS = new Set<string>(SILK_PATTERNS.map((p) => p.id));

/** Compact, URL-safe silks encoding used inside signed race ids: "hoops.0f5a3a.e2b33c.f4efe3". */
export function encodeSilks(s: Silks): string {
  return [s.pattern, s.primary.slice(1), s.secondary.slice(1), s.cap.slice(1)].join(".").toLowerCase();
}

export function decodeSilks(raw: string): Silks | null {
  const [pattern, a, b, c] = raw.split(".");
  if (!pattern || !a || !b || !c || !PATTERN_IDS.has(pattern)) return null;
  const silks = { pattern: pattern as SilkPattern, primary: `#${a}`, secondary: `#${b}`, cap: `#${c}` };
  if (![silks.primary, silks.secondary, silks.cap].every((h) => HEX.test(h))) return null;
  return silks;
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

/** Contrast ratio between two colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Pre-rolled silks for onboarding: a patterned design whose two colours read apart (>= 2:1). */
export function randomSilks(rand: () => number = Math.random): Silks {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
  const patterns = SILK_PATTERNS.filter((p) => p.id !== "solid");
  for (let i = 0; i < 50; i++) {
    const primary = pick(SILK_COLORS).hex;
    const secondary = pick(SILK_COLORS).hex;
    if (primary !== secondary && contrastRatio(primary, secondary) >= 2.5) {
      return { pattern: pick(patterns).id, primary, secondary, cap: rand() < 0.5 ? secondary : primary };
    }
  }
  return { pattern: "hoops", primary: "#0f5a3a", secondary: "#e2b33c", cap: "#e2b33c" };
}
