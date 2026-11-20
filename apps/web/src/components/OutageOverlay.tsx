"use client";

import { useEffect } from "react";
import { clearOutage, isOutageResponse, useOutage } from "@/lib/outage";
import { refreshPlayer } from "@/lib/player";
import { OutageScreen } from "./OutageScreen";

/** Asks the server whether the database answers again (GET /api/health: one `select 1`). */
async function databaseIsBack(): Promise<boolean> {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    return res.ok || !(await isOutageResponse(res));
  } catch {
    return false;
  }
}

/**
 * The outage screen over the page (root layout), shown while an API call has reported the
 * database down (lib/outage.ts). The page underneath is hidden rather than left half-working.
 * "Try again" asks the server once; when it answers, the player state reloads and the page shows
 * again. No polling: the screen waits for the player.
 */
export function OutageOverlay() {
  const down = useOutage();
  useEffect(() => {
    if (!down) return;
    document.documentElement.setAttribute("data-outage", "1");
    return () => document.documentElement.removeAttribute("data-outage");
  }, [down]);
  if (!down) return null;
  const retry = async () => {
    if (!(await databaseIsBack())) return;
    clearOutage();
    await refreshPlayer().catch(() => undefined);
  };
  return (
    <div className="outage-overlay" data-testid="outage-overlay">
      <OutageScreen variant="outage" onRetry={retry} />
    </div>
  );
}
