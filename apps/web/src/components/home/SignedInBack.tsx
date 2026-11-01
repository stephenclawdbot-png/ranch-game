"use client";
/**
 * Home right after a sign-in on this browser (invite link, login code, device code or wallet
 * land on /?back=1): "Welcome back, <Stable>" and ONE button, the most relevant next thing
 * (lib/welcomeBackNext). Closing it, or following it, drops the ?back=1 from the address.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import type { HomeTiles } from "@/lib/homeTypes";
import { recommendHorse, type PlayerState } from "@/lib/player";
import { welcomeBackNext } from "@/lib/welcomeBackNext";
import { PixelIcon } from "../icons";
import { STEP_COPY } from "../onboarding/guide";
import { stepHref } from "../onboarding/StableSteps";

/** Whether this page load came from a sign-in (?back=1). */
export function useJustSignedIn(): [boolean, () => void] {
  const [back, setBack] = useState(false);
  useEffect(() => {
    setBack(new URLSearchParams(window.location.search).get("back") === "1");
  }, []);
  const clear = () => {
    setBack(false);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("back");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      /* the address keeps ?back=1; harmless */
    }
  };
  return [back, clear];
}

export function SignedInBack({ state, onClose }: { state: PlayerState; onClose: () => void }) {
  /** Home's Story tile; undefined until it loads, so the button doesn't change under the finger. */
  const [story, setStory] = useState<HomeTiles["story"] | null | undefined>(undefined);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    let live = true;
    fetch("/api/home", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<HomeTiles>) : null))
      .then((t) => live && setStory(t?.story ?? null))
      .catch(() => live && setStory(null));
    return () => {
      live = false;
    };
  }, []);
  if (now === null || story === undefined) return null;
  const fw = state.onboarding?.firstWeek?.visible ? state.onboarding.firstWeek.next[0] : undefined;
  const ready = recommendHorse(state);
  const action = welcomeBackNext({
    nowMs: now,
    inbox: state.inbox,
    active: state.active,
    runs: state.runs,
    horseName: (id) => state.horses.find((h) => h.id === id)?.horse.name ?? null,
    story: story ? { chapter: story.chapter, raceName: story.raceName } : null,
    firstWeek: fw ? { title: STEP_COPY[fw]?.title ?? "Your next job", href: stepHref(fw, state) } : null,
    ready: ready ? { name: ready.horse.name } : null,
  });
  return (
    <section className="frame-hero flex flex-wrap items-center gap-3 p-3 sm:p-4" aria-labelledby="signed-in-back-h" data-testid="signed-in-back" data-action={action.kind}>
      <h2 id="signed-in-back-h" className="t-hero min-w-0 flex-1">
        Welcome back, {state.stableName}
      </h2>
      <Link href={action.href} className="btn btn-brass" onClick={onClose} data-testid="signed-in-back-next">
        <PixelIcon name="flag" size={32} className="-my-2" /> {action.label}
      </Link>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close" data-testid="signed-in-back-close">
        ✕
      </button>
    </section>
  );
}
