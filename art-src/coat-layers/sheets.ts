// Every keyed horse sheet the game draws (race strips, the 3D gallop, ranch and paddock walkers),
// with its frame count. Sheets ending -sN are N:1 copies of the base sheet.
export const BASE_SHEETS: Record<string, number> = {
  "race/horse-gallop": 12,
  "race/horse-idle": 14,
  "race/horse-break": 8,
  "race/horse-drive": 12,
  "race/horse-lunge": 6,
  "race/horse-easeup": 13,
  "race/horse-celebrate": 11,
  "race/horse-pullup": 10,
  "diorama/horse-canter": 12,
  "diorama/horse-walk-jockey": 8,
  "diorama/horse-loose-walk": 8,
  "diorama/horse-loose-graze": 24,
  "diorama/horse-loose-idle": 8,
};
