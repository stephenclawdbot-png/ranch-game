"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { usePlayerState, type PlayerState } from "@/lib/player";
import { Crest, PixelIcon } from "./icons";
import { ActionBar } from "./ui/ActionBar";

/** Renders children with the player state, or the "found a stable" empty state. */
export function PlayerGate({ children, fallback }: { children: (s: PlayerState) => ReactNode; fallback?: ReactNode }) {
  const state = usePlayerState();
  if (state === undefined) return <>{fallback ?? <div className="min-h-[40vh]" aria-busy />}</>;
  if (state === null) return <JoinNudge />;
  return <>{children(state)}</>;
}

/** Empty state: system status, a learning cue and a direct pathway. */
export function JoinNudge({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`surface flex flex-col items-center text-center ${compact ? "gap-3 p-5" : "gap-4 px-6 py-10"}`}>
      <Crest className={compact ? "h-12 w-14" : "h-16 w-[4.75rem]"} />
      <div>
        <h2 className="t-display-m">No stable yet</h2>
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
