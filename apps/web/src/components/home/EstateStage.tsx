"use client";

/**
 * The Estate (design system v3, docs/redesign/REDESIGN.md §4.1): the yard is the screen.
 * A full-bleed living diorama with destination plaques pinned to its landmarks (in art pixels,
 * mapped through the same camera framing the engine and poster use, so they stay on the arch,
 * the stalls and the bell tower at any size), a greeting, and the overlay panels passed in.
 */
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Diorama } from "../diorama/Diorama";
import { computeFrame } from "../diorama/frame";
import { SCENES } from "../diorama/scenes";

export interface EstatePlaque {
  id: string;
  label: string;
  /** Short real status ("Off in 2:14", "3 horses"); omitted when there's nothing true to say. */
  status?: string;
  href: string;
  /** Landmarks in yard art pixels (840 x 360), best first: the first one in view and clear of
   *  the panels is used (phones see a narrow crop, desktop panels cover the right side). */
  at: readonly (readonly [number, number])[];
}

/** Yard landmarks (art px, measured on diorama/poster-yard.png). */
export const YARD = {
  tower: [420, 58],
  arch: [420, 166],
  stallsMid: [300, 206],
  stallsLeft: [176, 206],
  stallsRight: [545, 206],
  stallsRightIn: [516, 206],
  hay: [112, 232],
  hayLow: [112, 252],
  trough: [706, 250],
} as const satisfies Record<string, readonly [number, number]>;

const DEF = SCENES.yard;

/** Art px -> CSS px inside the stage box, plus whether the landmark is in view. */
interface StageMap {
  u: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  /** Areas plaques must stay clear of (stage-relative CSS px): the greeting, desktop panels. */
  avoid: { l: number; t: number; r: number; b: number }[];
}

function useStageMap(box: React.RefObject<HTMLDivElement | null>, avoid: React.RefObject<HTMLElement | null>[]) {
  const [frame, setFrame] = useState<StageMap | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const place = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const dpr = window.devicePixelRatio || 1;
      const f = computeFrame(DEF, r.width, r.height, dpr);
      const rects = avoid
        .map((a) => a.current?.getBoundingClientRect())
        .filter((a): a is DOMRect => !!a && a.width > 0)
        .map((a) => ({ l: a.left - r.left, t: a.top - r.top, r: a.right - r.left, b: a.bottom - r.top }));
      setFrame({ u: f.s / dpr, vx: f.vx, vy: f.vy, w: r.width, h: r.height, avoid: rects });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    for (const a of avoid) if (a.current) ro.observe(a.current);
    return () => ro.disconnect();
  }, [box, avoid]);
  return frame;
}

type Rect = { l: number; t: number; r: number; b: number };

/**
 * Lay the plaques out in order: each takes its first landmark that is in view and clear of the
 * avoid areas and of the plaques already placed (null = hidden at this size).
 */
function layoutPlaques(map: StageMap | null, plaques: EstatePlaque[]): ({ x: number; y: number } | null)[] {
  if (!map) return plaques.map(() => null);
  const taken: Rect[] = [...map.avoid];
  return plaques.map((p) => {
    // the plaque (status + serif label + pin) sits above its landmark: ~8.5 px a character
    const half = Math.max(p.label.length, p.status?.length ?? 0) * 4.25 + 16;
    const tall = p.status ? 62 : 46;
    for (const [ax, ay] of p.at) {
      const x = (ax - map.vx) * map.u;
      const y = (ay - map.vy) * map.u;
      const box = { l: x - half, r: x + half, t: y - tall, b: y };
      if (box.l < 6 || box.r > map.w - 6 || box.t < 6 || y > map.h - 12) continue;
      if (taken.some((a) => box.l < a.r + 6 && box.r > a.l - 6 && box.t < a.b + 4 && box.b > a.t - 4)) continue;
      taken.push(box);
      return { x, y };
    }
    return null;
  });
}

export function EstateStage({ eyebrow, greeting, plaques, children }: { eyebrow: ReactNode; greeting: ReactNode; plaques: EstatePlaque[]; children?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const greet = useRef<HTMLDivElement>(null);
  const panels = useRef<HTMLDivElement>(null);
  const [avoid] = useState(() => [greet, panels]);
  const map = useStageMap(box, avoid);
  const spots = layoutPlaques(map, plaques);
  return (
    <section className="estate bleed" data-testid="home-band" aria-label="Your estate">
      <div ref={box} className="estate-stage">
        <Diorama scene="yard" aspect={null} priority label="Your stable yard" style={{ position: "absolute", inset: 0 }} />
        <div className="estate-greet" ref={greet}>
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="estate-title">{greeting}</h1>
        </div>
        <nav aria-label="Estate destinations" className="estate-pins">
          {plaques.map((p, i) => {
            const at = spots[i];
            const inView = !!at;
            const x = at?.x ?? -999;
            const y = at?.y ?? -999;
            return (
              <Link
                key={p.id}
                href={p.href}
                className="plaque"
                data-testid={`plaque-${p.id}`}
                style={{ left: x, top: y, visibility: inView ? "visible" : "hidden" }}
                tabIndex={inView ? 0 : -1}
                aria-hidden={inView ? undefined : true}
              >
                {p.status && <span className="plaque-status">{p.status}</span>}
                <span className="plaque-label">{p.label}</span>
                <span className="plaque-pin" aria-hidden />
              </Link>
            );
          })}
        </nav>
        <div className="estate-fade" aria-hidden />
      </div>
      <div className="estate-panels" ref={panels}>
        {children}
      </div>
    </section>
  );
}

/** Time-of-day greeting ("Good evening"), local time; a blank before hydration. */
export function salutation(now: number | null): string {
  if (now === null) return "Welcome back";
  const h = new Date(now).getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
