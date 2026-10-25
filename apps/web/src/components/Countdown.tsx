"use client";
import { formatCountdown } from "@/lib/format";
import { useNow } from "@/lib/clock";

/** Live m:ss countdown to `targetMs` (server clock); `skewMs` = server - client. */
export function Countdown({ targetMs, skewMs = 0, className, doneLabel = "Off" }: { targetMs: number; skewMs?: number; className?: string; doneLabel?: string }) {
  const now = useNow(250);
  const remaining = now === null ? null : targetMs - (now + skewMs);
  return (
    <span className={`tabular ${className ?? ""}`} suppressHydrationWarning>
      {remaining === null ? "–:––" : remaining <= 0 ? doneLabel : formatCountdown(remaining)}
    </span>
  );
}
