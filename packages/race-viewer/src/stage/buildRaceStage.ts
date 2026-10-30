/**
 * The race stage (pure, unit-tested): everything both broadcast views draw around the runners,
 * in world metres, built once per race from the course and the race conditions. Trackside
 * (ortho layers) and the 3D view (perspective world) render from it and keep only their own
 * projection, so a viewer switching views sees the same course, the same light, the same
 * landmarks at the same places.
 *
 * World units: metres. x along the track from the start (0) to the winning post (L) and on;
 * lanes count out from the inner rail (nearest the camera); "far" = the far (outer) rail,
 * where the grandstand, the poles and the winning post stand in both views.
 */
import { FURLONG_MM, type Going, type Surface, type Weather } from "@thoroughbred/shared";
import type { CourseInfo, CourseSceneryId } from "../course/geometry";
import { sceneryFor, type SceneryRecipe } from "../trackside/scenery";
import { plateGrid, type PlateGrid } from "./plates";
import { postHour, stageLook, type StageLook } from "./look";

/** Art file (manifest src path, e.g. "course/mid-gorse.png"). */
export type StageArt = string;

/**
 * Native size (px) of every art file the stage places. The stage stays pure (no image
 * loading); a test checks this table against the PNGs on disk.
 */
export const ART_SIZE: Record<string, [number, number]> = {
  "race/far-hills.png": [1376, 86],
  "race/bb-tree-oak.png": [240, 226],
  "race/bb-tree-oak-b.png": [236, 208],
  "race/bb-tree-poplar.png": [70, 240],
  "race/grandstand.png": [640, 319],
  "race/crowd-cheer.png": [3200, 128],
  "race/finish-post.png": [49, 202],
  "race/furlong-pole.png": [32, 142],
  "course/far-downs.png": [1376, 158],
  "course/far-coast.png": [1376, 111],
  "course/far-city.png": [1376, 121],
  "course/far-meadow.png": [1376, 113],
  "course/far-moor.png": [1376, 95],
  "course/mid-hawthorn.png": [183, 187],
  "course/mid-gorse.png": [116, 61],
  "course/mid-dunes.png": [384, 86],
  "course/mid-huts.png": [383, 117],
  "course/mid-terrace.png": [640, 256],
  "course/mid-lamp.png": [40, 160],
  "course/mid-willow.png": [236, 224],
  "course/mid-flowers.png": [376, 96],
  "course/mid-wall.png": [363, 64],
  "course/mid-heather.png": [244, 69],
  "course/mid-rowan.png": [164, 193],
  "course/rail-boards.png": [384, 48],
  "course/stand-downs.png": [512, 256],
  "course/stand-coast.png": [604, 314],
  "course/stand-city.png": [640, 320],
  "course/stand-meadow.png": [640, 288],
  "course/stand-moor.png": [640, 320],
};
const size = (src: StageArt): [number, number] => ART_SIZE[src] ?? [64, 64];

/** Source px per metre of the horse strips, rails, poles and rail decor (HD standard v2). */
export const FOCAL_PX_PER_M = 96;
/** Midground items: px per metre of height, and of spacing along the course. */
export const MID_PX_PER_M = 16;
export const MID_SPREAD_PX_PER_M = 12;
/** Grandstands: px per metre. */
export const STAND_PX_PER_M = 10;
/** The stand faces the run-in: centred this far before the winning post. */
export const STAND_BEFORE_POST_M = 30;
/** Rail spectators (the cheering crowd strip) along the far rail around the line. */
export const CROWD_FROM_BEFORE_M = 170;
export const CROWD_PAST_M = 40;
/** No marker closer to the start than this (the stalls stand there). */
export const MARKER_MIN_X = 20;

export const POLE_COLOURS = ["#c8102e", "#1f7a3a", "#1d3f8f", "#1d1d1b"] as const;
export const BOARD_COLOUR = "#f2c230";

export interface StageLanes {
  /** Lanes drawn (stall bays, track width). */
  count: number;
  /** One lateral scale for both views (m per lane). */
  widthM: number;
  /** Inner rail to the centre of lane 0 (m). */
  railGapM: number;
}

export interface StageElevation {
  /** Permille rise of the final stretch (positive = uphill). */
  gradientPermille: number;
  /** x where the slope starts (foot of the home straight). */
  fromX: number;
}

export interface StagePole {
  x: number;
  /** Furlongs to the winning post. */
  furlongs: number;
  label: string;
  colour: string;
  side: "far";
  plate: PlateGrid;
}
export interface StageBoard {
  x: number;
  label: "200" | "100";
  colour: string;
  side: "far";
  plate: PlateGrid;
}

export interface StageLandmarks {
  stalls: { x: 0; lanes: number };
  poles: StagePole[];
  boards: StageBoard[];
  winningPost: { x: number; side: "far"; roundel: true; art: StageArt };
  judgeBox: { x: number; side: "far"; depthM: number; widthM: number; heightM: number };
  finishLine: { x: number };
}

/** A midground template (art px), the authoring form Trackside bakes into its band. */
export interface MidTemplate {
  period: number;
  height: number;
  blur: number;
  haze: number;
  items: { src: StageArt; x: number; bottom: number; flip?: boolean }[];
}

export interface StageMidItem {
  src: StageArt;
  /** Centre along the course (m). */
  xM: number;
  /** Beyond the far rail (m). */
  depthM: number;
  widthM: number;
  heightM: number;
  flip: boolean;
}

export interface StageScenery {
  id: CourseSceneryId | null;
  far: StageArt;
  /** True when `far` is the course's own panorama (lighter haze). */
  farIsCourse: boolean;
  midTemplate: MidTemplate;
  mid: StageMidItem[];
  field: [string, string];
  railFill: [string, string];
  railDecor: { src: StageArt; everyM: number; liftM: number; widthM: number; heightM: number; everyPx: number; liftPx: number } | null;
  stand: { src: StageArt; centreX: number; widthM: number; heightM: number; depthM: number };
  crowd: { src: StageArt; fromX: number; toX: number }[];
}

export interface StageFx {
  /** "turf/good" style key into race/fx-palette.json (synthetic: "synthetic/*"). */
  key: string;
  /** Ground fx strips behind the hooves, main first. */
  emit: ("fx-mud" | "fx-dust" | "fx-divot")[];
}

export interface RaceStage {
  /** Race distance (m). */
  L: number;
  course: CourseInfo | null;
  surface: Surface;
  going: Going;
  lanes: StageLanes;
  elevation: StageElevation;
  look: StageLook;
  landmarks: StageLandmarks;
  scenery: StageScenery;
  fx: StageFx;
}

/** What the stage reads from a race (a replay or a live header satisfies it). */
export interface StageRaceInput {
  race: { weather: Weather; postTimeMs: number; surface: Surface; going: Going };
  trackLengthMm: number;
  laneCount: number;
  horses: ReadonlyArray<unknown>;
}

/** Height (m) of the track at x on a sloping finish (0 on the flat). */
export function elevationAt(e: StageElevation, x: number): number {
  return x <= e.fromX ? 0 : ((x - e.fromX) * e.gradientPermille) / 1000;
}

const TREES: MidTemplate = {
  period: 900,
  height: 270,
  blur: 1,
  haze: 0.42,
  items: [
    { src: "race/bb-tree-oak.png", x: 20, bottom: 262 },
    { src: "race/bb-tree-poplar.png", x: 260, bottom: 258 },
    { src: "race/bb-tree-poplar.png", x: 300, bottom: 262 },
    { src: "race/bb-tree-oak-b.png", x: 480, bottom: 264, flip: true },
    { src: "race/bb-tree-oak.png", x: 700, bottom: 260 },
  ],
};

function midTemplate(recipe: SceneryRecipe | null): MidTemplate {
  if (!recipe || recipe.mid === "trees") return TREES;
  const m = recipe.mid;
  return { period: m.period, height: m.height, blur: m.blur, haze: m.haze, items: m.items.map((it) => ({ src: it.src, x: it.x, bottom: it.bottom, flip: it.flip })) };
}

/** Midground instances along the course (pre-start run to past the run-out). */
function midItems(t: MidTemplate, L: number): StageMidItem[] {
  const periodM = t.period / MID_SPREAD_PX_PER_M;
  const out: StageMidItem[] = [];
  const from = -220;
  const to = L + 420;
  for (let n = Math.floor(from / periodM); n * periodM < to; n++) {
    for (const it of t.items) {
      const [w, h] = size(it.src);
      const xM = n * periodM + (it.x + w / 2) / MID_SPREAD_PX_PER_M;
      if (xM < from || xM > to) continue;
      out.push({ src: it.src, xM, depthM: 22 + Math.max(0, t.height - it.bottom) * 1.5, widthM: w / MID_PX_PER_M, heightM: h / MID_PX_PER_M, flip: !!it.flip });
    }
  }
  return out.sort((a, b) => a.xM - b.xM || a.depthM - b.depthM);
}

export function stageLandmarks(L: number, lanes: number): StageLandmarks {
  const furlong = FURLONG_MM / 1000;
  const poles: StagePole[] = [];
  // Every furlong counted back from the post. The 1f pole would stand 1.2 m from the 200 m
  // board, so the board marks that spot.
  for (let k = 2; L - k * furlong > MARKER_MIN_X; k++) {
    const colour = POLE_COLOURS[(k - 1) % POLE_COLOURS.length]!;
    poles.push({ x: L - k * furlong, furlongs: k, label: `${k}f`, colour, side: "far", plate: plateGrid(`${k}f`, colour) });
  }
  const boards: StageBoard[] = [];
  for (const d of [200, 100] as const) {
    if (L - d > MARKER_MIN_X) boards.push({ x: L - d, label: `${d}`, colour: BOARD_COLOUR, side: "far", plate: plateGrid(`${d}`, BOARD_COLOUR, "#1a1612") });
  }
  return {
    stalls: { x: 0, lanes },
    poles,
    boards,
    winningPost: { x: L, side: "far", roundel: true, art: "race/finish-post.png" },
    judgeBox: { x: L + 3, side: "far", depthM: 3, widthM: 1.8, heightM: 3.2 },
    finishLine: { x: L },
  };
}

export function stageScenery(recipe: SceneryRecipe | null, L: number): StageScenery {
  const t = midTemplate(recipe);
  const standSrc = recipe?.stand ?? "race/grandstand.png";
  const [sw, sh] = size(standSrc);
  const decor = recipe?.railDecor ?? null;
  const far = recipe?.far ?? "race/far-hills.png";
  return {
    id: recipe?.id ?? null,
    far,
    farIsCourse: !!recipe?.far,
    midTemplate: t,
    mid: midItems(t, L),
    field: recipe?.field ?? ["#5f6b3a", "#46582f"],
    railFill: recipe?.railFill ?? ["#4a5a34", "#3f5530"],
    railDecor: decor
      ? {
          src: decor.src,
          everyM: decor.every / FOCAL_PX_PER_M,
          liftM: decor.lift / FOCAL_PX_PER_M,
          widthM: size(decor.src)[0] / FOCAL_PX_PER_M,
          heightM: size(decor.src)[1] / FOCAL_PX_PER_M,
          everyPx: decor.every,
          liftPx: decor.lift,
        }
      : null,
    stand: { src: standSrc, centreX: L - STAND_BEFORE_POST_M, widthM: sw / STAND_PX_PER_M, heightM: sh / STAND_PX_PER_M, depthM: 30 },
    crowd: [{ src: "race/crowd-cheer.png", fromX: L - CROWD_FROM_BEFORE_M, toX: L + CROWD_PAST_M }],
  };
}

const EMIT: Record<string, StageFx["emit"]> = {
  "turf/firm": ["fx-dust"],
  "turf/good": ["fx-divot"],
  "turf/soft": ["fx-divot", "fx-mud"],
  "turf/heavy": ["fx-mud", "fx-divot"],
  "dirt/firm": ["fx-dust"],
  "dirt/good": ["fx-dust"],
  "dirt/soft": ["fx-mud"],
  "dirt/heavy": ["fx-mud"],
  "synthetic/*": ["fx-mud", "fx-dust"],
};

export function stageFx(surface: Surface, going: Going): StageFx {
  const key = surface === "synthetic" ? "synthetic/*" : `${surface}/${going}`;
  return { key, emit: EMIT[key] ?? ["fx-dust"] };
}

/**
 * Build the stage for a race on a course. `course` null (unknown track): the default
 * parkland look (oak line, far hills, the Victorian grandstand), flat.
 * `opts.hour` overrides the post hour (local time of the post; tests, dev pages).
 */
export function buildRaceStage(course: CourseInfo | null | undefined, race: StageRaceInput, opts: { hour?: number | null } = {}): RaceStage {
  const L = race.trackLengthMm / 1000;
  const lanes = Math.max(8, race.laneCount, race.horses.length);
  const c = course ?? null;
  const hour = opts.hour !== undefined ? opts.hour : postHour(race.race.postTimeMs);
  return {
    L,
    course: c,
    surface: race.race.surface,
    going: race.race.going,
    lanes: { count: lanes, widthM: 1.6, railGapM: 1.0 },
    elevation: { gradientPermille: c?.finishGradientPermille ?? 0, fromX: L - Math.min(L, c?.homeStraightM ?? L) },
    look: stageLook(race.race.weather, hour),
    landmarks: stageLandmarks(L, lanes),
    scenery: stageScenery(sceneryFor(c?.scenery), L),
    fx: stageFx(race.race.surface, race.race.going),
  };
}

/**
 * What a scene registered from the stage, for the guard test: landmark keys (kind@x:side),
 * scenery art set, look id and sun side. Both views must report the same inventory.
 */
export interface StageInventory {
  landmarks: string[];
  scenery: string[];
  lookId: string;
  sunSide: string;
}

export function landmarkKey(kind: string, x: number, side = "far"): string {
  return `${kind}@${x.toFixed(1)}:${side}`;
}

export function inventoryOf(landmarks: string[], scenery: Iterable<string>, look: StageLook): StageInventory {
  return { landmarks: [...landmarks].sort(), scenery: [...new Set(scenery)].sort(), lookId: look.id, sunSide: look.sunSide };
}
