/** Single import point for art-pipeline colour helpers (client-safe, pure). */
export { resolveHorseColors, MARKING_WHITE } from "@thoroughbred/art-pipeline";

/** One PixelLab file that exists under public/art (path relative to /art, with its pixel size). */
export interface ArtFile {
  path: string;
  w: number;
  h: number;
}

/** Code icon names whose PixelLab art has a different file name. */
const ICON_ALIASES: Record<string, string[]> = {
  stable: ["ui/icon-stable-door.png"],
  paddock: ["ui/icon-club-crest.png"],
  home: ["ui/icon-club-crest.png"],
  shield: ["ui/icon-shield.png"],
};

/**
 * Logical UI art slots -> candidate files under `public/art/` (first existing wins).
 * Every slot has a code-drawn pixel fallback, so a missing file never breaks a page.
 */
export const ART_SLOTS = {
  logo: ["ui/logo.png", "ui/logo-emblem.png", "ui/emblem.png", "ui/crest.png"],
  scene: {
    paddock: ["scenes/paddock.png", "scenes/paddock-day.png"],
    stable: ["scenes/stable-yard.png", "scenes/stable.png", "scenes/barn-exterior.png"],
    grandstand: ["scenes/grandstand.png", "scenes/finish-line.png", "scenes/grandstand-finish.png"],
    barn: ["scenes/barn-interior.png", "scenes/barn.png"],
  },
  portrait: (coat: string) => [`portraits/horse-${coat}.png`, `portraits/${coat}.png`],
  /** 64 px thumbnails: exact 2:1 box downsamples of the portraits (scripts/make-thumbs.py). */
  thumb: (coat: string) => [`portraits/thumb/horse-${coat}.png`],
  icon: (name: string) => [...(ICON_ALIASES[name] ?? []), `ui/icon-${name}.png`, `ui/icons/${name}.png`, `ui/${name}.png`],
} as const;

export type SceneName = keyof typeof ART_SLOTS.scene;

/** Picks the first available candidate. */
export function pickArt(files: ReadonlyMap<string, ArtFile>, candidates: readonly string[]): ArtFile | null {
  for (const c of candidates) {
    const f = files.get(c);
    if (f) return f;
  }
  return null;
}

export const artUrl = (f: ArtFile) => `/art/${f.path}`;
