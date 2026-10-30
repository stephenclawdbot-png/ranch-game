/**
 * TEST ONLY: the six courses as the viewer sees them (CourseInfo subset of game-core's
 * courses.ts; race-viewer doesn't depend on game-core). Keep in step with courses.ts.
 */
import type { CourseInfo } from "../course/geometry";

export const COURSE_FIXTURES: (CourseInfo & { id: string })[] = [
  { id: "ashcombe", name: "Ashcombe", direction: "right", shape: "oval", circumferenceM: 2400, homeStraightM: 500, bendTightness: 150, finishGradientPermille: 0, scenery: "parkland" },
  { id: "kestrel_downs", name: "Kestrel Downs", direction: "left", shape: "triangle", circumferenceM: 1800, homeStraightM: 280, bendTightness: 900, finishGradientPermille: 0, scenery: "chalk_downs" },
  { id: "saltmarsh", name: "Saltmarsh", direction: "left", shape: "oval", circumferenceM: 2800, homeStraightM: 800, bendTightness: 200, finishGradientPermille: 0, scenery: "coastal" },
  { id: "bellmont", name: "Bellmont", direction: "left", shape: "oval", circumferenceM: 2000, homeStraightM: 450, bendTightness: 500, finishGradientPermille: 0, scenery: "city" },
  { id: "larkspur", name: "Larkspur", direction: "right", shape: "pear", circumferenceM: 2200, homeStraightM: 550, bendTightness: 400, finishGradientPermille: -5, scenery: "meadow" },
  { id: "harrowgate", name: "Harrowgate", direction: "right", shape: "horseshoe", circumferenceM: 2600, homeStraightM: 450, bendTightness: 400, finishGradientPermille: 35, scenery: "moorland" },
];
