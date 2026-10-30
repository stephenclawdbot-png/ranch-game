/**
 * The six racecourses (owner request 2026-10-30): each races differently, has its own weather
 * and ground, and looks different on the broadcast. This file is the one shared definition the
 * race engine (course character), the climate model (weather and going) and the race viewer
 * (scenery and course map) all read. A race names its course in `conditions.track`.
 *
 * Effects are kept modest on purpose: a course should tilt a race towards a type of horse, never
 * decide it. Every number here is a starting value; the season harness tunes them (KNOBS §6).
 *
 * Integer maths only, like the rest of game-core (permille, metres).
 */
import type { RaceCourse, Surface } from "@thoroughbred/shared";

export type CourseId = "ashcombe" | "kestrel_downs" | "saltmarsh" | "bellmont" | "larkspur" | "harrowgate";

/** Overhead shape of the course, for the course map (the race itself is drawn side-on). */
export type CourseShape = "oval" | "pear" | "triangle" | "horseshoe";

/** Scenery set the broadcast draws around the track. */
export type CourseScenery = "parkland" | "chalk_downs" | "coastal" | "city" | "meadow" | "moorland";

export interface Course {
  id: CourseId;
  /** Display name: what `conditions.track` holds. */
  name: string;
  /** One line for the racecard and the wiki. */
  character: string;
  /** Which way the horses run round the bends. */
  direction: "left" | "right";
  shape: CourseShape;
  /** Length of one lap, metres. */
  circumferenceM: number;
  /** Home straight (last bend to the line), metres. Long straights suit closers. */
  homeStraightM: number;
  /** Bend tightness 0..1000 (0 = sweeping, 1000 = very tight). Tight bends suit front-runners and low draws. */
  bendTightness: number;
  /** Gradient of the final stretch, permille rise (positive = uphill finish, a stamina test). */
  finishGradientPermille: number;
  /** Surfaces this course races on (the card only uses these). */
  surfaces: readonly Surface[];
  /** How fast the ground dries after rain, 0..1000 (sandy coast drains fast, clay moor slowly). */
  drainage: number;
  /** Rain tendency relative to the season, permille (1000 = average). */
  rainBias: number;
  scenery: CourseScenery;
}

export const COURSES: readonly Course[] = [
  {
    id: "ashcombe",
    name: "Ashcombe",
    character: "A wide, fair parkland oval: no tricks, the best horse usually wins.",
    direction: "right",
    shape: "oval",
    circumferenceM: 2400,
    homeStraightM: 500,
    bendTightness: 150,
    finishGradientPermille: 0,
    surfaces: ["turf", "dirt"],
    drainage: 500,
    rainBias: 1000,
    scenery: "parkland",
  },
  {
    id: "kestrel_downs",
    name: "Kestrel Downs",
    character: "Tight and turning on the chalk: front-runners and low draws are hard to pass.",
    direction: "left",
    shape: "triangle",
    circumferenceM: 1800,
    homeStraightM: 280,
    bendTightness: 900,
    finishGradientPermille: 0,
    surfaces: ["turf", "synthetic"],
    drainage: 800,
    rainBias: 900,
    scenery: "chalk_downs",
  },
  {
    id: "saltmarsh",
    name: "Saltmarsh",
    character: "A long, galloping coastal track with the longest straight: closers come late.",
    direction: "left",
    shape: "oval",
    circumferenceM: 2800,
    homeStraightM: 800,
    bendTightness: 200,
    finishGradientPermille: 0,
    surfaces: ["turf"],
    drainage: 900,
    rainBias: 1300,
    scenery: "coastal",
  },
  {
    id: "bellmont",
    name: "Bellmont",
    character: "A flat, fast city track: speed and an even pace.",
    direction: "left",
    shape: "oval",
    circumferenceM: 2000,
    homeStraightM: 450,
    bendTightness: 500,
    finishGradientPermille: 0,
    surfaces: ["dirt", "synthetic", "turf"],
    drainage: 700,
    rainBias: 900,
    scenery: "city",
  },
  {
    id: "larkspur",
    name: "Larkspur",
    character: "A gentle meadow pear-shape, slightly downhill home: quick times on fast ground.",
    direction: "right",
    shape: "pear",
    circumferenceM: 2200,
    homeStraightM: 550,
    bendTightness: 400,
    finishGradientPermille: -5,
    surfaces: ["turf", "dirt"],
    drainage: 600,
    rainBias: 1000,
    scenery: "meadow",
  },
  {
    id: "harrowgate",
    name: "Harrowgate",
    character: "A stiff moorland horseshoe with an uphill finish: a true test of stamina.",
    direction: "right",
    shape: "horseshoe",
    circumferenceM: 2600,
    homeStraightM: 450,
    bendTightness: 400,
    finishGradientPermille: 35,
    surfaces: ["turf", "dirt"],
    drainage: 300,
    rainBias: 1200,
    scenery: "moorland",
  },
];

const BY_NAME = new Map(COURSES.map((c) => [c.name, c] as const));
const BY_ID = new Map(COURSES.map((c) => [c.id, c] as const));

/** The course a race runs on, from its `conditions.track` name; null for an unknown or missing name. */
export function courseByName(name: string | null | undefined): Course | null {
  return name ? (BY_NAME.get(name) ?? null) : null;
}

export function courseById(id: CourseId): Course {
  return BY_ID.get(id)!;
}

/** Courses that race on this surface (the card picks a track from these). */
export function coursesFor(surface: Surface): Course[] {
  return COURSES.filter((c) => c.surfaces.includes(surface));
}

/** Bends per lap by shape (a triangle turns three times, the rest twice). */
export const BENDS_PER_LAP: Record<CourseShape, number> = { oval: 2, pear: 2, triangle: 3, horseshoe: 2 };

/**
 * The engine's course profile (racing-engine 1.3.0 course character) for a course. Frozen into
 * a Live race's field at entry lock, so later tuning here never changes a race already run.
 */
export function courseProfile(course: Course): RaceCourse {
  return {
    id: course.id,
    direction: course.direction,
    circumferenceM: course.circumferenceM,
    homeStraightM: course.homeStraightM,
    bendsPerLap: BENDS_PER_LAP[course.shape],
    bendTightness: course.bendTightness,
    finishGradientPermille: course.finishGradientPermille,
  };
}
