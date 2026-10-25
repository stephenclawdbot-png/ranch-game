"use client";
import { useEffect, useState } from "react";
import type { Horse, Silks } from "@thoroughbred/shared";

const cache = new Map<string, Horse[]>();

/** Fetches the player's starter horses and paints them in the player's chosen silks. */
export function usePlayerHorses(playerId: string | undefined, silks: Silks | undefined): { horses: Horse[] | null; error: string | null } {
  const [horses, setHorses] = useState<Horse[] | null>(() => (playerId ? cache.get(playerId) ?? null : null));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!playerId) return;
    const hit = cache.get(playerId);
    if (hit) {
      setHorses(hit);
      return;
    }
    let cancelled = false;
    fetch(`/api/stable/${playerId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { horses: Horse[] }) => {
        cache.set(playerId, data.horses);
        if (!cancelled) setHorses(data.horses);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  const painted = horses && silks ? horses.map((h) => ({ ...h, appearance: { ...h.appearance, silks } })) : horses;
  return { horses: painted, error };
}
