/**
 * Every keyed horse sheet the game draws, the views that draw it and how (coat audit). Each one is
 * painted with the shared coat geometry and coat layers, so every coat, pattern, marking and the
 * feathered long hair reach every animation and view. The coverage test walks this list.
 */
export type CoatView = "trackside" | "3d" | "photo-finish" | "ranch" | "paddock" | "stable-band" | "gallop-sprite" | "share-card";

export interface HorseSheet {
  /** apps/web/public/art path without .png. */
  stem: string;
  frames: number;
  /** The animation it is (race-day strips) or the scene use. */
  animation: string;
  views: CoatView[];
  /** N:1 copies the dioramas draw at smaller scales (painted from the same geometry rules). */
  lods?: number[];
}

export const HORSE_SHEETS: HorseSheet[] = [
  { stem: "race/horse-gallop", frames: 12, animation: "gallop", views: ["trackside", "3d", "gallop-sprite", "share-card"] },
  { stem: "race/horse-idle", frames: 14, animation: "walk to post / stand", views: ["trackside"] },
  { stem: "race/horse-break", frames: 8, animation: "break", views: ["trackside"] },
  { stem: "race/horse-drive", frames: 12, animation: "drive", views: ["trackside"] },
  { stem: "race/horse-lunge", frames: 6, animation: "lunge", views: ["trackside", "photo-finish"] },
  { stem: "race/horse-easeup", frames: 13, animation: "ease-up", views: ["trackside"] },
  { stem: "race/horse-celebrate", frames: 11, animation: "celebrate", views: ["trackside"] },
  { stem: "race/horse-pullup", frames: 10, animation: "pull-up", views: ["trackside"] },
  { stem: "diorama/horse-canter", frames: 12, animation: "canter to post", views: ["stable-band"], lods: [2, 3] },
  { stem: "diorama/horse-walk-jockey", frames: 8, animation: "walk (ridden)", views: ["paddock", "stable-band"], lods: [2, 3, 4] },
  { stem: "diorama/horse-loose-walk", frames: 8, animation: "ranch walk", views: ["ranch"], lods: [2, 3] },
  { stem: "diorama/horse-loose-graze", frames: 24, animation: "ranch graze", views: ["ranch"], lods: [2, 3] },
  { stem: "diorama/horse-loose-idle", frames: 8, animation: "ranch idle", views: ["ranch"], lods: [2, 3] },
];

/**
 * Painted (unkeyed) horse sheets: decorative scene horses only (a led horse in the paddock band,
 * the horse in the stable aisle). They never show a player's horse, so they carry no genes.
 */
export const DECORATIVE_HORSE_SHEETS = ["diorama/horse-walk-led", "diorama/horse-aisle-idle"] as const;
