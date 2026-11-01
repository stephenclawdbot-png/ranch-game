"use client";
import { useEffect, useState } from "react";
import type { CourseInfo } from "../course/geometry";
import { CourseMap, type CourseMapRunner } from "./CourseMap";

const MAP_KEY = "rv:map";
/** Phones keep their own choice, folded by default (V-01): the map is a tap away, never over the race. */
const MAP_KEY_PHONE = "rv:map-phone";

/**
 * The course map in the race HUD (top right, under the standings): course name, the map
 * with live runner dots, and an "uphill" flag while the field is on a climbing run-in.
 * Collapsible (remembered per browser), so it never has to sit over the action on a phone.
 */
export function CourseMapPanel({ course, distanceM, runners, narrow, onSlope, phone = false }: { course: CourseInfo; distanceM: number; runners: readonly CourseMapRunner[]; narrow: boolean; onSlope: boolean; phone?: boolean }) {
  const key = phone ? MAP_KEY_PHONE : MAP_KEY;
  const [open, setOpen] = useState(!phone);
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(key);
      setOpen(phone ? v === "1" : v !== "0");
    } catch {
      setOpen(!phone);
    }
  }, [key, phone]);
  const toggle = () => {
    setOpen((o) => {
      try {
        window.localStorage.setItem(key, o ? "0" : "1");
      } catch {
        /* storage blocked: the choice lasts for this page only */
      }
      return !o;
    });
  };
  const grad = course.finishGradientPermille;
  const slope = onSlope && grad !== 0;
  return (
    <div className={`rv-cmap${open ? "" : " rv-cmap-shut"}${phone ? " rv-cmap-phone" : ""}`} data-rv-course-map={open ? "open" : "folded"}>
      <button type="button" className="rv-cmap-tab" aria-expanded={open} aria-label={open ? "Hide the course map" : `Show the course map (${course.name})`} onClick={toggle} title={open ? "Hide the course map" : "Show the course map"}>
        {phone && !open ? <MapIcon /> : <span className="rv-cmap-name">{course.name}</span>}
        {slope && <span className={`rv-cmap-slope${grad > 0 ? "" : " rv-cmap-down"}`}>{phone && !open ? (grad > 0 ? "▲" : "▼") : grad > 0 ? "▲ Uphill" : "▼ Downhill"}</span>}
        {!(phone && !open) && <span aria-hidden>{open ? "▾" : "▸"}</span>}
      </button>
      {open && <CourseMap course={course} distanceM={distanceM} runners={runners} cells={narrow ? 44 : 56} className="rv-cmap-svg" />}
    </div>
  );
}

function MapIcon() {
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden>
      <rect x="1.5" y="2" width="13" height="10" rx="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="11" y="1" width="3" height="3" fill="currentColor" />
    </svg>
  );
}
