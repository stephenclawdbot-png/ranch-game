"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CourseInfo } from "../course/geometry";
import { CourseMap, type CourseMapRunner } from "./CourseMap";

const MAP_KEY = "rv:map";
/** Phones keep their own choice, folded by default (V-01): the map is a tap away, never over the race. */
const MAP_KEY_PHONE = "rv:map-phone";

/** From this far out (m, the leader) the open map fades to its tab, until the next race or seek. */
export const MAP_AWAY_M = 200;
/** The fade (ms). */
export const MAP_FADE_MS = 300;

/**
 * Is the map stood down for the finish? Once the leader is within MAP_AWAY_M of the line it stays
 * down (through the line, the run-out and the finale); only a seek or a new race (`reset`) brings
 * it back, and then only while the leader is further out.
 */
export function courseMapAway(prev: boolean, raceT: number, toGoM: number, reset = false): boolean {
  const near = raceT > 0 && toGoM <= MAP_AWAY_M;
  return reset ? near : prev || near;
}

/** Same layout effect / SSR guard as the HUD (no layout effects on the server). */
const useMeasure = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The course map in the race HUD (top right, under the standings): course name, the map
 * with live runner dots, and an "uphill" flag while the field is on a climbing run-in.
 * Collapsible (remembered per browser), so it never has to sit over the action on a phone.
 * `away` (the finish, courseMapAway): the open map fades to its tab; the player can still open
 * it (for now, not remembered). `onRect` reports where the panel sits on the stage (CSS px) so the
 * 3D camera keeps the winner clear of it.
 */
export function CourseMapPanel({ course, distanceM, runners, narrow, onSlope, phone = false, away = false, onRect }: { course: CourseInfo; distanceM: number; runners: readonly CourseMapRunner[]; narrow: boolean; onSlope: boolean; phone?: boolean; away?: boolean; onRect?: (r: { x: number; y: number; w: number; h: number } | null) => void }) {
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
  // the finish: the open map fades to its tab; a tap still opens it for this finish
  const [awayOpen, setAwayOpen] = useState(false);
  const [fading, setFading] = useState(false);
  useEffect(() => {
    setAwayOpen(false);
    if (!away || !open) return;
    setFading(true);
    const id = window.setTimeout(() => setFading(false), MAP_FADE_MS);
    return () => window.clearTimeout(id);
  }, [away]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = away ? awayOpen : open;
  const ref = useRef<HTMLDivElement>(null);
  const onRectRef = useRef(onRect);
  onRectRef.current = onRect;
  useMeasure(() => {
    const el = ref.current;
    const host = el?.offsetParent as HTMLElement | null;
    if (!el || !host) return;
    const a = el.getBoundingClientRect();
    const b = host.getBoundingClientRect();
    onRectRef.current?.({ x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height });
  });
  useEffect(() => () => onRectRef.current?.(null), []);
  const toggle = () => {
    if (away) {
      setAwayOpen((o) => !o);
      setFading(false);
      return;
    }
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
    <div ref={ref} className={`rv-cmap${shown || fading ? "" : " rv-cmap-shut"}${phone ? " rv-cmap-phone" : ""}${fading ? " rv-cmap-fade" : ""}`} data-rv-course-map={shown ? "open" : fading ? "fading" : "folded"}>
      <button type="button" className="rv-cmap-tab" aria-expanded={shown} aria-label={shown ? "Hide the course map" : `Show the course map (${course.name})`} onClick={toggle} title={shown ? "Hide the course map" : "Show the course map"}>
        {phone && !shown ? <MapIcon /> : <span className="rv-cmap-name">{course.name}</span>}
        {slope && <span className={`rv-cmap-slope${grad > 0 ? "" : " rv-cmap-down"}`}>{phone && !shown ? (grad > 0 ? "▲" : "▼") : grad > 0 ? "▲ Uphill" : "▼ Downhill"}</span>}
        {!(phone && !shown) && <span aria-hidden>{shown ? "▾" : "▸"}</span>}
      </button>
      {(shown || fading) && <CourseMap course={course} distanceM={distanceM} runners={runners} cells={narrow ? 44 : 56} className="rv-cmap-svg" />}
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
