"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { sendOnboarding, useOnboarding } from "./guide";

/** Seconds the Why card must stay on screen to count as read. */
const READ_MS = 2_000;

/**
 * Stable steps: "Read Why it went that way". The card is drawn in the browser, so once your
 * own result's Why card has been on screen a couple of seconds the browser reports it; the
 * server only counts it for a race your stable ran and has already watched.
 */
export function WhyRead({ raceId, enabled, children }: { raceId: string; enabled: boolean; children: ReactNode }) {
  const o = useOnboarding();
  const ref = useRef<HTMLDivElement>(null);
  const pending = enabled && !!o?.steps && !o.steps.steps.find((s) => s.key === "read_why")?.done;
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
            void sendOnboarding({ action: "why", raceId }).catch(() => undefined);
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
  }, [pending, raceId]);
  return <div ref={ref}>{children}</div>;
}
