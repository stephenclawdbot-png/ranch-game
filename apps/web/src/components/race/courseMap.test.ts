/**
 * The racecourse map and racecard strip, from the real course definitions (game-core): every
 * course draws a closed map with its post and start, the viewer accepts game-core's Course as
 * its course prop, and an unknown track keeps today's racecard (no strip).
 */
import React from "react";
(globalThis as unknown as { React: typeof React }).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COURSES, courseByName, type Course } from "@thoroughbred/game-core";
import { SCENERY, courseGeometry, pointAt, runnerArcM, startArcM, type CourseInfo, type RaceViewerProps } from "@thoroughbred/race-viewer";
import { CourseMap, CourseStrip, SceneryThumb, courseFacts } from "./CourseMap";

// game-core's Course is what the race page hands the viewer.
const asViewerCourse: CourseInfo = COURSES[0]!;
const viewerProp: RaceViewerProps["course"] = courseByName("Harrowgate");

describe("course map from game-core courses", () => {
  it("covers all six courses with distinct shapes or ways round", () => {
    expect(COURSES).toHaveLength(6);
    expect(asViewerCourse.name).toBe("Ashcombe");
    expect(viewerProp?.finishGradientPermille).toBeGreaterThan(0);
    expect(new Set(COURSES.map((c) => `${c.shape}/${c.direction}/${c.circumferenceM}`)).size).toBe(6);
  });

  it.each(COURSES.map((c) => [c.name, c] as [string, Course]))("%s: closed outline, post on the home straight, start by distance, dots advance", (_, c) => {
    const g = courseGeometry(c);
    expect(g.lapM).toBe(c.circumferenceM);
    const first = g.points[0]!;
    const last = g.points[g.points.length - 1]!;
    expect(Math.hypot(first[0] - last[0], first[1] - last[1])).toBeLessThan(0.05);
    expect(g.postM).toBeLessThanOrEqual(c.homeStraightM);
    for (const d of [1000, c.circumferenceM, c.circumferenceM + 400]) {
      const start = pointAt(g, startArcM(g, d));
      const back = pointAt(g, g.postM - d);
      expect(Math.hypot(start.x - back.x, start.y - back.y)).toBeLessThan(1e-9);
    }
    let prev = -Infinity;
    for (let x = 0; x <= 1600; x += 50) {
      const m = runnerArcM(g, 1600, x);
      expect(m).toBeGreaterThan(prev);
      prev = m;
    }
  });

  it("renders a pixel map for every course, with post, start and a gradient where there is one", () => {
    for (const c of COURSES) {
      const h = renderToStaticMarkup(React.createElement(CourseMap, { course: c, distanceM: 1600 }));
      expect(h).toContain(`data-course-map="${c.name}"`);
      expect(h).toContain('shape-rendering="crispEdges"');
      expect(h).toContain("#d71920"); // winning post
      expect(h).toContain("#7ee08a"); // start
      if (c.finishGradientPermille > 0) expect(h).toContain("#e0902f");
      if (c.finishGradientPermille < 0) expect(h).toContain("#7fb6d9");
      if (c.finishGradientPermille === 0) expect(h).not.toContain("#e0902f");
      expect(h).toMatch(/aria-label="[^"]*-handed course/);
    }
  });

  it("racecard strip: name, character and facts for a known track; nothing for an unknown one", () => {
    const h = renderToStaticMarkup(React.createElement(CourseStrip, { track: "Saltmarsh", distanceM: 2000 }));
    const salt = courseByName("Saltmarsh")!;
    expect(h).toContain("Saltmarsh");
    expect(h).toContain(salt.character.replace(/'/g, "&#x27;"));
    expect(h).toContain(courseFacts(salt));
    expect(renderToStaticMarkup(React.createElement(CourseStrip, { track: "Club", distanceM: 2000 }))).toBe("");
    expect(renderToStaticMarkup(React.createElement(CourseStrip, { track: undefined, distanceM: 2000 }))).toBe("");
  });

  it("scenery thumbnails use each course's own broadcast art", () => {
    for (const c of COURSES) {
      const h = renderToStaticMarkup(React.createElement(SceneryThumb, { course: c }));
      expect(h).toContain(`/art/${SCENERY[c.scenery].stand}`);
    }
  });
});
