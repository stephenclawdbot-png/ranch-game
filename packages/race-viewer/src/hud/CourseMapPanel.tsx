"use client";
import { useEffect, useState } from "react";
import type { CourseInfo } from "../course/geometry";
import { CourseMap, type CourseMapRunner } from "./CourseMap";

const MAP_KEY = "rv:map";

/**
 * The course map in the race HUD (top right, under the standings): course name, the map
 * with live runner dots, and an "uphill" flag while the field is on a climbing run-in.
 * Collapsible (remembered per browser), so it never has to sit over the action on a phone.
 */
export function CourseMapPanel({ course, distanceM, runners, narrow, onSlope }: { course: CourseInfo; distanceM: number; runners: readonly CourseMapRunner[]; narrow: boolean; onSlope: boolean }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(MAP_KEY) === "0") setOpen(false);
    } catch {
      /* storage blocked */
    }
  }, []);
  const toggle = () => {
    setOpen((o) => {
      try {
        window.localStorage.setItem(MAP_KEY, o ? "0" : "1");
      } catch {
        /* storage blocked: the choice lasts for this page only */
      }
      return !o;
    });
  };
  const grad = course.finishGradientPermille;
  return (
    <div className={`rv-cmap${open ? "" : " rv-cmap-shut"}`} data-rv-course-map="">
      <button type="button" className="rv-cmap-tab" aria-expanded={open} onClick={toggle} title={open ? "Hide the course map" : "Show the course map"}>
        <span className="rv-cmap-name">{course.name}</span>
        {onSlope && grad !== 0 && <span className={`rv-cmap-slope${grad > 0 ? "" : " rv-cmap-down"}`}>{grad > 0 ? "▲ Uphill" : "▼ Downhill"}</span>}
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open && <CourseMap course={course} distanceM={distanceM} runners={runners} cells={narrow ? 44 : 56} className="rv-cmap-svg" />}
    </div>
  );
}
