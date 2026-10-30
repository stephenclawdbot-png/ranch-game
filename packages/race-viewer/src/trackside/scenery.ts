/**
 * Racecourse scenery for the Trackside view (pure data, no DOM): what each `CourseScenery`
 * draws around the track. Every set swaps the same layers of the existing recipe:
 *
 *  far     the distant panorama (hills / downs with the white horse / sea / skyline / moor)
 *  mid     the blurred midground band (trees, dunes and beach huts, terraces, meadow, walls)
 *  field   the flat strip between the far layer and the far rail
 *  rail    grass behind the far rail and decor set along it (gorse, boards, flowers, walls)
 *  stand   a grandstand anchored at the winning post (parallax with the midground)
 *
 * Weather looks (looks.ts) still tint and haze all of it. Parkland (Ashcombe) is the
 * original art plus its grandstand; a race without a known course keeps today's look
 * (no stand). Art lives in public/art/course (PixelLab, art-src/course), except parkland
 * which reuses public/art/race.
 */
import type { CourseSceneryId } from "../course/geometry";

/** Course art files (manifest src paths), loaded only for the race's own scenery. */
export const COURSE_ART = [
  "course/far-downs.png",
  "course/far-coast.png",
  "course/far-city.png",
  "course/far-meadow.png",
  "course/far-moor.png",
  "course/mid-hawthorn.png",
  "course/mid-gorse.png",
  "course/mid-dunes.png",
  "course/mid-huts.png",
  "course/mid-terrace.png",
  "course/mid-lamp.png",
  "course/mid-willow.png",
  "course/mid-flowers.png",
  "course/mid-wall.png",
  "course/mid-heather.png",
  "course/mid-rowan.png",
  "course/rail-boards.png",
  "course/stand-downs.png",
  "course/stand-coast.png",
  "course/stand-city.png",
  "course/stand-meadow.png",
  "course/stand-moor.png",
  "race/grandstand.png",
] as const;
export type CourseArtSrc = (typeof COURSE_ART)[number];

export interface MidItem {
  src: CourseArtSrc;
  /** Left edge (art px) inside the period. */
  x: number;
  /** Bottom edge (art px from the band canvas top). */
  bottom: number;
  flip?: boolean;
}

export interface SceneryRecipe {
  id: CourseSceneryId;
  /** Far panorama; null keeps the original far hills. */
  far: CourseArtSrc | null;
  /** Midground band; "trees" keeps the original oak and poplar line. */
  mid: { period: number; height: number; items: MidItem[]; blur: number; haze: number } | "trees";
  /** Field strip gradient (top, bottom) between the far layer and the far rail. */
  field: [string, string];
  /** Grass band behind the far rail (top, bottom). */
  railFill: [string, string];
  /** Decor repeated along the far rail, behind it (sharp, rail scale). */
  railDecor: { src: CourseArtSrc; every: number; lift: number } | null;
  /** Grandstand at the winning post. */
  stand: CourseArtSrc;
}

const P = 1200; // midground period (art px)
const H = 270; // midground canvas height; the rail line sits 22 px below it (baseline 292)

export const SCENERY: Record<CourseSceneryId, SceneryRecipe> = {
  parkland: {
    id: "parkland",
    far: null,
    mid: "trees",
    field: ["#5f6b3a", "#46582f"],
    railFill: ["#4a5a34", "#3f5530"],
    railDecor: null,
    stand: "race/grandstand.png",
  },
  chalk_downs: {
    id: "chalk_downs",
    far: "course/far-downs.png",
    mid: {
      // open downland: a few windswept thorns and gorse, so the hills and the white horse show
      period: 1500,
      height: H,
      blur: 1,
      haze: 0.38,
      items: [
        { src: "course/mid-hawthorn.png", x: 40, bottom: 266 },
        { src: "course/mid-gorse.png", x: 250, bottom: 268 },
        { src: "course/mid-gorse.png", x: 330, bottom: 270, flip: true },
        { src: "course/mid-gorse.png", x: 760, bottom: 268 },
        { src: "course/mid-hawthorn.png", x: 1020, bottom: 266, flip: true },
        { src: "course/mid-gorse.png", x: 1260, bottom: 269, flip: true },
      ],
    },
    field: ["#8a9a52", "#6a7f3e"],
    railFill: ["#6f8442", "#5a7036"],
    railDecor: { src: "course/mid-gorse.png", every: 520, lift: 6 },
    stand: "course/stand-downs.png",
  },
  coastal: {
    id: "coastal",
    far: "course/far-coast.png",
    mid: {
      period: 1152,
      height: H,
      blur: 0.8,
      haze: 0.32,
      items: [
        { src: "course/mid-dunes.png", x: 0, bottom: 268 },
        { src: "course/mid-dunes.png", x: 384, bottom: 270, flip: true },
        { src: "course/mid-dunes.png", x: 768, bottom: 268 },
        { src: "course/mid-huts.png", x: 430, bottom: 236 },
      ],
    },
    field: ["#b9a874", "#8e8a56"],
    railFill: ["#a29a62", "#7f7f4c"],
    railDecor: null,
    stand: "course/stand-coast.png",
  },
  city: {
    id: "city",
    far: "course/far-city.png",
    mid: {
      // one terrace row per period, street lamps between: the skyline shows in the gaps
      period: 1700,
      height: H,
      blur: 1,
      haze: 0.4,
      items: [
        { src: "course/mid-terrace.png", x: 0, bottom: 268 },
        { src: "course/mid-lamp.png", x: 720, bottom: 270 },
        { src: "course/mid-lamp.png", x: 1000, bottom: 270 },
        { src: "course/mid-lamp.png", x: 1280, bottom: 270 },
        { src: "course/mid-lamp.png", x: 1560, bottom: 270 },
      ],
    },
    field: ["#5d6648", "#47553a"],
    railFill: ["#4a5a38", "#3e5232"],
    railDecor: { src: "course/rail-boards.png", every: 384, lift: 2 },
    stand: "course/stand-city.png",
  },
  meadow: {
    id: "meadow",
    far: "course/far-meadow.png",
    mid: {
      period: P,
      height: H,
      blur: 1,
      haze: 0.36,
      items: [
        { src: "course/mid-willow.png", x: 60, bottom: 262 },
        { src: "course/mid-willow.png", x: 700, bottom: 264, flip: true },
        { src: "course/mid-flowers.png", x: 0, bottom: 272 },
        { src: "course/mid-flowers.png", x: 384, bottom: 272, flip: true },
        { src: "course/mid-flowers.png", x: 768, bottom: 272 },
        { src: "course/mid-flowers.png", x: 1152, bottom: 272, flip: true },
      ],
    },
    field: ["#7f8f40", "#5c7a34"],
    railFill: ["#5a7a34", "#4c6c2e"],
    railDecor: { src: "course/mid-flowers.png", every: 384, lift: 0 },
    stand: "course/stand-meadow.png",
  },
  moorland: {
    id: "moorland",
    far: "course/far-moor.png",
    mid: {
      period: P,
      height: H,
      blur: 1,
      haze: 0.36,
      // the rowans first: heather drawn over their rocky bases hides where the sprite is cut
      items: [
        { src: "course/mid-rowan.png", x: 200, bottom: 262 },
        { src: "course/mid-rowan.png", x: 930, bottom: 264, flip: true },
        { src: "course/mid-heather.png", x: 0, bottom: 270 },
        { src: "course/mid-heather.png", x: 420, bottom: 272, flip: true },
        { src: "course/mid-heather.png", x: 760, bottom: 270 },
        { src: "course/mid-heather.png", x: 1000, bottom: 271, flip: true },
      ],
    },
    field: ["#6e5a4a", "#55503a"],
    railFill: ["#5b5a3a", "#4a4c32"],
    railDecor: { src: "course/mid-wall.png", every: 384, lift: 0 },
    stand: "course/stand-moor.png",
  },
};

/** The scenery set for a course; null (unknown or missing course) keeps today's look. */
export function sceneryFor(id: CourseSceneryId | null | undefined): SceneryRecipe | null {
  return id ? (SCENERY[id] ?? null) : null;
}

/** Every art file a scenery needs (far, midground, rail decor, stand). */
export function sceneryArt(r: SceneryRecipe): CourseArtSrc[] {
  const out = new Set<CourseArtSrc>();
  if (r.far) out.add(r.far);
  if (r.mid !== "trees") for (const it of r.mid.items) out.add(it.src);
  if (r.railDecor) out.add(r.railDecor.src);
  out.add(r.stand);
  return [...out];
}

/**
 * Finish gradient as a picture tilt (radians, positive = the track rises to the right).
 * Real gradients are a few permille; the picture exaggerates them so a 3 % climb reads.
 * `along` is how far into the sloping final stretch the camera is (0..1).
 */
export const TILT_EXAGGERATION = 1.25;
export function finishTilt(gradientPermille: number, along: number): number {
  const a = Math.min(1, Math.max(0, along));
  const ease = a * a * (3 - 2 * a);
  return Math.atan(gradientPermille / 1000) * TILT_EXAGGERATION * ease;
}
