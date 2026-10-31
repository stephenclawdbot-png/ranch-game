"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { sendOnboarding, useOnboarding } from "./guide";

/** Seconds a card must stay on screen to count as read. */
const READ_MS = 2_000;

/** Calls `onRead` once after the element has been on screen (40 % of it) for READ_MS. */
function useReadOnScreen(ref: RefObject<HTMLDivElement | null>, pending: boolean, onRead: () => void, key: string): void {
  useEffect(() => {
    const el = ref.current;
    if (!pending || !el || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let sent = false;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting && !sent) {
          timer ??= setTimeout(() => {
            sent = true;
            onRead();
          }, READ_MS);
        } else if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [pending, key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Stable steps: "Read Why it went that way". The card is drawn in the browser, so once your
 * own result's Why card has been on screen a couple of seconds the browser reports it; the
 * server only counts it for a race your stable ran and has already watched.
 */
export function WhyRead({ raceId, enabled, children }: { raceId: string; enabled: boolean; children: ReactNode }) {
  const o = useOnboarding();
  const ref = useRef<HTMLDivElement>(null);
  const pending = enabled && !!o?.steps && !o.steps.steps.find((s) => s.key === "read_why")?.done;
  useReadOnScreen(ref, pending, () => void sendOnboarding({ action: "why", raceId }).catch(() => undefined), raceId);
  return <div ref={ref}>{children}</div>;
}

/**
 * The first-week list's "Read a career story": one of your own horses' stories, with something
 * in it, on screen a couple of seconds. Recorded once (a one-time mark), never paid.
 */
export function CareerStoryRead({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const o = useOnboarding();
  const ref = useRef<HTMLDivElement>(null);
  const pending = enabled && !!o?.firstWeek?.visible && !o.coachSeen.includes("career_story");
  useReadOnScreen(ref, pending, () => void sendOnboarding({ action: "coach", id: "career_story" }).catch(() => undefined), "career_story");
  return <div ref={ref}>{children}</div>;
}
