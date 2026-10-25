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
