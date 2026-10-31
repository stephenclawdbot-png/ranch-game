"use client";

import { useState, type ReactNode } from "react";
import { MentorPortrait } from "./Mentor";
import { MENTOR_FIRST, sendOnboarding, useOnboarding } from "./guide";

/**
 * A one-time coach mark: the mentor's 2-4 short pointers, inline above the part of the screen
 * they explain (never an overlay, so nothing is blocked on a phone). Shown to a new stable the
 * first time it opens the screen; "Got it" stores it per account and it never shows again.
 */
export function CoachMark({ id, title, points, className = "" }: { id: string; title: string; points: ReactNode[]; className?: string }) {
  const o = useOnboarding();
  const [hidden, setHidden] = useState(false);
  if (!o || !o.guided || hidden || o.coachSeen.includes(id) || o.coachSeen.includes("*")) return null;
  const dismiss = () => {
    setHidden(true);
    void sendOnboarding({ action: "coach", id }).catch(() => undefined);
  };
  return (
    <aside className={`coach-mark surface-2 grid gap-2 p-3 ${className}`} role="note" aria-labelledby={`coach-${id}-h`} data-testid={`coach-${id}`}>
      <div className="flex items-start gap-3">
        <span className="hidden sm:inline-grid">
          <MentorPortrait variant="face" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{MENTOR_FIRST}&rsquo;s pointers</p>
          <h2 id={`coach-${id}-h`} className="t-title mt-0.5">
            {title}
          </h2>
          <ul className="mt-1.5 grid list-disc gap-1 pl-5 text-[0.875rem] leading-5">
            {points.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      </div>
      <button type="button" className="btn btn-sm w-fit justify-self-end" onClick={dismiss} data-testid={`coach-${id}-ok`}>
        Got it
      </button>
    </aside>
  );
}
