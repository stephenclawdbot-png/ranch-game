"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { usePlayerState, type PlayerState } from "@/lib/player";
import { Crest } from "./icons";

/** Renders children with the player state, or nudges to /play if there is no stable yet. */
export function PlayerGate({ children, fallback }: { children: (s: PlayerState) => ReactNode; fallback?: ReactNode }) {
  const state = usePlayerState();
  if (state === undefined) return <>{fallback ?? <div className="min-h-[40vh]" aria-busy />}</>;
  if (state === null) return <JoinNudge />;
  return <>{children(state)}</>;
}

export function JoinNudge({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`panel flex flex-col items-center text-center ${compact ? "gap-3 p-6" : "gap-4 px-6 py-12"}`}>
      <Crest className="h-12 w-12" />
      <div>
        <p className="eyebrow">Membership</p>
        <h2 className="display mt-1 text-2xl font-semibold">You haven&rsquo;t founded a stable yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-cream-dim">
          Name your yard, register your racing colours and the club will send six horses to your barn.
        </p>
      </div>
      <Link href="/play" className="btn btn-brass">
        Found your stable
      </Link>
    </div>
  );
}
