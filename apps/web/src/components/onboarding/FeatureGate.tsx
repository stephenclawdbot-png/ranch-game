"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePlayerState } from "@/lib/player";
import type { UnlockFeature } from "@/lib/types";
import { PixelIcon } from "../icons";
import { LOCKED_COPY } from "./guide";

/** True while a new stable hasn't opened this feature yet (signed out, existing stables: false). */
export function useLocked(feature: UnlockFeature): boolean {
  const state = usePlayerState();
  return state?.onboarding?.unlocks?.[feature] === false;
}

/** What a locked feature is and when it opens: a quiet card, never a nag. */
export function LockedNote({ feature, compact = false }: { feature: UnlockFeature; compact?: boolean }) {
  const c = LOCKED_COPY[feature];
  return (
    <section className={`surface flex items-start gap-3 ${compact ? "p-3" : "p-4"}`} data-testid={`locked-${feature}`} aria-label={`${c.name}: not open yet`}>
      <PixelIcon name="gate" size={32} />
      <div className="min-w-0 flex-1">
        <p className="eyebrow">Opens soon</p>
        <p className="t-title">{c.name}</p>
        <p className="t-meta">{c.what}</p>
        <p className="mt-1 text-sm font-bold">{c.when}</p>
        <Link href={c.wiki} className="link mt-1 inline-block text-sm">
          Read about it ›
        </Link>
      </div>
    </section>
  );
}

/**
 * Progressive unlocks: a new stable sees what a feature is and when it opens instead of the
 * feature itself. Existing stables and anything already opened see the feature as before.
 */
export function FeatureGate({ feature, children, compact }: { feature: UnlockFeature; children: ReactNode; compact?: boolean }) {
  const state = usePlayerState();
  if (state === undefined) return null;
  if (state?.onboarding?.unlocks?.[feature] === false) return <LockedNote feature={feature} compact={compact} />;
  return <>{children}</>;
}
