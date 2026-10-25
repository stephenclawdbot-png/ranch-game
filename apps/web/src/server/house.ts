/**
 * The Club's house stables: the AI owners of house horses that fill Live fields and run in
 * Story races. A house horse (owner_stable_id null in the database) is shown under one of
 * these names and silks, chosen deterministically from its id.
 */
import type { Silks } from "@thoroughbred/shared";

export interface HouseStable {
  id: string;
  name: string;
  /** One-line flavour shown on race cards. */
  trainer: string;
  silks: Silks;
}

export const HOUSE_STABLES: readonly HouseStable[] = [
  { id: "house-harrowgate", name: "Harrowgate House", trainer: "E. Harrow", silks: { pattern: "hoops", primary: "#16224d", secondary: "#e2b33c", cap: "#e2b33c" } },
  { id: "house-bellmont", name: "Bellmont Lodge", trainer: "M. Bellamy", silks: { pattern: "sash", primary: "#f4efe3", secondary: "#c8242f", cap: "#c8242f" } },
  { id: "house-copperfield", name: "Copperfield Stud", trainer: "A. Copperfield", silks: { pattern: "chevron", primary: "#e8742a", secondary: "#2d2f33", cap: "#2d2f33" } },
  { id: "house-saltmarsh", name: "Saltmarsh Racing", trainer: "J. Salt", silks: { pattern: "stripes", primary: "#6fb3e6", secondary: "#f4efe3", cap: "#16224d" } },
  { id: "house-kestrel", name: "Kestrel Downs", trainer: "R. Kestrel", silks: { pattern: "diamonds", primary: "#5b2f8f", secondary: "#f2e27a", cap: "#5b2f8f" } },
  { id: "house-ashcombe", name: "Ashcombe Park", trainer: "H. Ashcombe", silks: { pattern: "quartered", primary: "#6e1b2b", secondary: "#a9b0b8", cap: "#6e1b2b" } },
  { id: "house-vicarage", name: "Old Vicarage Stables", trainer: "T. Penrose", silks: { pattern: "solid", primary: "#1f9d5c", secondary: "#1f9d5c", cap: "#f4efe3" } },
  { id: "house-larkspur", name: "Larkspur Farm", trainer: "C. Lark", silks: { pattern: "stars", primary: "#2346a8", secondary: "#f4efe3", cap: "#e47aa5" } },
];

/** The house stable a house horse runs for (stable FNV-1a hash of its id). */
export function houseStableFor(horseId: string): HouseStable {
  let h = 0x811c9dc5;
  for (let i = 0; i < horseId.length; i++) {
    h ^= horseId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return HOUSE_STABLES[h % HOUSE_STABLES.length]!;
}
