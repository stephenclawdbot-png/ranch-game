"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The screen's one primary action (Design System v2 §4.5). It renders inline where it is
 * placed (in the hero); on phones, once that spot has scrolled out of view, the same button
 * floats in the thumb zone above the tab bar, so the bar always mirrors the hero with the same
 * label (it is the same element, never a copy). Put exactly one `.btn.btn-brass` inside, and
 * never a disabled one: show the reason as text instead.
 */
export function ActionBar({ children, className }: { children: ReactNode; className?: string }) {
  const spot = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [floating, setFloating] = useState(false);
  const [h, setH] = useState<number | undefined>(undefined);

  useEffect(() => {
    const el = spot.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const mq = window.matchMedia("(max-width: 767.98px)");
    let visible = true;
    const update = () => setFloating(mq.matches && !visible);
    const io = new IntersectionObserver(
      ([e]) => {
        visible = !!e?.isIntersecting;
        update();
      },
      // The bottom 140 px is covered by the tab bar and the floating bar itself.
      { rootMargin: "-56px 0px -140px 0px" },
    );
    io.observe(el);
    mq.addEventListener("change", update);
    return () => {
      io.disconnect();
      mq.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    if (!floating && bar.current) setH(bar.current.offsetHeight);
  }, [floating]);

  return (
    <div ref={spot} className={`action-spot ${className ?? ""}`} style={floating && h ? { minHeight: h } : undefined}>
      <div ref={bar} className="action-bar" data-action-bar data-floating={floating ? "true" : "false"}>
        {children}
      </div>
    </div>
  );
}
