"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { usePlayerState, type PlayerState } from "@/lib/player";
import { Crest, PixelIcon } from "./icons";
import { ActionBar } from "./ui/ActionBar";
import { SceneBand, type SceneName } from "./ui/Page";

/**
 * Renders children with the player state, or the "found a stable" empty state. With `band`,
 * the signed-out page keeps the area's scene illustration up top, so it isn't one big flat
 * card on desktop.
 */
export function PlayerGate({
  children,
  fallback,
  band,
}: {
  children: (s: PlayerState) => ReactNode;
  fallback?: ReactNode;
  band?: { scene: SceneName; alt: string; eyebrow?: string; title: string };
}) {
  const state = usePlayerState();
  if (state === undefined) return <>{fallback ?? <div className="min-h-[40vh]" aria-busy />}</>;
  if (state === null)
    return (
      <div className="grid gap-5">
        {band && <SceneBand scene={band.scene} alt={band.alt} eyebrow={band.eyebrow} title={band.title} />}
        <JoinNudge />
      </div>
    );
  return <>{children(state)}</>;
}

/** Empty state: system status, a learning cue and a direct pathway. */
export function JoinNudge({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`surface flex flex-col items-center text-center ${compact ? "gap-3 p-5" : "gap-4 px-6 py-10"}`}>
      <Crest size={64} />
      <div>
        <h2 className="t-h2">No stable yet</h2>
        <p className="mx-auto mt-1 max-w-md text-cream-dim">Found a stable to get your first horses. It takes one tap, and your first race is a minute away.</p>
      </div>
      {compact ? (
        <Link href="/play" className="btn btn-brass btn-lg">
          <PixelIcon name="horseshoe" size={32} className="-my-2" /> Found your stable
        </Link>
      ) : (
        <ActionBar>
          <Link href="/play" className="btn btn-brass btn-lg">
            <PixelIcon name="horseshoe" size={32} className="-my-2" /> Found your stable
          </Link>
        </ActionBar>
      )}
    </div>
  );
}
