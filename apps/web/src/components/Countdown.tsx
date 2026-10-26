"use client";
import { formatCountdown } from "@/lib/format";
import { useNow } from "@/lib/clock";

/** Each changed character drops in (pixel-step animation), like a flip board. */
export function Digits({ text, className }: { text: string; className?: string }) {
  return (
    <span className={`score inline-flex ${className ?? ""}`} aria-label={text}>
      {[...text].map((ch, i) => (
        <span key={`${i}-${ch}`} className={ch === ":" ? "px-[0.04em] opacity-80" : "digit"} aria-hidden>
          {ch}
        </span>
      ))}
    </span>
  );
}

/** Live m:ss countdown to `targetMs` (server clock); `skewMs` = server - client. */
export function Countdown({ targetMs, skewMs = 0, className, doneLabel = "Off", animate = false }: { targetMs: number; skewMs?: number; className?: string; doneLabel?: string; animate?: boolean }) {
  const now = useNow(250);
  // First paint (SSR + hydration) uses the render-time clock instead of a "–:––" flash; the
  // pages are dynamic, so it is at most a request old, and the span suppresses the mismatch.
  // Digits (animate) nests spans, which suppressHydrationWarning doesn't cover: keep the dash there.
  const at = now ?? (animate ? null : Date.now());
  const remaining = at === null ? null : targetMs - (at + skewMs);
  const text = remaining === null ? "–:––" : remaining <= 0 ? doneLabel : formatCountdown(remaining);
  return (
    <span className={`tabular ${className ?? ""}`} suppressHydrationWarning>
      {animate ? <Digits text={text} /> : text}
    </span>
  );
}
