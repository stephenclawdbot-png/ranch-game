"use client";

import { useEffect, useRef } from "react";

/**
 * Subtle 3D tilt + parallax driver. Writes CSS variables on the element (no React
 * re-render): --rx/--ry (degrees) for `.tilt`, --px/--py (-0.5..0.5) for `.parallax`
 * children. Disabled for coarse pointers and prefers-reduced-motion.
 */
export function useTilt<T extends HTMLElement>(maxDeg = 6) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let raf = 0;
    const set = (nx: number, ny: number, active: boolean) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty("--rx", `${(-ny * maxDeg).toFixed(2)}deg`);
        el.style.setProperty("--ry", `${(nx * maxDeg).toFixed(2)}deg`);
        el.style.setProperty("--px", nx.toFixed(3));
        el.style.setProperty("--py", ny.toFixed(3));
        el.dataset.active = active ? "true" : "false";
      });
    };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      set((e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5, true);
    };
    const leave = () => set(0, 0, false);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [maxDeg]);
  return ref;
}
