"use client";

/**
 * Wraps a trophy (or plaque) so its hover card never crosses the right viewport edge: the fixed
 * first-three / last-three nth-child rules can't know where a wrapped row's right edge is on a
 * phone, so the flip is measured on open instead (the card's max-width is 240 px — see .trophy-card).
 */
import type { ReactNode, SyntheticEvent } from "react";

const CARD_W = 240;

const flip = (e: SyntheticEvent<HTMLElement>) => {
  const el = e.currentTarget;
  el.classList.toggle("card-flip", el.getBoundingClientRect().right + CARD_W > window.innerWidth);
};

export function InwardCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={className} onMouseEnter={flip} onFocus={flip}>
      {children}
    </span>
  );
}
