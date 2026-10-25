"use client";
import { useEffect, useState } from "react";

/**
 * Current time, ticking every `intervalMs`. Returns null until mounted so server and
 * client render identical markup (no hydration mismatch, no layout shift if callers
 * reserve space).
 */
export function useNow(intervalMs = 250): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/**
 * Offset between the server clock and this browser's clock (server - client), measured
 * from a server timestamp rendered into the page. Lets countdowns and the replay sync to
 * the server's post time even when the device clock is wrong.
 */
export function useClockSkew(serverNowMs: number): number {
  const [skew, setSkew] = useState(0);
  useEffect(() => {
    const s = serverNowMs - Date.now();
    // Ignore small differences (page render latency); correct only real clock drift.
    setSkew(Math.abs(s) > 1500 ? s : 0);
  }, [serverNowMs]);
  return skew;
}
