"use client";
import { useNow } from "@/lib/clock";

/** A time in the viewer's own timezone (rendered on the client; the server's guess is replaced on mount). */
export function LocalTime({ ms, withDate = false }: { ms: number; withDate?: boolean }) {
  const d = new Date(ms);
  const text = withDate
    ? d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <time dateTime={d.toISOString()} suppressHydrationWarning>
      {text}
    </time>
  );
}

/** "3 d 4 h" / "5 h 12 min" / "42 min" until `targetMs` (server clock via `skewMs`). */
export function TimeLeft({ targetMs, skewMs = 0 }: { targetMs: number; skewMs?: number }) {
  const now = useNow(30_000);
  if (now === null) return <span>–</span>;
  const left = Math.max(0, targetMs - (now + skewMs));
  const min = Math.floor(left / 60_000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  return <span className="tabular">{d > 0 ? `${d} d ${h} h` : h > 0 ? `${h} h ${m} min` : `${m} min`}</span>;
}

/** A calendar date block: weekday + day number (Jersey) + time, in the viewer's timezone. */
export function DateBlock({ ms }: { ms: number }) {
  const d = new Date(ms);
  return (
    <span className="date-block" suppressHydrationWarning>
      <span className="text-[0.6875rem] font-extrabold uppercase leading-4">{d.toLocaleDateString("en-GB", { weekday: "short" })}</span>
      <span className="score text-[1.75rem] leading-none">{d.getDate()}</span>
      <span className="text-[0.6875rem] font-bold leading-4">{d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
    </span>
  );
}
